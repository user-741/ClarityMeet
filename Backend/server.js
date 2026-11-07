/**
 * server.js  -  ClarityMeet Bot Server
 *
 * Responsibilities:
 *   1. Spawn zoom-bot.js child processes (one per meeting)
 *   2. Listen for structured JSON events on child stdout
 *   3. On `recording_stopped`: convert .webm -> .mp3 with ffmpeg, upload to Supabase Storage
 *   4. AI pipeline: Gemini (audio -> transcript + summary + tasks in one call)
 *   5. On `completed`: write meeting + tasks records to Supabase DB so dashboard updates
 *   6. REST API: /health, /bots, /join, /stop/:botId, /bots/:botId
 *   7. POST /transcribe - trigger AI pipeline on an already-uploaded file (used by upload page)
 *
 * AI model used: gemini-2.5-flash (free tier via Google AI Studio key)
 * Get a free key at: https://aistudio.google.com/apikey
 */

import express          from 'express';
import crypto           from 'crypto';
import cors             from 'cors';
import { spawn }        from 'child_process';
import {
  existsSync, mkdirSync,
  readFileSync, unlinkSync, statSync, writeFileSync,
} from 'fs';
import { extname } from 'path';
import { tmpdir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import 'dotenv/config';
import { createClient }  from '@supabase/supabase-js';
import { GoogleGenAI }   from '@google/genai';

const __dirname      = dirname(fileURLToPath(import.meta.url));
const RECORDINGS_DIR = join(__dirname, 'recordings');
if (!existsSync(RECORDINGS_DIR)) mkdirSync(RECORDINGS_DIR, { recursive: true });

const app            = express();
const PORT           = Number(process.env.PORT || process.env.BACKEND_PORT || 3001); // 3000 is the Next.js frontend
const STORAGE_BUCKET = 'recordings';

// Supabase (service-role - bypasses RLS)
const supabase = createClient(
  process.env.SUPABASE_URL       || process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Gemini client (free tier - just needs GEMINI_API_KEY)
const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

// Tried in order. If one is rate limited or unavailable the next one is used.
const GEMINI_MODELS = (process.env.GEMINI_MODELS || 'gemini-2.5-flash,gemini-2.5-flash-lite')
  .split(',').map(m => m.trim()).filter(Boolean);
const aiStatus = { ok: !!gemini, checked: null, error: gemini ? null : 'GEMINI_API_KEY is not set', model: null };
let lastAiError = null;

async function generate(parts) {
  let lastErr;
  for (const model of GEMINI_MODELS) {
    try {
      const response = await gemini.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: { responseMimeType: 'application/json' },
      });
      aiStatus.ok = true; aiStatus.error = null; aiStatus.model = model;
      return response;
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || err);
      console.warn(`Gemini ${model} failed: ${msg.slice(0, 200)}`);
      if (/API key|API_KEY|PERMISSION_DENIED|401|403/i.test(msg)) break;
    }
  }
  throw lastErr;
}

function friendlyAiError(err) {
  const msg = String(err?.message || err || '');
  if (/API key|API_KEY|PERMISSION_DENIED/i.test(msg)) return 'The Gemini API key is missing or invalid.';
  if (/429|RESOURCE_EXHAUSTED|quota/i.test(msg)) return 'The free Gemini limit has been reached. Try again later.';
  if (/ffmpeg/i.test(msg)) return 'This file could not be read as audio.';
  if (/JSON/i.test(msg)) return 'The AI returned an unreadable answer. Try again.';
  return msg.slice(0, 200) || 'Processing failed.';
}

// Re-encodes any audio or video file to small mono mp3 so every format works
// and most meetings fit in a single request.
function toSpeechMp3(inputPath) {
  const out = join(tmpdir(), `cm_${crypto.randomUUID()}.mp3`);
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-y', '-i', inputPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '48k', out]);
    let errText = '';
    ff.stderr.on('data', d => { errText = (errText + d).slice(-400); });
    ff.on('error', e => reject(new Error(`ffmpeg not available: ${e.message}`)));
    ff.on('close', code => code === 0 && existsSync(out) && statSync(out).size > 0
      ? resolve(out)
      : reject(new Error(`ffmpeg could not convert the file (${errText.trim().split('\n').pop() || code})`)));
  });
}

if (!gemini) {
  console.warn(' GEMINI_API_KEY not set - AI transcription/summary disabled, falling back to regex.');
  console.warn('   Get a free key at: https://aistudio.google.com/apikey');
}

app.use(cors());
// Keep the raw bytes so /webhook/zoom can verify Zoom's HMAC signature.
// (A second express.json() on that route never runs because this one
// already consumed the body, so rawBody must be captured here.)
app.use(express.json({ limit: '2mb', verify: (req, _res, buf) => { req.rawBody = buf; } }));

// Auth: every app route needs a valid Supabase access token
// The Next.js proxy (/api/backend/*) forwards the user's bearer token.
// We use the VERIFIED user id, never a userId sent in the request body.
async function requireUser(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'unauthenticated' });
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'unauthenticated' });
    req.user = data.user;
    next();
  } catch (err) {
    res.status(401).json({ error: 'unauthenticated' });
  }
}

async function isWorkspaceMember(userId, workspaceId, role) {
  if (!userId || !workspaceId) return false;
  let q = supabase.from('workspace_members').select('role')
    .eq('user_id', userId).eq('workspace_id', workspaceId);
  if (role) q = q.eq('role', role);
  const { data } = await q.maybeSingle();
  return !!data;
}

const AUDIO_MIME = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.flac': 'audio/flac',
  '.webm': 'audio/webm', '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
};
function mimeFor(pathOrUrl, fallback = 'audio/mpeg') {
  const clean = String(pathOrUrl).split('?')[0];
  return AUDIO_MIME[extname(clean).toLowerCase()] || fallback;
}

const activeBots = new Map();

// Convert webm -> mp3 via ffmpeg
async function convertToMp3(webmPath) {
  const mp3Path = webmPath.replace(/\.webm$/, '.mp3');
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', [
      '-y', '-i', webmPath,
      '-vn', '-ar', '44100', '-ac', '2', '-b:a', '128k',
      mp3Path,
    ]);
    ff.on('close', code => {
      if (code === 0) resolve(mp3Path);
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
  });
}

// Upload mp3 to Supabase Storage
async function uploadToSupabase(filePath, botId) {
  const fileName   = `${botId}.mp3`;
  const fileBuffer = readFileSync(filePath);
  const { error }  = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(fileName, fileBuffer, { contentType: 'audio/mpeg', upsert: true });
  if (error) throw error;
  const { data: { publicUrl } } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(fileName);
  return publicUrl;
}

