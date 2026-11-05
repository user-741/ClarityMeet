/**
 * zoom-bot.js  -  ClarityMeet Meeting Bot  (v4 - logged-in Zoom account)
 *
 * Architecture:
 *   1. Bot logs into a dedicated Zoom account (ZOOM_BOT_EMAIL)
 *      at zoom.us/signin - bypasses guest reCAPTCHA entirely
 *   2. Navigates to the meeting web client URL while authenticated
 *   3. Joins as a signed-in user (no bot detection for authenticated users)
 *   4. ffmpeg records audio via PulseAudio virtual sink
 *   5. On stop: uploads MP3 to Supabase, saves transcript to DB
 */

import puppeteerExtra        from 'puppeteer-extra';
import StealthPlugin          from 'puppeteer-extra-plugin-stealth';

puppeteerExtra.use(StealthPlugin());
const puppeteer = puppeteerExtra;

import { mkdirSync, existsSync, statSync } from 'fs';
import { join, dirname }     from 'path';
import { fileURLToPath }     from 'url';
import { spawn }             from 'child_process';
import os                    from 'os';

const __dirname  = dirname(fileURLToPath(import.meta.url));
// Use /data (persistent Fly volume) for recordings so they survive redeploys.
// Falls back to __dirname/recordings if /data isn't mounted (local dev).
const DATA_DIR_GLOBAL = process.env.DATA_DIR || (existsSync('/data') ? '/data' : join(__dirname));
const REC_DIR    = join(DATA_DIR_GLOBAL, 'recordings');
if (!existsSync(REC_DIR)) mkdirSync(REC_DIR, { recursive: true });

const zoomLink = process.argv[2];
const botId    = process.argv[3];
const userId   = process.argv[4] || 'anonymous';
const botName  = process.argv[5] || 'ClarityBot';

// Bot account credentials come from Backend/.env only
const _rawEmail = (process.env.ZOOM_BOT_EMAIL || '').trim();
const ZOOM_EMAIL    = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(_rawEmail) ? _rawEmail : '';
const ZOOM_PASSWORD = process.env.ZOOM_BOT_PASSWORD || '';

function emit(event, data = {}) {
  process.stdout.write(JSON.stringify({ event, botId, ...data }) + '\n');
}

// Catch unhandled rejections so the process doesn't silently die
process.on('unhandledRejection', (reason) => {
  emit('info', { message: `unhandledRejection: ${reason?.message || reason}` });
});
process.on('uncaughtException', (err) => {
  emit('info', { message: `uncaughtException: ${err.message}` });
});

if (!zoomLink) {
  emit('error', { message: 'No Zoom link provided' });
  process.exit(1);
}

