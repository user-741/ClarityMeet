# ClarityMeet

ClarityMeet is a meeting assistant for recording sessions, generating summaries, and extracting tasks.


## Usage
When you run the script, 3 terminal will open, one being the url to share.

```powershell
# frontend
npm run dev

# backend
Set-Location .\Backend
npm run dev
```

To expose the frontend manually:

```powershell
cloudflared tunnel --url http://localhost:3000
```

## Running the backend in the background

The live site only needs the backend. To keep it running while you use the laptop for other things:

```powershell
.\run-server.ps1          # start in the background
.\run-server.ps1 -Status  # check it
.\run-server.ps1 -Stop    # stop it
```

## Project layout

- `app/` - Next.js application routes and UI
- `Backend/` - local bot server and meeting processing logic
- `lib/` - shared client and type helpers
- `supabase/` - database-related files

## Notes

- This workspace is set up for local development on Windows.
- The public tunnel URL changes each time `cloudflared` starts.

## Calendar

- **Google Calendar**: Calendar > Connect calendar > Sign in with Google. Imports events and lets you create meetings with a Google Meet link. Pasting the secret iCal link also works.
- **Outlook**: publish the calendar in Outlook on the web and paste the ICS link.
- **iPhone / iCloud**: make the calendar public in the Calendar app, then paste the share link.
- **Add to phone**: Calendar > Add to phone gives a subscribe link so ClarityMeet meetings show in the iPhone, Google or Outlook calendar.

Connected calendars re-sync when the Calendar page is opened if they are older than 15 minutes.

## Two-step verification

Settings > Security. Use an authenticator app or a code sent by email. Once on, every new sign-in asks for a code.

## Team

- Chris Bobby (s8136772)
- Muhammad Taha (s8128767)
- Perneil Calimlim (s8076141)
- Latif Naderi (s8128953)