// People in the workspace (so Gemini spells names correctly)
// Speech-to-text guesses unfamiliar names ("Latif Naderi" came out as
// "Latesha Njeri"). Giving the model the real names of the people in the
// workspace - recording owner first - fixes the spelling and lets us link
// participants to real accounts.
async function getKnownPeople(workspaceId, ownerId) {
  if (!workspaceId) return [];
  try {
    const { data: members } = await supabase
      .from('workspace_members').select('user_id').eq('workspace_id', workspaceId);
    const ids = (members || []).map(m => m.user_id);
    if (!ids.length) return [];
    const { data: users } = await supabase
      .from('users').select('id, first_name, last_name, name, email').in('id', ids);
    const people = (users || []).map(u => ({
      id: u.id,
      email: u.email || null,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || u.name || (u.email || '').split('@')[0],
    })).filter(p => p.name);
    people.sort((a, b) => (a.id === ownerId ? -1 : b.id === ownerId ? 1 : 0));
    return people;
  } catch (err) {
    console.error('getKnownPeople error:', err.message);
    return [];
  }
}

function peoplePromptBlock(knownPeople, ownerId) {
  if (!knownPeople?.length) return '';
  const list = knownPeople.map(p => `- ${p.name}${p.id === ownerId ? ' (recorded this meeting)' : ''}`).join('\n');
  return `

People in this team (they may or may not be in this meeting). When a speaker says their name, is addressed by name, or is assigned a task and it sounds like one of these people, use EXACTLY this spelling:
${list}
`;
}

const PARTICIPANTS_FIELD = `  "participants": [
    { "name": "Full name as best known (use the team spelling above if it matches), or 'Speaker N' if unknown", "speaker_label": "Speaker label used in the transcript, e.g. 'Speaker 1', or null" }
  ],`;

const PARTICIPANTS_RULES = `
Participants: list every distinct person who speaks, one entry each. If someone introduces themselves or is addressed by name, label them by that name in the transcript instead of 'Speaker N'. Keep the same label for the same voice all the way through.
Transcript correction: fix words that were clearly misheard or misspelled, using the topic of the meeting and the team names below (for example "can yu fix up the proble in task 1" becomes "can you fix up the problem in task 1"). Do not change what anyone meant. List every fix in "corrections".`;

const CORRECTIONS_FIELD = `  "corrections": [{ "heard": "words as first heard", "corrected": "fixed words" }],`;

// Tell each assignee about the tasks they were given in a meeting.
async function notifyAssignees(workspaceId, meetingId, taskRows, meetingTitle) {
  const byUser = new Map();
  for (const t of taskRows) if (t.assignee_id) byUser.set(t.assignee_id, [...(byUser.get(t.assignee_id) || []), t.title]);
  if (!byUser.size) return;
  const rows = [...byUser.entries()].map(([userId, titles]) => ({
    user_id: userId,
    workspace_id: workspaceId,
    type: 'info',
    title: `${titles.length} new task${titles.length > 1 ? 's' : ''} for you`,
    body: `From ${meetingTitle || 'a meeting'}: ${titles.slice(0, 3).join('; ')}${titles.length > 3 ? '...' : ''}`,
    link: `/meeting-summary?id=${meetingId}`,
    read: false,
  }));
  const { error } = await supabase.from('notifications').insert(rows);
  if (error) console.error('notifyAssignees error:', error.message);
}

// Match a spoken name to a team member: full name, or a unique first name.
function matchPerson(name, knownPeople) {
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, '').trim();
  const n = norm(name);
  if (!n || !knownPeople?.length) return null;
  const full = knownPeople.find(k => norm(k.name) === n);
  if (full) return full;
  const first = knownPeople.filter(k => norm(k.name).split(' ')[0] === n.split(' ')[0]);
  return first.length === 1 ? first[0] : null;
}

// Save participants for a meeting and link them to real accounts by name.
async function saveParticipants(meetingId, participants, knownPeople) {
  if (!meetingId || !Array.isArray(participants) || !participants.length) return 0;
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
  const seen = new Set();
  const rows = [];
  for (const p of participants) {
    const name = String(p?.name || '').trim().slice(0, 120);
    if (!name || seen.has(norm(name))) continue;
    seen.add(norm(name));
    const match = matchPerson(name, knownPeople);
    rows.push({
      meeting_id:    meetingId,
      user_id:       match?.id || null,
      display_name:  match?.name || name,
      email:         match?.email || null,
      speaker_label: p?.speaker_label ? String(p.speaker_label).slice(0, 60) : null,
    });
  }
  if (!rows.length) return 0;
  const { error } = await supabase.from('meeting_participants').insert(rows);
  if (error) { console.error('participants insert error:', error.message); return 0; }
  await supabase.from('meetings').update({ participant_count: rows.length }).eq('id', meetingId);
  return rows.length;
}

