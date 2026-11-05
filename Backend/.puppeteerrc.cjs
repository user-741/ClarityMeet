/**
 * .puppeteerrc.cjs
 *
 * On Linux (Docker/Fly.io): use system Chromium from apt.
 * On Windows (local dev): let Puppeteer use its own downloaded Chrome.
 */
module.exports = process.platform === 'linux'
  ? { executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || '/usr/bin/chromium' }
  : {};
