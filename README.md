# ClarityMeet

ClarityMeet joins your meetings, records them, and turns them into a summary and a task list your team can act on.

Live site: [claritymeet.vercel.app](https://claritymeet.vercel.app)

## Features

- **Meeting bot**: paste a Zoom or Teams link and the bot joins, records the audio and leaves when the meeting ends
- **Summaries and tasks**: transcripts are turned into a short summary, key points and action items with owners and due dates
- **Upload**: drop in an existing recording instead of using the bot
- **Calendar**: connect Google Calendar, Outlook or iCloud, and subscribe to your ClarityMeet meetings from your phone
- **Teams**: shared workspaces, invites, task assignment and an activity log
- **Search and analytics**: search across past meetings and see meeting and task stats
- **Security**: two-step verification with an authenticator app or email code

## Tech stack

| Part | Tools |
| --- | --- |
| Frontend | Next.js, React, TypeScript, Framer Motion |
| Backend | Node.js, Express, Puppeteer |
| Database and auth | Supabase (Postgres, Auth, Storage) |
| AI | Google Gemini for transcription and summaries |
| Hosting | Vercel (frontend), self-hosted backend |

## Project layout

- `app/` Next.js routes, pages and UI components
- `Backend/` bot server, recording and meeting processing
- `lib/` shared helpers and types
- `supabase/` database schema
- `tests/` unit tests

## Run locally

Requires Node.js 20 or newer and a Supabase project.

1. Copy `.env.local.example` to `.env.local` and `Backend/.env.example` to `Backend/.env`, then fill in your own values.
2. Install and start the frontend:

   ```powershell
   npm install
   npm run dev
   ```

3. In a second terminal, start the backend:

   ```powershell
   cd Backend
   npm install
   npm run dev
   ```

The frontend runs on http://localhost:3000 and the backend on port 3001. To share a local copy, run `cloudflared tunnel --url http://localhost:3000`.

To keep the backend running in the background on Windows:

```powershell
.\run-server.ps1          # start
.\run-server.ps1 -Status  # check
.\run-server.ps1 -Stop    # stop
```

## Tests

```powershell
npm test
```

## Team

- Latif Naderi (founder, lead developer: architecture, backend and the meeting bot server)
- Chris Bobby
- Muhammad Taha
- Perneil Calimlim