// Gemini: transcribe + summarise + extract tasks in one call
// Accepts a local file path (preferred - avoids re-download) or a public URL.
async function runGeminiPipeline(audioSource, { knownPeople = [], ownerId = null } = {}) {
  if (!gemini) return null;

  try {
    console.log('Sending audio to Gemini:', audioSource);

    let audioPart;
    let tempFile = null;
    let localPath = audioSource;
    let mimeType = mimeFor(audioSource);

    if (audioSource && audioSource.startsWith('http')) {
      // Remote URL (upload page) - download to a temp file first.
      const res = await fetch(audioSource);
      if (!res.ok) throw new Error(`Download failed: ${res.status}`);
      const ct = res.headers.get('content-type');
      if (ct && /^(audio|video)\//.test(ct)) mimeType = ct.split(';')[0];
      tempFile = join(tmpdir(), `cm_${Date.now()}${extname(audioSource.split('?')[0]) || '.bin'}`);
      writeFileSync(tempFile, Buffer.from(await res.arrayBuffer()));
      localPath = tempFile;
    }

    let converted = null;
    if (localPath) {
      try {
        converted = await toSpeechMp3(localPath);
        localPath = converted;
        mimeType = 'audio/mpeg';
      } catch (convErr) {
        console.warn('Audio conversion skipped:', convErr.message);
        if (!AUDIO_MIME[extname(localPath).toLowerCase()]) throw convErr;
      }
      const size = statSync(localPath).size;
      if (size > 15 * 1024 * 1024) {
        // Large files go through the Files API instead of inline data.
        let uploaded = await gemini.files.upload({ file: localPath, config: { mimeType } });
        for (let i = 0; i < 90 && uploaded.state === 'PROCESSING'; i++) {
          await new Promise(r => setTimeout(r, 2000));
          uploaded = await gemini.files.get({ name: uploaded.name });
        }
        if (uploaded.state === 'FAILED') throw new Error('Gemini could not process the audio file');
        audioPart = { fileData: { fileUri: uploaded.uri, mimeType: uploaded.mimeType || mimeType } };
      } else {
        audioPart = { inlineData: { mimeType, data: readFileSync(localPath).toString('base64') } };
      }
      if (converted) { try { unlinkSync(converted); } catch {} }
    }
    if (tempFile) { try { unlinkSync(tempFile); } catch {} }

    const prompt = `You are a meeting intelligence assistant. Listen to this meeting recording and return a JSON object with exactly these fields:

{
  "transcript": "Full verbatim transcript of the meeting, with speaker labels (the person's name when known, otherwise 'Speaker 1', 'Speaker 2'...). Plain text, no timestamps needed.",
${PARTICIPANTS_FIELD}
${CORRECTIONS_FIELD}
  "summary": "A concise 2-4 paragraph executive summary covering the key topics discussed, decisions made, and outcomes.",
  "highlights": ["Key point 1", "Key point 2", ...],
  "tasks": [
    {
      "title": "Short imperative action item (max 80 chars)",
      "description": "Optional extra detail (max 200 chars or null)",
      "assignee_name": "Person's name if mentioned, or null",
      "priority": "High | Medium | Low"
    }
  ]
}

Return ONLY valid JSON. No markdown, no code blocks, no extra text.${PARTICIPANTS_RULES}${peoplePromptBlock(knownPeople, ownerId)}`;

    const parts = audioPart ? [audioPart, { text: prompt }] : [{ text: prompt }];

    const response = await generate(parts);

    const raw = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';

    // Strip markdown code fences if Gemini wraps in them anyway
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();

    const parsed = JSON.parse(cleaned);
    console.log(`Gemini done | transcript=${!!parsed.transcript} | tasks=${parsed.tasks?.length ?? 0} | highlights=${parsed.highlights?.length ?? 0}`);
    lastAiError = null;
    return parsed;
  } catch (err) {
    console.error('Gemini pipeline error:', err.message);
    lastAiError = friendlyAiError(err);
    if (/API key|API_KEY|PERMISSION_DENIED/i.test(String(err?.message))) { aiStatus.ok = false; aiStatus.error = lastAiError; }
    return null;
  }
}

// Fallback regex task extraction
function extractTasksFromTranscript(transcript, workspaceId, userId, meetingId) {
  if (!transcript) return [];
  const patterns = [
    /(?:action item|todo|to-do|task|follow.up|will|should|need to|going to|assigned to)[:\s]+([^.!?\n]{10,120})/gi,
    /(?:please|can you|could you|make sure)\s+([^.!?\n]{10,100})/gi,
  ];
  const seen  = new Set();
  const tasks = [];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(transcript)) !== null) {
      const title = m[1].trim().replace(/\s+/g, ' ');
      if (title.length > 10 && !seen.has(title.toLowerCase())) {
        seen.add(title.toLowerCase());
        tasks.push({
          workspace_id: workspaceId,
          meeting_id:   meetingId,
          created_by:   userId,
          title:        title.charAt(0).toUpperCase() + title.slice(1),
          priority:     'Medium',
          status:       'Open',
          ai_extracted: true,
        });
        if (tasks.length >= 10) break;
      }
    }
    if (tasks.length >= 10) break;
  }
  return tasks;
}

// Save meeting + AI results to Supabase
async function saveMeetingToSupabase(bot, audioUrl, workspaceId, aiResult, knownPeople = []) {
  const userId    = bot?.userId && bot.userId !== 'anonymous' ? bot.userId : null;
  const startedAt = bot?.startTime ? new Date(bot.startTime).toISOString() : new Date().toISOString();
  const endedAt   = bot?.endTime   ? new Date(bot.endTime).toISOString()   : new Date().toISOString();
  const durSecs   = bot?.startTime && bot?.endTime
    ? Math.round((new Date(bot.endTime) - new Date(bot.startTime)) / 1000)
    : null;

  const transcript = aiResult?.transcript || bot?.transcript || null;
  const summary    = aiResult?.summary    || (transcript ? 'Summary unavailable.' : 'No transcript captured.');
  const highlights = aiResult?.highlights || [];
  const aiTasks    = aiResult?.tasks      || [];

  const { data: meeting, error: mErr } = await supabase
    .from('meetings')
    .insert({
      workspace_id:   workspaceId,
      owner_id:       userId,
      title:          bot?.meetingTitle || `Meeting ${new Date(startedAt).toLocaleString('en-AU')}`,
      platform:       bot?.platform || 'zoom',
      meeting_url:    bot?.zoomLink || null,
      status:         'complete',
      audio_path:     audioUrl || null,
      transcript,
      summary,
      started_at:     startedAt,
      ended_at:       endedAt,
      duration_secs:  durSecs,
      task_count:     0,
      transcribed_at: transcript ? new Date().toISOString() : null,
      processed_at:   new Date().toISOString(),
    })
    .select('id')
    .single();

  if (mErr) { console.error('Meeting insert error:', mErr.message); return null; }

  const meetingId = meeting.id;

  await saveParticipants(meetingId, aiResult?.participants, knownPeople);

  // Highlights
  if (highlights.length > 0) {
    await supabase.from('meeting_highlights').insert(
      highlights.map((content, i) => ({
        meeting_id: meetingId,
        sort_order: i,
        content:    typeof content === 'string' ? content : JSON.stringify(content),
      }))
    );
  }

  // Tasks
  const taskRows = aiTasks.length > 0
    ? aiTasks.map(t => ({
        workspace_id:  workspaceId,
        meeting_id:    meetingId,
        created_by:    userId,
        title:         t.title,
        description:   t.description || null,
        assignee_name: t.assignee_name || null,
        assignee_id:   matchPerson(t.assignee_name, knownPeople)?.id || null,
        priority:      ['High','Medium','Low'].includes(t.priority) ? t.priority : 'Medium',
        status:        'Open',
        ai_extracted:  true,
      }))
    : extractTasksFromTranscript(transcript || '', workspaceId, userId, meetingId);

  if (taskRows.length > 0) {
    await supabase.from('tasks').insert(taskRows);
    await supabase.from('meetings').update({ task_count: taskRows.length }).eq('id', meetingId);
    await notifyAssignees(workspaceId, meetingId, taskRows, bot?.meetingTitle);
  }
  if (aiResult?.corrections?.length) console.log(`Transcript corrections: ${aiResult.corrections.length}`);

  console.log(`Meeting ${meetingId} saved | tasks=${taskRows.length} | highlights=${highlights.length}`);
  return meetingId;
}

// writeMeetingToSupabase (called after bot finishes)
async function writeMeetingToSupabase(bot, recordingUrl) {
  try {
    const userId = bot.userId && bot.userId !== 'anonymous' ? bot.userId : null;
    if (!userId) return;
    const { data: wm } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', userId)
      .limit(1)
      .maybeSingle();
    if (!wm?.workspace_id) return;
    await saveMeetingToSupabase(bot, recordingUrl, wm.workspace_id, null); // aiResult filled in processRecording
  } catch (err) {
    console.error('writeMeetingToSupabase error:', err.message);
  }
}

