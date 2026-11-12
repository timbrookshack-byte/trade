# Contractor sign-in kiosk & timesheets

A standalone app, separate from the trade portal. It runs on the warehouse laptop in Chrome, and contractor workers use it to sign in and out. Management gets a record of hours actually worked on site, to check against the timesheets that contract companies submit.

It runs as a Cloudflare Worker with a D1 database (SQLite). The weekly email goes out through Resend, the same account the trade portal uses. There are no frameworks or build step: the pages are server-rendered HTML with a small amount of inline JavaScript.

## How it works

**Kiosk (`/`)** works only on a laptop the manager has set up (see below).
- Workers tap their name. Each name card shows the contract company and today's status (not signed in / on site since 7:02am / finished).
- **New here?** A worker enters first name, surname, mobile, contract company and ticks *"I have been inducted and I am aware of the workplace rules and regulations"*. They are then taken straight to sign-in. A mobile number can only be registered once.
- **Arrive**: the time is taken from the server clock and the worker can't change it. They get a friendly welcome message, which changes with the time of day and has Monday and Friday versions.
- **Finish for the day**: the worker answers *"Did you have a break?"* (Yes/No, and if yes 15/30/45/60/90 min). They then see a thank-you message, plus Friday/weekend wording, and a summary of the day (times, break, hours worked).
- **Override with manager**: the worker enters a different arrival or finish time and a reason, and Alex enters the manager code. Each override is logged with the time the button was actually pressed, the new time and the reason. It shows as **⚑ manager override** in reports.
- After 5 wrong manager codes in 15 minutes, code entry is locked for 15 minutes.

**Manager area (`/admin`)** uses the same manager code.
- *Weekly hours*: a Mon–Sun table grouped by contract company. Each day shows in–out, break and hours, and each worker has a weekly total in hours and minutes and in decimal hours. Shifts with no sign-out are highlighted in red and left out of totals. Below the table is a log of overrides and edits.
- Click any day to correct a shift, add a missed one or delete a wrong-person tap. A reason is required and the change goes into the log.
- **Download CSV**, and **Email summary** to send it now.
- *Workers*: edit details, or hide people who have left from the kiosk. Their hours are kept.

**Weekly email**: every **Monday 5:00am Brisbane time**, the cron `0 19 * * SUN` (UTC) emails the previous Mon–Sun to `SUMMARY_TO` (sgreen@thefurnitureshack.com.au). It contains the same table plus a CSV attachment. The email is sent once per week, so a retried cron can't send it twice.

Hours worked = sign-out − sign-in − break. All times are in Australia/Brisbane.

## Deploy (one-time)

```bash
cd timesheet
npm install
npx wrangler d1 create timesheet        # paste the printed database_id into wrangler.jsonc
npm run db:migrate
npx wrangler secret put MANAGER_CODE    # Alex's code (digits recommended, 4–6+)
npx wrangler secret put SESSION_SECRET  # any long random string
npx wrangler secret put RESEND_API_KEY  # same Resend account as the portal
npm run deploy
```

`EMAIL_FROM` in `wrangler.jsonc` must use a domain that is verified in Resend. To email more people, add them to `SUMMARY_TO` separated by commas.

**Set up the laptop:** open the deployed URL in Chrome, enter the manager code, and the laptop is now the kiosk. The kiosk cookie lasts 400 days and renews every time the page loads. Phones and other computers get the setup screen, so workers can't sign in from home. For a locked-down screen, launch Chrome with `--kiosk <url>`.

Changing `SESSION_SECRET` signs out the kiosk and the manager. Run the device setup again afterwards.

## Local dev

```bash
cp .dev.vars.example .dev.vars          # MANAGER_CODE=2468 locally
npm run db:migrate:local
npx wrangler dev --test-scheduled       # curl "localhost:8787/__scheduled?cron=0+19+*+*+SUN" fires the Monday job
```

## Layout

- `src/index.ts`: routing, device setup, cron handler
- `src/kiosk.ts`: kiosk JSON API (register, arrive, finish, overrides) and the friendly messages
- `src/pages.ts`: kiosk HTML and client JS
- `src/admin.ts`: manager area
- `src/summary.ts`: week data, the HTML table shared by the email and admin, CSV, Resend send
- `src/auth.ts`: signed cookies and the manager-code check with lockout
- `src/time.ts`: Brisbane (UTC+10, no DST) date helpers
- `migrations/`: D1 schema. Migrations are append-only; add a new file and never edit an applied one.