function toWebClientUrl(url) {
  try {
    const u   = new URL(url);
    const mId = u.pathname.match(/\/j\/(\d+)/)?.[1];
    if (!mId) return null;
    const wc  = new URL(`https://app.zoom.us/wc/${mId}/join`);
    if (u.searchParams.get('pwd')) wc.searchParams.set('pwd', u.searchParams.get('pwd'));
    return wc.toString();
  } catch { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const ENDED_PHRASES = [
  'this meeting has been ended by the host',
  'the meeting has been ended',
  'meeting has ended',
  'you have left the meeting',
  'this meeting has ended',
];

// Main
(async () => {
  emit('spawned');

  let browser         = null;
  let ffmpegProc      = null;
  let shuttingDown    = false;
  let endPollInterval = null;
  const mp3Path       = join(REC_DIR, `${botId}.mp3`);
  const isLinux       = process.platform === 'linux';

  const shutdown = async (reason) => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(endPollInterval);

    emit('leaving', { message: reason });

    if (ffmpegProc && !ffmpegProc.killed) {
      try {
        if (process.platform === 'win32') {
          // Windows: send 'q' via stdin first to let ffmpeg flush properly
          // then force-kill after timeout
          try { ffmpegProc.stdin.write('q\n'); } catch {}
          await new Promise(r => { ffmpegProc.on('close', r); setTimeout(r, 5000); });
          if (!ffmpegProc.killed) ffmpegProc.kill();
          // Wait an extra second for OS file buffers to flush
          await new Promise(r => setTimeout(r, 1000));
        } else {
          ffmpegProc.stdin.write('q');
          await new Promise(r => { ffmpegProc.on('close', r); setTimeout(r, 4000); });
          if (!ffmpegProc.killed) ffmpegProc.kill('SIGKILL');
        }
      } catch { /* ignore */ }
    }

    await sleep(500);

    const size = (() => { try { return statSync(mp3Path).size; } catch { return 0; } })();
    emit('recording_stopped', { mp3Path, bytes: size });

    try { await browser?.close(); } catch { /* ignore */ }

    emit('completed');
    process.exit(0);
  };

  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT',  () => shutdown('SIGINT'));

  try {
    emit('browser_launching');

    // stdin listener - set up immediately so OTP + join commands are ready
    // Must be declared before the login step because OTP detection can fire during login.
    let joinAssistReceived = false;
    const stdinBuf = { data: '', otpCode: null };
    if (process.stdin.readable) {
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', chunk => {
        stdinBuf.data += chunk;
        const lines = stdinBuf.data.split('\n');
        stdinBuf.data = lines.pop();
        for (const line of lines) {
          try {
            const msg = JSON.parse(line.trim());
            if (msg.cmd === 'join') {
              joinAssistReceived = true;
              emit('info', { message: 'Admin join assist received via stdin' });
            } else if (msg.cmd === 'otp' && msg.code) {
              stdinBuf.otpCode = String(msg.code).trim();
              emit('info', { message: 'OTP code received from admin' });
            }
          } catch { /* not JSON */ }
        }
      });
    }


    // Persistent profile - reused across ALL runs so reCAPTCHA/Google trust builds up
    // over time instead of every run looking like a fresh unknown device.
    // Stored on /data (Fly.io persistent volume) so it survives redeploys.
    // DO NOT key this by botId - that was creating a new empty profile every single time.
    const DATA_DIR    = process.env.DATA_DIR || '/data';
    const profileDir  = join(DATA_DIR, 'zoom-persistent-profile');
    try { mkdirSync(profileDir, { recursive: true }); } catch { /* exists */ }

    // PulseAudio virtual sink
    let pulseSink = 'ClarityMeet';
    if (isLinux) {
      try {
        const { execSync } = await import('child_process');
        const sinkName = `clarity_${botId.replace(/[^a-z0-9]/gi, '_')}`;
        execSync(`pactl load-module module-null-sink sink_name=${sinkName} sink_properties=device.description=${sinkName}`, { timeout: 5000 });
        pulseSink = sinkName;
        emit('info', { message: `PulseAudio sink: ${sinkName}` });
      } catch (e) {
        emit('info', { message: `PulseAudio setup warning: ${e.message} - using default sink` });
      }
    }

    const launchOptions = {
      headless: false,
      protocolTimeout: 120_000,
      ...(isLinux
        ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium' }
        : {}),
      args: [
        '--autoplay-policy=no-user-gesture-required',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--allow-running-insecure-content',
        // Realistic Chrome 124 UA - must match what stealth reports
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        ...(isLinux ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        `--user-data-dir=${profileDir}`,
        // DO NOT use --disable-gpu or --disable-software-rasterizer:
        // those force SwiftShader/LLVMpipe WebGL renderer strings which Zoom detects as datacenter bots.
        // With Xvfb providing a display, GPU compositing is safe to leave on (just no real GPU).
        '--disable-dev-shm-usage',
        '--memory-pressure-off',
        '--renderer-process-limit=1',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        '--disable-extensions',
        '--disable-plugins',
        '--disable-default-apps',
        '--no-first-run',
        // Prevent WebRTC IP leak revealing datacenter IP
        '--force-webrtc-ip-handling-policy=disable_non_proxied_udp',
        ...(isLinux ? [`--display=${process.env.DISPLAY || ':99'}`] : []),
      ],
    };

    browser = await puppeteer.launch(launchOptions);

    const context = browser.defaultBrowserContext();
    await context.overridePermissions('https://app.zoom.us', ['microphone', 'camera', 'notifications']);
    await context.overridePermissions('https://zoom.us',     ['microphone', 'camera', 'notifications']);

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    // Spoof WebGL/Canvas to hide virtual GPU (SwiftShader detection)
    // Zoom's bot detection checks WebGL renderer strings - SwiftShader = datacenter flag.
    // We override the JS APIs before any page script runs.
    await page.evaluateOnNewDocument(() => {
      // Spoof WebGL renderer to look like a real Intel/NVIDIA GPU
      const getParameter = WebGLRenderingContext.prototype.getParameter;
      WebGLRenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Intel Inc.';  // UNMASKED_VENDOR_WEBGL
        if (parameter === 37446) return 'Intel Iris OpenGL Engine'; // UNMASKED_RENDERER_WEBGL
        return getParameter.call(this, parameter);
      };
      const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function(parameter) {
        if (parameter === 37445) return 'Intel Inc.';
        if (parameter === 37446) return 'Intel Iris OpenGL Engine';
        return getParameter2.call(this, parameter);
      };

      // Spoof canvas fingerprint slightly
      const origToDataURL = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function(type, ...args) {
        if (this.width > 10 && this.height > 10) {
          const ctx = this.getContext('2d');
          if (ctx) {
            ctx.fillStyle = 'rgba(1,1,1,0.01)';
            ctx.fillRect(0, 0, 1, 1);
          }
        }
        return origToDataURL.call(this, type, ...args);
      };

      // Spoof hardware concurrency and memory to look like a real laptop
      Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
      Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
    });

    emit('browser_launched');
    page.on('dialog', async d => { try { await d.dismiss(); } catch {} });

    // STEP 1: Log into Zoom account
    if (ZOOM_EMAIL && ZOOM_PASSWORD) {
      emit('info', { message: `Logging in as ${ZOOM_EMAIL}` });

      // Zoom sign-in is a React SPA - use networkidle2 so JS renders first
      await page.goto('https://zoom.us/signin#email', { waitUntil: 'networkidle2', timeout: 30_000 });
      await sleep(2000);

      // Dismiss cookie banner if present
      await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button, a')]
          .find(e => /accept.*(all|cookies)|i agree/i.test(e.textContent ?? ''));
        if (btn) btn.click();
      }).catch(() => {});
      await sleep(800);

      // Helper: fill a React-controlled input (plain .value= doesn't trigger React)
      const fillReactInput = async (selector, value) => {
        await page.evaluate((sel, val) => {
          const el = document.querySelector(sel);
          if (!el) return;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, val);
          el.dispatchEvent(new Event('input',  { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        }, selector, value);
      };

      // Wait for email input to appear (Zoom renders it dynamically)
      let emailFilled = false;
      for (let i = 0; i < 20; i++) {
        const sel = await page.evaluate(() => {
          for (const s of ['#email', 'input[name="email"]', 'input[type="email"]', 'input[autocomplete="email"]', 'input[type="text"]']) {
            const el = document.querySelector(s);
            if (el) {
              const r = el.getBoundingClientRect();
              if (r.width > 10 && r.height > 10) return s;
            }
          }
          return null;
        }).catch(() => null);

        if (sel) {
          try {
            // Focus and clear the field
            await page.focus(sel);
            await sleep(200);
            // Select all + delete existing content
            await page.keyboard.down('Control');
            await page.keyboard.press('KeyA');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            // Type the email naturally
            await page.type(sel, ZOOM_EMAIL, { delay: 60 });
            emit('info', { message: `Email entered via ${sel}` });
            emailFilled = true;
            break;
          } catch (e) {
            emit('info', { message: `Email fill attempt ${i} failed: ${e.message}` });
          }
        }
        await sleep(1000);
      }

      if (!emailFilled) {
        emit('info', { message: 'Email input never appeared - skipping login' });
      } else {
        await sleep(500);

        // Click Next / Continue / Sign In (whichever is visible)
        const btn1 = await page.evaluate(() => {
          const b = [...document.querySelectorAll('button')]
            .find(b => /^(next|continue|sign.?in|log.?in)$/i.test((b.textContent ?? '').trim()) && !b.disabled);
          if (b) { b.click(); return b.textContent.trim(); }
          const s = document.querySelector('button[type="submit"]');
          if (s && !s.disabled) { s.click(); return 'submit'; }
          return null;
        }).catch(() => null);
        emit('info', { message: `Step-1 button clicked: ${btn1}` });
        await sleep(3000);

        // Check if password field appeared (two-step flow)
        const pwSel = await page.evaluate(() => {
          const el = document.querySelector('input[type="password"]');
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return r.width > 10 ? 'input[type="password"]' : null;
        }).catch(() => null);

        if (pwSel) {
          emit('info', { message: 'Password field visible - filling' });
          try {
            await page.focus(pwSel);
            await sleep(200);
            await page.keyboard.down('Control');
            await page.keyboard.press('KeyA');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await page.type(pwSel, ZOOM_PASSWORD, { delay: 60 });
            emit('info', { message: 'Password entered' });
          } catch (e) {
            emit('info', { message: `Password fill error: ${e.message}` });
          }
          await sleep(500);

          // Click final Sign In button
          const btn2 = await page.evaluate(() => {
            const b = [...document.querySelectorAll('button')]
              .find(b => /^(sign.?in|log.?in|submit)$/i.test((b.textContent ?? '').trim()) && !b.disabled);
            if (b) { b.click(); return b.textContent.trim(); }
            const s = document.querySelector('button[type="submit"]');
            if (s && !s.disabled) { s.click(); return 'submit'; }
            return null;
          }).catch(() => null);
          emit('info', { message: `Sign-in button clicked: ${btn2}` });
        } else {
          emit('info', { message: 'No password field - may be already signed in or single-step form' });
        }

        // Wait for login to complete - Zoom may redirect OR show a "Stay signed in?" dialog
        // The dialog keeps the URL on /signin#/login, so we check for EITHER condition
        let loginDone = false;
        let otpRequired = false;
        const loginDeadline = Date.now() + 30_000;
        while (!loginDone && Date.now() < loginDeadline) {
          await sleep(1000);
          const currentUrl = page.url();

          // OTP / two-factor redirect detection
          // Zoom sends a one-time code email when it detects a new IP (Fly.io datacenter).
          // URL changes to: .../signin/otp/verify_help?code=...
          // We cannot proceed without the code, so emit needs_assist immediately.
          if (currentUrl.includes('/otp/') || currentUrl.includes('verify_help') || currentUrl.includes('two_factor')) {
            otpRequired = true;
            const screenshotPath = join(REC_DIR, `${botId}_otp.png`);
            try {
              // Try to screenshot the iframe element for better visibility; fall back to full page
              const iframeEl = await page.$('iframe').catch(() => null);
              if (iframeEl) {
                await iframeEl.screenshot({ path: screenshotPath }).catch(async () => {
                  await page.screenshot({ path: screenshotPath, fullPage: true });
                });
              } else {
                await page.screenshot({ path: screenshotPath, fullPage: true });
              }
            } catch {}
            emit('needs_assist', {
              screenshotPath,
              message: `OTP verification required - Zoom emailed a code to ${ZOOM_EMAIL}. Check that inbox, enter the code in the Zoom page, then click "Trigger Join" in the admin panel once logged in.`,
            });
            emit('info', { message: `OTP redirect detected - URL: ${currentUrl}` });

            // Wait up to 3 minutes for admin to enter the OTP code
            // Admin submits via the frontend OTP input -> POST /assist/:botId/otp
            // -> server writes {cmd:'otp',code:'123456'} to this process's stdin
            const otpDeadline = Date.now() + 180_000;
            let otpSolved = false;
            while (Date.now() < otpDeadline) {
              await sleep(1000);

              // Check if an OTP code arrived via stdin
              if (stdinBuf.otpCode) {
                const code = stdinBuf.otpCode;
                stdinBuf.otpCode = null;
                emit('info', { message: `OTP code received via stdin: ${code.replace(/./g, '*')}` });

                try {
                  // Zoom OTP page has a single <input> for the 6-digit code
                  // Try multiple selectors in case DOM structure varies
                  const otpSel = await page.evaluate(() => {
                    for (const s of [
                      'input[type="tel"]',
                      'input[name="code"]',
                      'input[autocomplete="one-time-code"]',
                      'input[type="text"]',
                      'input[type="number"]',
                    ]) {
                      const el = document.querySelector(s);
                      if (el) { const r = el.getBoundingClientRect(); if (r.width > 10) return s; }
                    }
                    return null;
                  }).catch(() => null);

                  if (otpSel) {
                    await page.focus(otpSel);
                    await sleep(200);
                    await page.keyboard.down('Control'); await page.keyboard.press('KeyA'); await page.keyboard.up('Control');
                    await page.keyboard.press('Backspace');
                    await page.type(otpSel, code, { delay: 80 });
                    emit('info', { message: `OTP code typed into field: ${otpSel}` });
                    await sleep(500);

                    // Click submit / verify button
                    const submitted = await page.evaluate(() => {
                      const btn = [...document.querySelectorAll('button')]
                        .find(b => /verify|confirm|submit|continue|next/i.test((b.textContent ?? '').trim()) && !b.disabled);
                      if (btn) { btn.click(); return btn.textContent.trim(); }
                      const s = document.querySelector('button[type="submit"]');
                      if (s && !s.disabled) { s.click(); return 'submit'; }
                      return null;
                    }).catch(() => null);
                    emit('info', { message: `OTP submit clicked: ${submitted}` });
                    await sleep(3000);
                  } else {
                    emit('info', { message: 'OTP input field not found - page may have changed' });
                  }
                } catch (e) {
                  emit('info', { message: `OTP entry error: ${e.message}` });
                }
              }

              const u = page.url();
              // Once we leave the otp/signin pages, login is done
              if (!u.includes('/otp/') && !u.includes('verify_help') && !u.includes('two_factor') && !u.includes('/signin')) {
                loginDone = true;
                otpSolved = true;
                emit('info', { message: `OTP solved - now at: ${u}` });
                break;
              }
            }
            if (!otpSolved) {
              emit('error', { message: `OTP verification timeout - could not log in. Check ${ZOOM_EMAIL} for the code and try again.` });
              await browser.close().catch(() => {});
              process.exit(1);
            }
            break;
          }

          // Check for "Stay signed in?" or "You may stay signed in" modal - dismiss it
          const stayDismissed = await page.evaluate(() => {
            // Look for a "Stay signed in" or "Not now" / "No, thanks" button
            const buttons = [...document.querySelectorAll('button, a')];
            const notNow = buttons.find(b =>
              /not now|no,?\s*thanks|skip|later|cancel/i.test((b.textContent ?? '').trim())
            );
            if (notNow) { notNow.click(); return 'dismissed_not_now'; }
            // Also look for "Yes, Stay Signed In" and click it - either way we're logged in
            const yes = buttons.find(b =>
              /yes|stay signed in|keep me signed in|continue/i.test((b.textContent ?? '').trim())
            );
            if (yes) { yes.click(); return 'dismissed_yes'; }
            return null;
          }).catch(() => null);

          if (stayDismissed) {
            emit('info', { message: `Stay-signed-in dialog: ${stayDismissed}` });
            await sleep(2000);
            // After dismissing, give Zoom a moment to redirect
          }

          // Success conditions:
          // 1. Redirected away from /signin entirely
          // 2. Still on /signin but page text shows post-login content (stay-signed-in prompt IS a logged-in state)
          if (!currentUrl.includes('/signin')) {
            loginDone = true;
            emit('info', { message: `Login successful - redirected to: ${currentUrl}` });
          } else {
            // Check page text for signs we're past the credentials step
            const pageText = await page.evaluate(() =>
              (document.body?.innerText ?? '').toLowerCase()
            ).catch(() => '');
            if (
              pageText.includes('stay signed in') ||
              pageText.includes('you may stay signed in') ||
              pageText.includes('keep me signed in') ||
              pageText.includes('my account') ||
              pageText.includes('profile') ||
              pageText.includes('meetings')
            ) {
              loginDone = true;
              emit('info', { message: `Login successful - post-auth page detected at: ${currentUrl}` });
            }
          }
        }

        if (!loginDone && !otpRequired) {
          const url = page.url();
          const txt = await page.evaluate(() => document.body?.innerText?.slice(0, 300) ?? '').catch(() => '');
          emit('info', { message: `Login timeout - URL: ${url} - text: ${txt.slice(0, 150)}` });
          // Still proceed - partial session cookies may help bypass bot detection
        }
        await sleep(2000);
      }

    } else {
      emit('info', { message: 'No bot credentials configured - joining as guest' });
    }

    // STEP 2: Navigate to meeting via zoom.us/j/ (carries auth cookies)
    // IMPORTANT: Navigate to zoom.us/j/<id> NOT app.zoom.us/wc/<id>/join directly.
    // Going direct to app.zoom.us/wc/ skips the auth redirect and triggers bot detection
    // even for logged-in users. zoom.us/j/ goes through Zoom's own redirect flow which
    // properly attaches the session token to the web client.
    emit('navigating', { url: zoomLink });

    try {
      await page.goto(zoomLink, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    } catch { /* SPA/redirect timeout - continue */ }

    await sleep(3000);

    // Accept cookies if present
    await page.evaluate(() => {
      const btn = [...document.querySelectorAll('button, a')]
        .find(e => /accept.*(all|cookies)|continue/i.test(e.textContent ?? ''));
      if (btn) btn.click();
    }).catch(() => {});
    await sleep(500);

    // The zoom.us/j/ page shows "Open Zoom" app + "Join from your Browser" link
    // We need to click "Join from your Browser" to stay in the web client
    for (let attempt = 0; attempt < 10; attempt++) {
      const currentUrl = page.url();
      emit('info', { message: `Navigation attempt ${attempt + 1} - URL: ${currentUrl}` });

      // If already on the web client join page, stop
      if (/app\.zoom\.us\/wc\//.test(currentUrl)) {
        emit('info', { message: 'Already on web client page' });
        break;
      }

      const clicked = await page.evaluate(() => {
        const el = [...document.querySelectorAll('a, button, [role="button"]')]
          .find(e => /join from (your )?browser/i.test(e.textContent ?? ''));
        if (el) { el.click(); return true; }
        return false;
      }).catch(() => false);
      if (clicked) {
        emit('info', { message: 'Clicked "Join from browser"' });
        await sleep(3000);
        break;
      }

      // If stuck on the launch page, navigate directly to the web client as fallback
      if (attempt === 6) {
        const wcUrl = toWebClientUrl(zoomLink);
        if (wcUrl) {
          emit('info', { message: `Fallback: navigating direct to web client ${wcUrl}` });
          try { await page.goto(wcUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 }); } catch {}
          await sleep(3000);
          break;
        }
      }
      await sleep(1000);
    }

    emit('joining');

    // Find the Zoom iframe - all WC content lives inside it
    // Zoom's web client renders the join form + in-meeting UI inside an iframe,
    // NOT the top-level page body. All DOM checks must use the frame context.
    let zoomFrame = null;
    emit('info', { message: 'Searching for Zoom iframe...' });
    for (let i = 0; i < 20 && !zoomFrame; i++) {
      const frames = page.frames();
      // The zoom iframe URL contains /wc/ - find it (exclude the top frame)
      zoomFrame = frames.find(f =>
        f !== page.mainFrame() &&
        (/app\.zoom\.us\/wc\//.test(f.url()) || /zoom\.us\/wc\//.test(f.url()))
      );
      if (!zoomFrame) {
        // Log all frame URLs on first few attempts to help diagnose
        if (i < 3) {
          const urls = frames.map(f => f.url()).join(' | ');
          emit('info', { message: `Frames at attempt ${i}: ${urls.slice(0, 300)}` });
        }
        await sleep(1000);
      }
    }
    const ctx = zoomFrame || page; // fallback to page if iframe not found
    emit('info', { message: `Using frame: ${zoomFrame ? zoomFrame.url().slice(0, 100) : 'top-level page (no iframe found)'}` });

    // Enter/confirm name
    // When logged in, Zoom may pre-fill the name or skip this step entirely
    for (let attempt = 0; attempt < 15; attempt++) {
      try {
        const hasInput = await ctx.evaluate(() => {
          const inputs = [...document.querySelectorAll('input[type="text"], input:not([type])')]
            .filter(i => { const r = i.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !i.disabled; });
          return inputs.length > 0;
        }).catch(() => false);

        if (hasInput) {
          // Use ctx.focus + ctx.type so keystrokes go to the right frame
          await ctx.focus('input[type="text"]').catch(() => {});
          await sleep(150);
          await ctx.evaluate(() => {
            const inp = document.querySelector('input[type="text"]');
            if (inp) { inp.select(); }
          }).catch(() => {});
          await page.keyboard.press('Backspace');
          // page.keyboard always goes to the focused element regardless of frame
          await page.keyboard.type(botName, { delay: 50 });
          emit('info', { message: `Name entered: ${botName}` });
          await sleep(600);
          break;
        }
      } catch { /* input not ready */ }

      // If URL already shows we're in the meeting room, skip name step
      const url = page.url();
      if (/zoom\.us\/wc\/meeting\//.test(url)) {
        emit('info', { message: 'Already in meeting - skipping name step' });
        break;
      }
      await sleep(1000);
    }

    // Click Join (with manual-assist fallback)
    // Strategy:
    //   1. Try automated click (works when reCAPTCHA trust score passes)
    //   2. If Join button exists but click does nothing (reCAPTCHA silent block),
    //      emit needs_assist so the admin dashboard can trigger a remote click
    //   3. Listen on stdin for { cmd: "join" } from the server (admin triggered)

    // stdin listener moved to top of try block (before login) - see below

    // Helper: attempt one join click using NATIVE CDP mouse events (isTrusted=true).
    // element.click() is synthetic (isTrusted=false) - reCAPTCHA detects and blocks it.
    // page.mouse.click(x,y) dispatches real OS-level input events through the CDP
    // protocol, which reCAPTCHA treats as genuine user interaction.
    // We also add human-like mouse movement for better trust score.
    const tryJoinClick = async () => {
      // Selectors to try in order
      const selectors = [
        '.preview-join-button',
        'button[type="submit"]',
        'button[aria-label="Join"]',
        '.zm-btn--primary',
        '.join-btn',
      ];

      for (const sel of selectors) {
        try {
          const btn = await ctx.$(sel);
          if (!btn) continue;

          // Get bounding box in the FRAME coordinate space, then convert to page coords
          // For iframes, we need the frame's position on the page
          let box = await btn.boundingBox().catch(() => null);
          if (!box) continue;

          // If we're using an iframe context, offset by the iframe's position on the page
          if (ctx !== page) {
            const frameEl = await page.$('iframe').catch(() => null);
            if (frameEl) {
              const frameBox = await frameEl.boundingBox().catch(() => null);
              if (frameBox) {
                box = {
                  x: box.x + frameBox.x,
                  y: box.y + frameBox.y,
                  width: box.width,
                  height: box.height,
                };
              }
            }
          }

          // Target: centre of the button
          const targetX = box.x + box.width / 2;
          const targetY = box.y + box.height / 2;

          // Human-like mouse path: move from off-screen, pause, then click
          // Start from a random position that looks like the user was reading
          const startX = targetX - 80 - Math.random() * 120;
          const startY = targetY - 20 - Math.random() * 40;
          await page.mouse.move(startX, startY);
          await sleep(80 + Math.random() * 120);
          // Slide towards the button over a few steps
          const steps = 8 + Math.floor(Math.random() * 6);
          await page.mouse.move(targetX, targetY, { steps });
          await sleep(60 + Math.random() * 80);
          // Native click - CDP InputEvent, isTrusted=true
          await page.mouse.click(targetX, targetY, { button: 'left', delay: 40 + Math.random() * 40 });
          emit('info', { message: `Native mouse click on ${sel} at (${Math.round(targetX)},${Math.round(targetY)})` });
          return sel;
        } catch (e) {
          emit('info', { message: `tryJoinClick ${sel} error: ${e.message}` });
        }
      }

      // Fallback: find Join button by text and native-click it
      try {
        const btnData = await ctx.evaluate(() => {
          const btn = [...document.querySelectorAll('button')]
            .find(b => /^join$/i.test((b.textContent ?? '').trim()) && !b.disabled);
          if (!btn) return null;
          const r = btn.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }).catch(() => null);

        if (btnData) {
          // Offset by iframe position if in iframe context
          let { x, y } = btnData;
          if (ctx !== page) {
            const frameEl = await page.$('iframe').catch(() => null);
            const frameBox = frameEl ? await frameEl.boundingBox().catch(() => null) : null;
            if (frameBox) { x += frameBox.x; y += frameBox.y; }
          }
          await page.mouse.move(x - 60, y - 15);
          await sleep(80);
          await page.mouse.move(x, y, { steps: 6 });
          await sleep(60);
          await page.mouse.click(x, y, { button: 'left', delay: 40 });
          emit('info', { message: `Native mouse click on text:join at (${Math.round(x)},${Math.round(y)})` });
          return 'text:join';
        }
      } catch { /* no button */ }

      return null;
    };

    // In-meeting detection constants
    // Defined here so they can be used both in the alreadyIn check AND the
    // joined wait loop below (avoids TDZ errors from const hoisting).
    const IN_MEETING_URL = /zoom\.us\/wc\/meeting\//;
    const IN_MEETING_SELECTORS = [
      '[aria-label="open the chat pane"]',
      '[aria-label="Participants"]',
      '[aria-label="More meeting control"]',
      '.meeting-info-container',
      '#wc-container-right',
      '#meetingWindowFull',
      '.meeting-app',
      '.meeting-client',
      '#root > div[class*="meeting"]',
    ];

    // Check if the top-level page text shows in-meeting phrases
    // (Zoom PWA/app sometimes renders in the top-level context, not the iframe)
    const isInMeetingByTopText = async () => {
      const topText = await page.evaluate(() =>
        (document.body?.innerText ?? '').toLowerCase()
      ).catch(() => '');
      return (
        topText.includes('you are unmuted') ||
        topText.includes('you are muted') ||
        topText.includes('leave meeting') ||
        topText.includes('end meeting') ||
        topText.includes('you are now in the meeting')
      );
    };

    await sleep(400);
    let joinClicked = await tryJoinClick();
    emit('info', { message: `Auto join click: ${joinClicked ?? 'no button found'}` });
    await sleep(3000);

    // Check if we're ACTUALLY inside the meeting (not just the pre-join screen).
    // IMPORTANT: The pre-join screen also shows "Mute" and "Start Video" buttons,
    // so we CANNOT use text checks like t.includes('mute').
    // Use structural in-meeting DOM selectors instead.
    const alreadyIn = await (async () => {
      // Check URL first - most reliable signal
      if (IN_MEETING_URL.test(page.url())) return true;
      // Check top-level page text (Zoom sometimes renders in PWA context)
      if (await isInMeetingByTopText()) return true;
      // Check for selectors that only exist INSIDE the meeting (not on pre-join screen)
      for (const sel of IN_MEETING_SELECTORS) {
        const found = await ctx.$(sel).catch(() => null);
        if (found) return true;
      }
      return false;
    })();

    if (!alreadyIn) {
      // Take a screenshot for the admin assist UI
      const screenshotPath = join(REC_DIR, `${botId}_assist.png`);
      try {
        // Try iframe element screenshot first (captures Zoom join UI, not blank top-level page)
        const iframeEl2 = await page.$('iframe').catch(() => null);
        if (iframeEl2) {
          await iframeEl2.screenshot({ path: screenshotPath }).catch(async () => {
            await page.screenshot({ path: screenshotPath, fullPage: true });
          });
        } else {
          await page.screenshot({ path: screenshotPath, fullPage: true });
        }
        emit('needs_assist', { screenshotPath, message: 'Bot waiting at join screen - admin click required' });
        emit('info', { message: `Screenshot saved: ${screenshotPath}` });
      } catch (e) {
        emit('needs_assist', { message: 'Bot waiting at join screen - reCAPTCHA may be blocking' });
      }

      // Wait up to 3 minutes for admin to trigger join via stdin
      const assistDeadline = Date.now() + 180_000;
      let assistJoined = false;
      emit('info', { message: 'Waiting for admin assist (up to 3 min)...' });

      while (Date.now() < assistDeadline && !assistJoined) {
        if (joinAssistReceived) {
          joinAssistReceived = false;
          emit('join_clicked', { message: 'Admin triggered join' });
          const retryClick = await tryJoinClick();
          emit('info', { message: `Admin-triggered click: ${retryClick ?? 'no button'}` });
          await sleep(3000);
        }

        // Check if we've made it past the join screen
        // Use ALL signals: URL, top-level text, iframe selectors
        const urlIn = /zoom\.us\/wc\/meeting\//.test(page.url());
        let inMeetingNow = urlIn || await isInMeetingByTopText();
        if (!inMeetingNow) {
          for (const sel of IN_MEETING_SELECTORS) {
            const found = await ctx.$(sel).catch(() => null);
            if (found) { inMeetingNow = true; break; }
          }
        }

        if (inMeetingNow || urlIn) {
          assistJoined = true;
          emit('info', { message: 'Entered meeting after admin assist' });
          break;
        }

        await sleep(2000);
      }
      if (!assistJoined) {
        emit('info', { message: 'Admin assist timeout - proceeding with final join attempt' });
        await tryJoinClick();
        await sleep(3000);
      }
    }

    // Wait until confirmed INSIDE the meeting
    // Check both URL pattern AND iframe selectors for in-meeting UI

    let joined = false;
    const joinDeadline = Date.now() + 180_000; // 3 min - Zoom can take >90s to fully load
    while (!joined && Date.now() < joinDeadline) {
      // URL check (works on top-level page)
      const currentUrl = page.url();
      if (IN_MEETING_URL.test(currentUrl)) {
        joined = true;
        emit('info', { message: `URL confirmed in-meeting: ${currentUrl}` });
        break;
      }

      // Check top-level page text (Zoom PWA context - "You are unmuted" etc.)
      if (!joined && await isInMeetingByTopText()) {
        joined = true;
        emit('info', { message: 'Top-level page text confirmed in-meeting' });
        break;
      }

      // Selector checks inside the iframe (ctx)
      for (const sel of IN_MEETING_SELECTORS) {
        const found = await ctx.$(sel).catch(() => null);
        if (found) {
          joined = true;
          emit('info', { message: `Selector confirmed in iframe: ${sel}` });
          break;
        }
      }

      if (!joined) {
        const remaining = Math.round((joinDeadline - Date.now()) / 1000);
        // Check top-level page EVERY loop iteration - cheapest check
        if (await isInMeetingByTopText()) {
          joined = true;
          emit('info', { message: 'Top-level page text confirmed in-meeting (loop check)' });
          break;
        }
        if (remaining % 15 === 0 || remaining === 179) {
          // Log iframe text for debugging (not just the blank top-level body)
          const frameText = await ctx.evaluate(() =>
            (document.body?.innerText ?? '').slice(0, 200)
          ).catch(() => '');
          const topText2 = await page.evaluate(() =>
            (document.body?.innerText ?? '').slice(0, 100)
          ).catch(() => '');
          emit('info', { message: `Waiting to join (${remaining}s left) | iframe: ${frameText} | top: ${topText2}` });
        }

        // Check for hard bot-detection wall
        const blocked = await ctx.evaluate(() =>
          (document.body?.innerText ?? '').includes("Automated bots aren't allowed")
        ).catch(() => false);
        if (blocked) {
          emit('error', { message: 'Bot detection wall visible inside iframe - IP blocked' });
          await browser.close().catch(() => {});
          process.exit(1);
        }

        // Check for visible reCAPTCHA challenge - log it but don't exit,
        // because the bot may still be loading into the meeting in parallel.
        // The VNC view will show it so admin can solve it manually.
        const captchaVisible = await page.evaluate(() => {
          return (document.body?.innerText ?? '').toLowerCase().includes("i'm not a robot");
        }).catch(() => false);
        if (captchaVisible) {
          emit('info', { message: 'reCAPTCHA checkbox visible - use VNC to solve manually or wait for trust to build' });
        }

        // Retry clicking Join every 30s using native mouse events
        if (remaining % 30 === 0 && remaining < 170) {
          const retryJoin = await tryJoinClick().catch(() => null);
          if (retryJoin) emit('info', { message: `Retried Join click (native): ${retryJoin}` });
        }

        await sleep(2000);
      }
    }

    if (!joined) {
      const frameText = await ctx.evaluate(() => document.body?.innerText?.slice(0, 800) ?? '').catch(() => '');
      const topText  = await page.evaluate(() => document.body?.innerText?.slice(0, 200) ?? '').catch(() => '');
      const currentUrl = page.url();
      emit('error', { message: `Never entered meeting. URL: ${currentUrl} | iframe: ${frameText} | top: ${topText}` });
      await browser.close().catch(() => {});
      process.exit(1);
    }

    emit('joined', { confirmed: true });
    emit('info', { message: 'Bot confirmed inside meeting - starting audio capture' });
    await sleep(2000);

    // Start ffmpeg audio capture
    await sleep(1000);

    const ffmpegArgs = isLinux ? [
      '-f', 'pulse',
      '-i', `${pulseSink}.monitor`,
      '-acodec', 'libmp3lame',
      '-ar', '16000',
      '-ac', '1',
      '-ab', '64k',
      '-y',
      mp3Path,
    ] : [
      // Windows: VB-Cable loopback - captures all system audio output including Zoom
      // Requires VB-Audio Virtual Cable installed (free): https://vb-audio.com/Cable/
      '-f', 'dshow',
      '-i', 'audio=CABLE Output (VB-Audio Virtual Cable)',
      '-acodec', 'libmp3lame',
      '-ar', '16000',
      '-ac', '1',
      '-ab', '64k',
      '-y',
      mp3Path,
    ];

    // Try to start ffmpeg; on Windows fall back through multiple capture methods
    const startFfmpeg = (args) => {
      const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
      proc.stderr.on('data', d => {
        const msg = d.toString().trim();
        if (msg) emit('info', { message: `ffmpeg: ${msg.slice(0, 200)}` });
      });
      return proc;
    };

    ffmpegProc = startFfmpeg(ffmpegArgs);

    // On Windows, if primary capture method fails quickly, try fallbacks
    if (!isLinux) {
      await new Promise(resolve => setTimeout(resolve, 2000));
      if (ffmpegProc.exitCode !== null && ffmpegProc.exitCode !== 0) {
        emit('info', { message: 'VB-Cable failed - falling back to microphone' });
        // Fallback 1: Intel mic
        const fallback1Args = [
          '-f', 'dshow', '-i', 'audio=Microphone Array (Intel\u00ae Smart Sound Technology for Digital Microphones)',
          '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1', '-ab', '64k', '-y', mp3Path,
        ];
        ffmpegProc = startFfmpeg(fallback1Args);
        await new Promise(resolve => setTimeout(resolve, 2000));
        if (ffmpegProc.exitCode !== null && ffmpegProc.exitCode !== 0) {
          emit('info', { message: 'dshow fallback failed - audio capture unavailable, bot will still record meeting duration' });
          // Fallback 2: generate a tiny silent placeholder (1 second) so pipeline has a file
          // Use -t 1 so it exits immediately and doesn't run forever
          const silentArgs = [
            '-f', 'lavfi', '-i', 'anullsrc=r=16000:cl=mono',
            '-acodec', 'libmp3lame', '-ar', '16000', '-ac', '1', '-ab', '64k',
            '-t', '1', '-y', mp3Path,
          ];
          ffmpegProc = startFfmpeg(silentArgs);
        }
      }
    }

    ffmpegProc.on('close', (code) => {
      if (!shuttingDown) {
        emit('info', { message: `ffmpeg exited with code ${code}` });
      }
    });

    emit('audio_start', { mp3Path });
    emit('recording', { message: 'ffmpeg audio capture active' });

    // Poll for meeting end
    // Use ctx (iframe frame) for text checks - the top-level page body is empty
    let meetingEndDetected = false;
    endPollInterval = setInterval(async () => {
      if (meetingEndDetected || shuttingDown) {
        clearInterval(endPollInterval);
        return;
      }
      try {
        if (page.isClosed()) {
          meetingEndDetected = true;
          clearInterval(endPollInterval);
          shutdown('Page closed');
          return;
        }

        // Check iframe text first, fall back to top-level page
        const bodyText = await ctx.evaluate(() =>
          (document.body?.innerText ?? '').toLowerCase()
        ).catch(() => page.evaluate(() =>
          (document.body?.innerText ?? '').toLowerCase()
        ).catch(() => ''));

        if (ENDED_PHRASES.some(p => bodyText.includes(p))) {
          meetingEndDetected = true;
          clearInterval(endPollInterval);
          emit('meeting_ended', { message: 'End-of-meeting text detected' });
          shutdown('Meeting ended by host');
          return;
        }

        const url = page.url();
        if (url && !url.includes('zoom.us/wc/') && !url.includes('zoom.us/j/') && !url.startsWith('about:')) {
          meetingEndDetected = true;
          clearInterval(endPollInterval);
          emit('meeting_ended', { message: `Navigated away: ${url}` });
          shutdown('Navigation away from meeting');
        }
      } catch { /* mid-navigation */ }
    }, 3000);

    await new Promise(() => {});

  } catch (err) {
    emit('error', { message: err.message });
    if (browser) await browser.close().catch(() => {});
    process.exit(1);
  }
})();