// Local recording endpoints (replaces the old browser-bot)
// The laptop running this server joins the meeting in the real Zoom / Teams
// desktop app and records system audio (via VB-CABLE). The meeting is opened
// with the app's own deep link (zoommtg:// / msteams:), which joins straight
// away - no "Launch meeting" browser page and no Join button to press - and
// because it is the genuine desktop client, Zoom's bot detection never fires.
let currentRecording = null; // { ffmpeg, audioPath, zoomLink, userId, workspaceId, startTime, platform }
const AUDIO_DEVICE   = process.env.AUDIO_DEVICE || 'CABLE Output (VB-Audio Virtual Cable)';
const BOT_DISPLAY_NAME = process.env.BOT_DISPLAY_NAME || 'ClarityMeet';
const AUTO_STOP      = process.env.AUTO_STOP !== 'false'; // stop + transcribe when the meeting window closes

// Only real meeting links may be opened on the host computer. Without this,
// any signed-in user could make the laptop open any URL, file path or
// protocol handler (e.g. file:// or ms-settings:) - effectively remote control.
const MEETING_HOSTS = ['zoom.us', 'teams.microsoft.com', 'teams.live.com', 'meet.google.com', 'webex.com'];
export function isAllowedMeetingLink(link) {
  try {
    const u = new URL(String(link || '').trim());
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return MEETING_HOSTS.some(d => h === d || h.endsWith('.' + d));
  } catch { return false; }
}

// Turn a normal meeting link into a link the desktop app joins directly.
// Returns null when there is no direct-join form (falls back to the browser).
export function toDirectJoinUrl(link) {
  let url;
  try { url = new URL(link.trim()); } catch { return null; }
  const host = url.hostname.toLowerCase();

  // Zoom: https://us05web.zoom.us/j/81234567890?pwd=abc  (also /w/ webinars and /s/ start links)
  if (host === 'zoom.us' || host.endsWith('.zoom.us')) {
    const m = url.pathname.match(/\/(?:j|w|s|wc\/join)\/(\d{9,12})/);
    if (!m) return null;
    const params = new URLSearchParams({ action: 'join', confno: m[1], uname: BOT_DISPLAY_NAME });
    const pwd = url.searchParams.get('pwd');
    if (pwd) params.set('pwd', pwd);
    return `zoommtg://zoom.us/join?${params.toString().replace(/\+/g, '%20')}`; // Zoom shows '+' literally
  }

  // Teams: https://teams.microsoft.com/l/meetup-join/...  ->  msteams:/l/meetup-join/...
  if (host === 'teams.microsoft.com' || host === 'teams.live.com') {
    if (!url.pathname.startsWith('/l/meetup-join/') && !url.pathname.startsWith('/meet/')) return null;
    return `msteams:${url.pathname}${url.search}`;
  }

  return null; // Google Meet etc. have no desktop app - opened in the browser.
}

function detectPlatformFromLink(link) {
  const l = (link || '').toLowerCase();
  if (l.includes('zoom.us')) return 'zoom';
  if (l.includes('teams.microsoft') || l.includes('teams.live')) return 'teams';
  if (l.includes('meet.google')) return 'google_meet';
  return 'other';
}

// Open a URL with the OS handler. On Windows we use rundll32 rather than
// `cmd /c start`, because cmd treats the "&" in meeting links as a command
// separator and silently cuts the link short.
function openWithOs(target) {
  const [cmd, args] =
    process.platform === 'win32'  ? ['rundll32', ['url.dll,FileProtocolHandler', target]] :
    process.platform === 'darwin' ? ['open', [target]] :
                                    ['xdg-open', [target]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
}

// Is a Zoom / Teams meeting window currently open? (Windows only; null = unknown)
function meetingWindowOpen(platform) {
  if (process.platform !== 'win32') return Promise.resolve(null);
  const image = platform === 'teams' ? 'ms-teams.exe' : platform === 'zoom' ? 'Zoom.exe' : null;
  if (!image) return Promise.resolve(null);
  return new Promise((resolve) => {
    const p = spawn('tasklist', ['/v', '/fo', 'csv', '/nh', '/fi', `imagename eq ${image}`]);
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.on('error', () => resolve(null));
    p.on('close', () => {
      // Last CSV column is the window title, e.g. "Zoom Meeting" while in a call.
      const titles = out.split(/\r?\n/).map(l => (l.match(/"([^"]*)"\s*$/) || [])[1] || '');
      resolve(titles.some(t => /meeting/i.test(t) && !/^zoom workplace$/i.test(t)));
    });
  });
}

let watchTimer = null;
function startMeetingWatcher(rec) {
  if (!AUTO_STOP || process.platform !== 'win32') return;
  let seen = false, missing = 0;
  const started = Date.now();
  watchTimer = setInterval(async () => {
    if (currentRecording !== rec) { clearInterval(watchTimer); watchTimer = null; return; }
    const open = await meetingWindowOpen(rec.platform);
    if (open === null) return;
    if (open) { seen = true; missing = 0; return; }
    // Only auto-stop after we have actually been in the meeting, and the
    // window has been gone for ~45 s (survives brief reconnects).
    if (seen && ++missing >= 3) {
      clearInterval(watchTimer); watchTimer = null;
      console.log('[record] meeting window closed - stopping automatically');
      const result = await stopAndProcessRecording();
      console.log('[record] auto-stop:', result.message || result.warning || result.error);
    }
    // Never joined within 15 min (e.g. stuck in a waiting room) - just keep recording; user can stop.
    if (!seen && Date.now() - started > 15 * 60_000) { /* no-op, keep waiting */ }
  }, 15_000);
}

app.post('/record/start', requireUser, async (req, res) => {
  if (currentRecording) {
    return res.status(409).json({ error: 'A recording is already in progress.' });
  }

  const { zoomLink, workspaceId } = req.body;
  const userId = req.user.id;
  if (zoomLink && !isAllowedMeetingLink(zoomLink)) {
    return res.status(400).json({ error: 'That is not a Zoom, Teams, Google Meet or Webex meeting link.' });
  }
  if (workspaceId && !(await isWorkspaceMember(userId, workspaceId))) {
    return res.status(403).json({ error: 'Not a member of that workspace.' });
  }
  // Compressed mono MP3 instead of raw WAV: a 1-hour WAV was ~600 MB+ and
  // multi-hour ones reached 3 GB, which Node cannot read into memory.
  const audioPath = join(RECORDINGS_DIR, `local_${Date.now()}.mp3`);

  const ffmpeg = spawn('ffmpeg', [
    '-y',
    '-f', 'dshow',
    '-i', `audio=${AUDIO_DEVICE}`,
    '-ac', '1', '-ar', '16000',
    '-c:a', 'libmp3lame', '-b:a', '48k',
    audioPath,
  ], { stdio: ['pipe', 'pipe', 'pipe'] }); // stdin open so we can send 'q' to stop cleanly
  // Drain output so ffmpeg never blocks on a full pipe during long meetings.
  ffmpeg.stdout.resume();
  ffmpeg.stderr.resume();

  ffmpeg.on('error', (err) => {
    console.error('ffmpeg failed to start:', err.message);
    currentRecording = null;
  });

  const platform = detectPlatformFromLink(zoomLink);
  currentRecording = {
    ffmpeg, audioPath, zoomLink: zoomLink || null, userId,
    workspaceId: workspaceId || null, startTime: new Date().toISOString(), platform,
  };

  let joinMode = 'none';
  if (zoomLink) {
    const direct = toDirectJoinUrl(zoomLink);
    openWithOs(direct || zoomLink);
    joinMode = direct ? 'auto' : 'browser';
  }
  startMeetingWatcher(currentRecording);

  console.log(`[record] started (${platform}, join=${joinMode}) - ${audioPath}`);
  res.json({ ok: true, joinMode, autoStop: AUTO_STOP && process.platform === 'win32' });
});

// Stop ffmpeg, then transcribe + save in the background. Used by the Stop
// button and by the auto-stop watcher.
async function stopAndProcessRecording() {
  const rec = currentRecording;
  if (!rec) return { status: 409, error: 'No recording in progress.' };
  currentRecording = null;
  if (watchTimer) { clearInterval(watchTimer); watchTimer = null; }

  const { ffmpeg, audioPath, zoomLink, userId, workspaceId: recWorkspaceId, startTime, platform } = rec;

  // Ask ffmpeg to quit ('q') so it finalises the file properly; a hard kill
  // can leave a truncated/corrupt file. Force-kill only if it hangs.
  await new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    ffmpeg.once('close', finish);
    try { ffmpeg.stdin.write('q'); ffmpeg.stdin.end(); } catch {}
    setTimeout(() => { try { ffmpeg.kill(); } catch {} }, 5000);
    setTimeout(finish, 8000);
  });

  if (!existsSync(audioPath)) {
    return { status: 500, error: 'No audio file was created - check audio routing.' };
  }

  const sizeKb = Math.round(statSync(audioPath).size / 1024);
  if (sizeKb < 20) {
    try { unlinkSync(audioPath); } catch {}
    return { status: 200, warning: `Recording is only ${sizeKb} KB - likely no audio captured. Check CABLE Input is set as default playback device.` };
  }

  // Process async - the dashboard picks the meeting up when it's saved.
  (async () => {
    try {
      // Save into the workspace that was active when recording started,
      // falling back to the user's first workspace.
      let targetWorkspace = recWorkspaceId;
      if (!targetWorkspace) {
        const { data: wm } = await supabase
          .from('workspace_members').select('workspace_id')
          .eq('user_id', userId).limit(1).maybeSingle();
        targetWorkspace = wm?.workspace_id || null;
      }
      const knownPeople = await getKnownPeople(targetWorkspace, userId);
      const aiResult = await runGeminiPipeline(audioPath, { knownPeople, ownerId: userId });

      let publicUrl = null;
      try {
        const fileBuffer = readFileSync(audioPath);
        // Unguessable name inside the workspace's folder (storage rules only
        // let members of that workspace read it).
        const fileName = `${targetWorkspace || 'unassigned'}/${crypto.randomUUID()}.mp3`;
        const { error } = await supabase.storage.from(STORAGE_BUCKET)
          .upload(fileName, fileBuffer, { contentType: 'audio/mpeg', upsert: false });
        if (!error) publicUrl = fileName; // stored as audio_path (a storage path, not a public link)
      } catch (err) {
        console.error('Storage upload failed:', err.message);
      }

      if (targetWorkspace) {
        await saveMeetingToSupabase(
          { userId, zoomLink, platform, startTime, endTime: new Date().toISOString() },
          publicUrl, targetWorkspace, aiResult, knownPeople
        );
      } else {
        console.warn('[record] user has no workspace - meeting not saved');
      }

      try { unlinkSync(audioPath); } catch {}
    } catch (err) {
      console.error('[record] processing error:', err.message);
    }
  })();

  return { status: 200, message: 'Recording stopped - transcribing now (this can take a minute).' };
}

