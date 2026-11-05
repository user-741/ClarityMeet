# ClarityMeet Backend

This folder contains the local backend used for recording meetings, processing audio, and saving results to Supabase.

## What it does

- exposes the local API used by the frontend
- starts and manages meeting bot processes
- handles recording and transcription flow
- stores summaries, highlights, and tasks

## Run locally

From the `Backend` folder:

```powershell
npm run dev
```

The backend listens on port `3001` in the current local setup.

## Required environment variables

Create a local `.env` file with values for:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
ZOOM_BOT_EMAIL=
ZOOM_BOT_PASSWORD=
PORT=3001
```

If you are using the one-command launcher from the project root, it handles the frontend and tunnel separately.

## Main endpoints

- `GET /health`
- `GET /record/status`
- `POST /record/start`
- `POST /record/stop`
- `POST /join`
- `POST /transcribe`

## Notes

- This backend is intended for local development.
- Supabase service credentials should remain in backend-only environment files.
- The public sharing link is provided by `cloudflared` from the project root, not by this folder itself.

## Team

- Latif Naderi (s8128953)
- Chris Bobby (s8136772)
- Muhammad Taha (s8128767)
- Perneil Calimlim (s8076141)

## Hands-free meeting joining (host laptop)

When someone pastes a meeting link on the Bot page (from any device), the
backend on the host laptop:

1. Opens the meeting straight in the **Zoom / Teams desktop app** using its
   direct-join link (`zoommtg://...` / `msteams:...`), joining as
   `ClarityMeet` - no "Launch meeting" page and no Join button.
2. Records system audio through VB-CABLE (compressed MP3).
3. Watches the meeting window; when it closes, recording stops by itself and
   the transcript, summary and tasks are generated.

One-time Zoom settings on the host laptop (Zoom -> Settings):

- **Audio -> "Automatically join audio by computer when joining a meeting"**: ON
- **Video -> "Always show video preview dialog when joining a video meeting"**: OFF
- **Video -> "Stop my video when joining a meeting"**: ON (optional)
- **Audio -> Speaker**: `CABLE Input (VB-Audio Virtual Cable)` so the call is recorded

If the host has a waiting room on, they still need to admit ClarityMeet.
Google Meet has no desktop app, so Meet links open in the browser and need one click.

Optional `.env` settings: `BOT_DISPLAY_NAME`, `AUDIO_DEVICE`, `AUTO_STOP=false`
(to disable auto-stop).