app.post('/record/stop', requireUser, async (req, res) => {
  if (!currentRecording) {
    return res.status(409).json({ error: 'No recording in progress.' });
  }
  if (currentRecording.userId !== req.user.id) {
    return res.status(403).json({ error: 'This recording was started by another user.' });
  }
  const { status, ...body } = await stopAndProcessRecording();
  res.status(status).json(status === 200 ? { ok: true, ...body } : body);
});

app.get('/record/status', requireUser, (_req, res) => {
  res.json({
    recording: !!currentRecording,
    startTime: currentRecording?.startTime ?? null,
    zoomLink:  currentRecording?.zoomLink ?? null,
    autoStop:  AUTO_STOP && process.platform === 'win32',
  });
});

// POST /join
app.post('/join', requireUser, async (req, res) => {

  const { zoomLink } = req.body;
  const userId = req.user.id;
  if (!zoomLink) return res.status(400).json({ error: 'zoomLink required' });
  if (!isAllowedMeetingLink(zoomLink)) return res.status(400).json({ error: 'Not a supported meeting link.' });

  // All bots share a single persistent Chrome profile (for reCAPTCHA trust-building),
  // so only ONE bot can ever run at a time - Chrome locks the profile dir and a second
  // launch attempt fails instantly otherwise.
  for (const [, bot] of activeBots) {
    if (!['completed', 'error', 'stopped'].includes(bot.status)) {
      return res.status(409).json({ error: 'A bot is already running. Only one bot can run at a time (shared Chrome profile). Wait for it to finish or stop it first.' });
    }
  }

  const botId   = `bot_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
  const botName = 'ClarityBot';
  const bot = {
    id: botId, botName, zoomLink,
    userId: userId || 'anonymous',
    status: 'spawning', startTime: new Date().toISOString(),
    endTime: null, logs: [], webmPath: null,
    recordingStatus: 'none', recordingUrl: null, transcript: null,
    process: null,
  };
  activeBots.set(botId, bot);

  const child = spawn('node', [
    join(__dirname, 'zoom-bot.js'), zoomLink, botId, userId || 'anonymous', botName,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  bot.process = child;

  let stdoutBuf = '';
  child.stdout.on('data', chunk => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split('\n');
    stdoutBuf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try { handleBotEvent(bot, JSON.parse(trimmed)); }
      catch { bot.logs.push(trimmed.slice(0, 200)); }
    }
  });
  child.stderr.on('data', d => {
    const msg = d.toString().trim().slice(0, 200);
    if (msg) bot.logs.push(`[err] ${msg}`);
  });
  child.on('close', code => {
    if (!['completed','error'].includes(bot.status)) {
      bot.status = code === 0 ? 'completed' : 'error';
      bot.endTime = new Date().toISOString();
    }
    bot.process = null;
  });

  res.json({ botId, status: 'spawning' });
});

// Handle bot events
async function handleBotEvent(bot, evt) {
  const { event } = evt;
  const logLine = evt.message ? `[${event}] ${evt.message}` : `[${event}]`;
  bot.logs.push(logLine);
  // Mirror all bot events to stdout so they appear in `fly logs` even after machine restart
  console.log(`[bot:${bot.id}] ${logLine}`);
  switch (event) {
    case 'spawned':           bot.status = 'spawning';   break;
    case 'browser_launching': bot.status = 'launching';  break;
    case 'navigating':        bot.status = 'navigating'; break;
    case 'joining':           bot.status = 'joining';    break;
    case 'joined':            bot.status = 'joined';     break;
    case 'audio_start':
      bot.status = 'recording'; bot.recordingStatus = 'recording';
      bot.webmPath = evt.webmPath || null;
      bot.mp3Path  = evt.mp3Path  || null; break;
    case 'transcript_chunk':
      bot.transcript = (bot.transcript || '') + ' ' + (evt.text || ''); break;
    case 'leaving': bot.status = 'stopping'; break;
    case 'recording_stopped':
      bot.status = 'processing'; bot.recordingStatus = 'converting';
      bot.endTime = new Date().toISOString();
      processRecording(bot, evt.mp3Path || evt.webmPath || bot.mp3Path || bot.webmPath); break;
    case 'completed':
      if (bot.status !== 'processing') {
        bot.status = 'completed';
        bot.endTime = bot.endTime || new Date().toISOString();
      }
      break;
    case 'error':
      bot.status = 'error'; bot.endTime = new Date().toISOString();
      bot.logs.push(`Error: ${evt.message}`); break;
  }
}

// Convert -> upload -> Gemini -> save
async function processRecording(bot, webmPath) {
  try {
    if (!webmPath || !existsSync(webmPath)) {
      console.log(`No recording at ${webmPath} - skipping`);
      bot.status = 'completed'; bot.recordingStatus = 'failed';
      await writeMeetingToSupabase(bot, null);
      return;
    }

    // 1. Convert webm->mp3 (skip if already mp3 from ffmpeg PulseAudio capture)
    bot.recordingStatus = 'converting';
    const mp3Path = webmPath.endsWith('.mp3')
      ? webmPath
      : await convertToMp3(webmPath);

    // 2. Run Gemini on the LOCAL mp3 (before upload - no round-trip needed)
    bot.recordingStatus = 'transcribing';
    const aiResult = await runGeminiPipeline(mp3Path);
    if (aiResult?.transcript) bot.transcript = aiResult.transcript;

    // 3. Upload to Supabase Storage
    bot.recordingStatus = 'uploading';
    const publicUrl = await uploadToSupabase(mp3Path, bot.id);
    bot.recordingUrl = publicUrl;
    bot.recordingStatus = 'done';
    bot.status = 'completed';

    // 4. Save everything to DB
    const userId = bot.userId && bot.userId !== 'anonymous' ? bot.userId : null;
    if (userId) {
      const { data: wm } = await supabase
        .from('workspace_members').select('workspace_id')
        .eq('user_id', userId).limit(1).maybeSingle();
      if (wm?.workspace_id) {
        await saveMeetingToSupabase(bot, publicUrl, wm.workspace_id, aiResult);
      }
    }

    // 5. Cleanup local files
    try { unlinkSync(mp3Path); } catch {}
    if (webmPath && webmPath !== mp3Path) { try { unlinkSync(webmPath); } catch {} }
  } catch (err) {
    console.error('processRecording error:', err.message);
    bot.recordingStatus = 'failed'; bot.status = 'completed';
    await writeMeetingToSupabase(bot, null);
  }
}

// POST /transcribe (called by upload page)
app.post('/transcribe', requireUser, async (req, res) => {
  const { meetingId, storagePath, workspaceId } = req.body;
  const userId = req.user.id;
  // Only files inside this workspace's storage folder may be processed. The
  // server never fetches a client-supplied URL (that was an SSRF hole: any
  // user could make the host laptop request internal addresses).
  if (storagePath && (typeof storagePath !== 'string' || !storagePath.startsWith(`${workspaceId}/`) || storagePath.includes('..'))) {
    return res.status(400).json({ error: 'Invalid file path.' });
  }
  if (!meetingId || !workspaceId) {
    return res.status(400).json({ error: 'meetingId and workspaceId are required' });
  }
  if (!(await isWorkspaceMember(userId, workspaceId))) {
    return res.status(403).json({ error: 'Not a member of that workspace.' });
  }
  const { data: mtgCheck } = await supabase
    .from('meetings').select('id').eq('id', meetingId).eq('workspace_id', workspaceId).maybeSingle();
  if (!mtgCheck) {
    return res.status(404).json({ error: 'Meeting not found in that workspace.' });
  }

  res.json({ ok: true, message: 'Gemini AI pipeline started' });

  (async () => {
    try {
      await supabase.from('meetings').update({ status: 'processing' }).eq('id', meetingId);

      // Run Gemini on the audio URL (or just summarise if transcript already in DB)
      let aiResult = null;
      const knownPeople = await getKnownPeople(workspaceId, userId);
      if (storagePath) {
        const { data: blob, error: dlErr } = await supabase.storage.from(STORAGE_BUCKET).download(storagePath);
        if (dlErr || !blob) throw new Error(`Download failed: ${dlErr?.message || 'no data'}`);
        const tmp = join(tmpdir(), `cm_${crypto.randomUUID()}${extname(storagePath) || '.bin'}`);
        writeFileSync(tmp, Buffer.from(await blob.arrayBuffer()));
        try {
          aiResult = await runGeminiPipeline(tmp, { knownPeople, ownerId: userId });
        } finally {
          try { unlinkSync(tmp); } catch {}
        }
      } else {
        // Fetch existing transcript from DB and run text-only summary
        const { data: mtg } = await supabase
          .from('meetings').select('transcript').eq('id', meetingId).single();
        const transcript = (mtg)?.transcript;
        if (transcript) {
          aiResult = await runGeminiTextPipeline(transcript, { knownPeople, ownerId: userId });
        }
      }

      if (!aiResult) {
        const reason = !gemini ? 'The Gemini API key is not set on the server.' : (lastAiError || 'The AI could not process this file.');
        await supabase.from('meetings').update({ status: 'failed', summary: null }).eq('id', meetingId);
        await supabase.from('uploads').update({ status: 'failed', error_message: reason }).eq('meeting_id', meetingId);
        console.error(`/transcribe failed for meeting ${meetingId}: ${reason}`);
        return;
      }

      const transcript = aiResult?.transcript || null;
      const summary    = aiResult?.summary    || (transcript ? 'Summary unavailable.' : 'No transcript.');
      const highlights = aiResult?.highlights || [];
      const aiTasks    = aiResult?.tasks      || [];

      await supabase.from('meetings').update({
        transcript:     transcript || undefined,
        summary,
        status:         'complete',
        transcribed_at: transcript ? new Date().toISOString() : null,
        processed_at:   new Date().toISOString(),
      }).eq('id', meetingId);

      await supabase.from('meeting_participants').delete().eq('meeting_id', meetingId);
      await saveParticipants(meetingId, aiResult?.participants, knownPeople);

      await supabase.from('meeting_highlights').delete().eq('meeting_id', meetingId);
      if (highlights.length > 0) {
        await supabase.from('meeting_highlights').insert(
          highlights.map((content, i) => ({ meeting_id: meetingId, sort_order: i, content: String(content) }))
        );
      }

      const taskRows = aiTasks.length > 0
        ? aiTasks.map(t => ({
            workspace_id:  workspaceId,
            meeting_id:    meetingId,
            created_by:    userId || null,
            title:         t.title,
            description:   t.description || null,
            assignee_name: t.assignee_name || null,
            assignee_id:   matchPerson(t.assignee_name, knownPeople)?.id || null,
            priority:      ['High','Medium','Low'].includes(t.priority) ? t.priority : 'Medium',
            status:        'Open',
            ai_extracted:  true,
          }))
        : extractTasksFromTranscript(transcript || '', workspaceId, userId || null, meetingId);

      if (taskRows.length > 0) {
        await supabase.from('tasks').insert(taskRows);
        await supabase.from('meetings').update({ task_count: taskRows.length }).eq('id', meetingId);
        await notifyAssignees(workspaceId, meetingId, taskRows, null);
      }

      await supabase.from('uploads').update({ status: 'complete', error_message: null }).eq('meeting_id', meetingId);
      console.log(`/transcribe done for meeting ${meetingId} | tasks=${taskRows.length}`);
    } catch (err) {
      console.error('/transcribe error:', err.message);
      try {
        await supabase.from('meetings').update({ status: 'failed' }).eq('id', meetingId);
        await supabase.from('uploads').update({ status: 'failed', error_message: friendlyAiError(err) }).eq('meeting_id', meetingId);
      } catch {}
    }
  })();
});

// Text-only Gemini pipeline (for pasted transcripts)
async function runGeminiTextPipeline(transcript, { knownPeople = [], ownerId = null } = {}) {
  if (!gemini || !transcript) return null;
  try {
    const prompt = `You are a meeting intelligence assistant. Given this meeting transcript, return a JSON object with:
{
  "transcript": "The same transcript with misheard words fixed and speaker labels kept",
${CORRECTIONS_FIELD}
  "summary": "2-4 paragraph executive summary",
${PARTICIPANTS_FIELD}
  "highlights": ["key point 1", "key point 2", ...],
  "tasks": [{ "title": "action item", "description": null, "assignee_name": null, "priority": "High|Medium|Low" }]
}
Return ONLY valid JSON. No markdown.${PARTICIPANTS_RULES}${peoplePromptBlock(knownPeople, ownerId)}

Transcript:
${transcript.slice(0, 15000)}`;

    const response = await generate([{ text: prompt }]);

    const raw     = response.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    const parsed  = JSON.parse(cleaned);
    lastAiError = null;
    return { transcript, ...parsed };
  } catch (err) {
    console.error('Gemini text pipeline error:', err.message);
    lastAiError = friendlyAiError(err);
    return null;
  }
}

// Zoom webhook helpers

// Download a Zoom cloud recording and process it through Gemini
async function processZoomRecording({ downloadUrl, downloadToken, meetingTopic, meetingId, startTime, userId, workspaceId }) {
  console.log(`Zoom webhook: processing recording for meeting ${meetingId}`);
  const localPath = join(RECORDINGS_DIR, `zoom_${meetingId}_${Date.now()}.mp4`);

  try {
    // Download the recording (Zoom requires Authorization header)
    const headers = { 'Authorization': `Bearer ${downloadToken}` };
    const res = await fetch(downloadUrl, { headers });
    if (!res.ok) throw new Error(`Zoom download failed: ${res.status} ${res.statusText}`);

    const buf = Buffer.from(await res.arrayBuffer());
    const { writeFileSync } = await import('fs');
    writeFileSync(localPath, buf);
    console.log(`Downloaded ${Math.round(buf.length / 1024)}KB`);

    // Convert to mp3 via ffmpeg
    const mp3Path = localPath.replace(/\.[^.]+$/, '.mp3');
    await new Promise((resolve, reject) => {
      const ff = spawn('ffmpeg', ['-y', '-i', localPath, '-vn', '-ar', '16000', '-ac', '1', '-ab', '64k', mp3Path]);
      ff.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg code ${code}`)));
    });

    // Run Gemini (with the team's names so they're spelled correctly)
    const knownPeople = await getKnownPeople(workspaceId, userId);
    const aiResult = await runGeminiPipeline(mp3Path, { knownPeople, ownerId: userId });

    // Upload mp3 to Supabase Storage
    const fileName  = `${workspaceId}/${crypto.randomUUID()}.mp3`;
    const fileBuf   = readFileSync(mp3Path);
    const { error: upErr } = await supabase.storage.from(STORAGE_BUCKET).upload(fileName, fileBuf, { contentType: 'audio/mpeg', upsert: false });
    const publicUrl = upErr ? null : fileName; // storage path

    // Build a fake bot object so saveMeetingToSupabase works
    const fakeBot = {
      userId,
      meetingTitle: meetingTopic || `Zoom Meeting ${meetingId}`,
      platform: 'zoom',
      zoomLink: null,
      startTime: startTime || new Date().toISOString(),
      endTime: new Date().toISOString(),
      transcript: aiResult?.transcript || null,
    };

    await saveMeetingToSupabase(fakeBot, publicUrl, workspaceId, aiResult, knownPeople);

    // Cleanup
    try { unlinkSync(localPath); } catch {}
    try { unlinkSync(mp3Path);   } catch {}

    console.log(`Zoom meeting ${meetingId} processed and saved to dashboard`);
  } catch (err) {
    console.error(`Zoom recording processing error:`, err.message);
    try { unlinkSync(localPath); } catch {}
  }
}

// POST /webhook/zoom
// Receives Zoom webhook events. Two event types handled:
//   endpoint.url_validation - Zoom sends this once to verify the endpoint
//   recording.completed - sent when cloud recording is ready to download
// Middleware that captures raw body for HMAC verification while also parsing JSON
const zoomRawBodyParser = express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
});

app.post('/webhook/zoom', zoomRawBodyParser, async (req, res) => {
  const ZOOM_SECRET = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
  const { event, payload: data } = req.body || {};

  console.log(`Zoom webhook event: ${event}`);

  // URL validation - ALWAYS respond, no signature check needed
  // Zoom sends this to verify endpoint ownership. Must respond with HMAC of plainToken.
  if (event === 'endpoint.url_validation') {
    const plainToken = data?.plainToken || '';
    const encryptedToken = crypto
      .createHmac('sha256', ZOOM_SECRET || '')
      .update(plainToken)
      .digest('hex');
    console.log(`Zoom URL validation success - plainToken: ${plainToken}`);
    return res.status(200).json({ plainToken, encryptedToken });
  }

  // Signature verification (all other events)
  // Without a secret anyone could post fake "recording.completed" events.
  if (!ZOOM_SECRET) {
    return res.status(503).json({ error: 'Webhook secret not configured' });
  }
  {
    const timestamp  = req.headers['x-zm-request-timestamp'];
    if (!timestamp || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      return res.status(401).json({ error: 'Stale or missing timestamp' });
    }
    const signature  = req.headers['x-zm-signature'];
    const rawBody    = req.rawBody ? req.rawBody.toString() : JSON.stringify(req.body);
    const message    = `v0:${timestamp}:${rawBody}`;
    const expected   = 'v0=' + crypto.createHmac('sha256', ZOOM_SECRET).update(message).digest('hex');
    const sigOk = typeof signature === 'string' && signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!sigOk) {
      console.warn('Zoom webhook: signature mismatch - ignoring');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // Recording completed
  if (event === 'recording.completed') {
    res.status(200).json({ ok: true }); // Respond immediately so Zoom doesn't retry

    const recording  = data?.object;
    const meetingId  = recording?.id;
    const topic      = recording?.topic;
    const startTime  = recording?.start_time;
    const hostEmail  = recording?.host_email;
    const files      = recording?.recording_files || [];
    const token      = data?.download_token;

    // Find the best audio/video file to download
    // Prefer: audio_only MP4 > shared_screen_with_speaker_view > active_speaker
    const preferred = ['audio_only', 'shared_screen_with_speaker_view', 'active_speaker', 'gallery_view'];
    let bestFile = null;
    for (const type of preferred) {
      bestFile = files.find(f => f.recording_type === type && f.status === 'completed');
      if (bestFile) break;
    }
    if (!bestFile) bestFile = files.find(f => f.status === 'completed');

    if (!bestFile) {
      console.warn(`Zoom webhook: no completed recording file found for meeting ${meetingId}`);
      return;
    }
    try {
      const dl = new URL(bestFile.download_url);
      if (dl.protocol !== 'https:' || !(dl.hostname === 'zoom.us' || dl.hostname.endsWith('.zoom.us'))) {
        console.warn('Zoom webhook: download URL is not on zoom.us - ignoring');
        return;
      }
    } catch { return; }

    // Look up which ClarityMeet user owns this Zoom account by email
    let userId     = null;
    let workspaceId = null;
    if (hostEmail) {
      const { data: profile } = await supabase
        .from('users')
        .select('id')
        .eq('email', hostEmail)
        .maybeSingle();
      if (profile?.id) {
        userId = profile.id;
        const { data: wm } = await supabase
          .from('workspace_members')
          .select('workspace_id')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle();
        workspaceId = wm?.workspace_id || null;
      }
    }

    if (!workspaceId) {
      // meetings.workspace_id is required, so there is nowhere to save it.
      console.warn(`Zoom webhook: no ClarityMeet workspace found for host email ${hostEmail} - skipping`);
      return;
    }

    // Process async (don't block the response)
    processZoomRecording({
      downloadUrl:   bestFile.download_url,
      downloadToken: token,
      meetingTopic:  topic,
      meetingId:     String(meetingId),
      startTime,
      userId,
      workspaceId,
    });

    return;
  }

  // All other events - just acknowledge
  res.status(200).json({ ok: true });
});

// REST endpoints
// POST /notify-invite-accepted
// Called by /invite/accept page after a user joins a workspace.
// Uses service role (bypasses RLS) to write notification rows for all admins.
app.post('/notify-invite-accepted', requireUser, async (req, res) => {
  const { workspaceId, joinerName, workspaceName, role } = req.body;
  if (!workspaceId || !joinerName) {
    return res.status(400).json({ error: 'workspaceId and joinerName are required' });
  }
  // Only someone who actually joined may announce it.
  if (!(await isWorkspaceMember(req.user.id, workspaceId))) {
    return res.status(403).json({ error: 'Not a member of that workspace.' });
  }
  try {
    const { data: admins } = await supabase
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('role', 'admin');

    if (admins?.length) {
      await Promise.all(admins.map(a =>
        supabase.from('notifications').insert({
          user_id:      a.user_id,
          workspace_id: workspaceId,
          type:         'success',
          title:        `${joinerName} joined ${workspaceName}`,
          body:         `${joinerName} accepted your invite and is now a ${role ?? 'member'} of ${workspaceName}.`,
          link:         '/settings',
          read:         false,
        })
      ));
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[notify-invite-accepted]', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Unknown error' });
  }
});

app.get('/health', (_req, res) => res.json({
  status: 'ok', bots: activeBots.size,
  ai_enabled: !!gemini && aiStatus.ok, ai_error: aiStatus.error,
  ai_model: aiStatus.model || GEMINI_MODELS[0],
  ts: Date.now(),
}));

// Checks the Gemini key once at start-up so a bad key shows up straight away.
if (gemini) {
  gemini.models.get({ model: GEMINI_MODELS[0] })
    .then(() => { aiStatus.ok = true; aiStatus.checked = Date.now(); console.log(`Gemini key OK (${GEMINI_MODELS.join(', ')})`); })
    .catch(err => {
      aiStatus.checked = Date.now();
      if (/API key|API_KEY|PERMISSION_DENIED|400|401|403/i.test(String(err?.message))) {
        aiStatus.ok = false; aiStatus.error = friendlyAiError(err);
        console.error('Gemini key check failed:', String(err?.message).slice(0, 200));
      }
    });
}

app.get('/bots', requireUser, (req, res) => {
  const bots = [...activeBots.values()].filter(b => b.userId === req.user.id).map(b => ({
    id: b.id, botName: b.botName, zoomLink: b.zoomLink,
    userId: b.userId, status: b.status,
    startTime: b.startTime, endTime: b.endTime,
    recordingStatus: b.recordingStatus, recordingUrl: b.recordingUrl,
  }));
  res.json({ bots });
});

app.get('/bots/:botId', requireUser, (req, res) => {
  const bot = activeBots.get(req.params.botId);
  if (!bot || bot.userId !== req.user.id) return res.status(404).json({ error: 'Bot not found' });
  res.json({
    botId: bot.id, status: bot.status, logs: bot.logs,
    startTime: bot.startTime, endTime: bot.endTime,
    recordingStatus: bot.recordingStatus, recordingUrl: bot.recordingUrl,
  });
});

app.post('/stop/:botId', requireUser, (req, res) => {
  const bot = activeBots.get(req.params.botId);
  if (!bot || bot.userId !== req.user.id) return res.status(404).json({ error: 'Bot not found' });
  if (bot.process) { bot.status = 'stopping'; bot.process.kill('SIGTERM'); }
  res.json({ ok: true });
});

app.use((err, _req, res, _next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`ClarityMeet Bot Server on port ${PORT}`);
  console.log(`Recordings -> ${RECORDINGS_DIR}`);
  console.log(`Supabase -> ${process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL}`);
  console.log(`AI -> ${gemini ? 'Gemini 2.5 Flash (FREE tier)' : 'DISABLED - set GEMINI_API_KEY'}`);
}).on('error', err => {
  if (err.code === 'EADDRINUSE') { console.error(`\nPort ${PORT} in use.\n`); process.exit(1); }
  throw err;
});