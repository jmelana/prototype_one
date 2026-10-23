# Economic Calendar

A static economic calendar dashboard that uses live Finnhub data. It runs on GitHub Pages behind a demo password.

## How the API key is protected

GitHub Pages can't run server code, so the key can't be hidden on a server. Instead:

- Your key lives only in `.env` on your machine. That file is git-ignored.
- `npm run encrypt-key` encrypts the key with the demo password (PBKDF2-SHA256 with 600k iterations, then AES-256-GCM) and writes `js/data/credentials.js`. Only that encrypted file is published.
- The login page decrypts the key in the visitor's browser. Without the password, the published files contain nothing usable.

Limits:

- Anyone who logs in can find the key in DevTools, because the browser sends it to Finnhub. Share the password only with people you'd trust with the key.
- The encrypted key is public, so use a long password (at least 12 characters is enforced; a passphrase is better).
- If the password spreads, generate a new key in Finnhub, then re-run `npm run encrypt-key` and republish. The old key stops working.

## Setup

Requires Node 21.7 or later.

```sh
cp .env.example .env              # then put your key in FINNHUB_API_KEY
npm run encrypt-key               # prompts for the demo password
npm run serve                     # http://localhost:8000 (this Mac only; never serves .env)
```

The script checks the key with Finnhub before encrypting it. Re-run it any time to change the password or the key.

## Deploy to GitHub Pages

```sh
git init && git add . && git status   # check that .env is NOT listed
git commit -m "Economic calendar demo"
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then, on GitHub, open **Settings → Pages**, choose **Deploy from a branch**, and select `main` / root. The site appears at `https://<you>.github.io/<repo>/`.

The site needs `index.html`, `css/`, `js/` and `fonts/`. `assets/` (source PNG flags), `scripts/`, `tests/` and `snapshots/` aren't needed on GitHub Pages.

## Local resources

The page's only outside request is the calendar data from `/api/v1/calendar/economic`. Everything else ships with the app:

- **Font:** Inter 400/500/600 (Latin and Latin Extended) in `fonts/`, SIL Open Font License (`fonts/LICENSE-Inter-OFL.txt`).
- **Flags:** 271 square flags as 64×64 PNGs in `assets/flags/` (rendered from flag-icons, MIT, `assets/flags/LICENSE-flag-icons.txt`). `npm run build-flags` packs them into `css/flags.css`, so the page loads one file instead of hundreds. The same PNGs are the flag set for the JavaFX app, which can't display SVG files.
- **Icons:** inline SVG in `js/ui/icons.js` and `index.html`.

## Data

- Shows one week at a time, Sunday to Saturday, starting with the current week. The date fields only show the week's first and last day (they can't be edited). The **‹ ›** arrows go to the previous and next week, and **This Week** (next to the search box) jumps back to the current week. The day tabs (with event counts and a red dot on days with a high-impact release) show a single day; click the day again or **Week** to go back.
- Dates are calendar days in the selected timezone. Ranges beyond what's loaded are fetched from `/calendar/economic`, and live data refreshes every 5 minutes.
- Every good response is saved in the browser (the last 4 date windows). The page opens with that copy straight away, and if the data service can't be reached it keeps showing it, labeled with when it was saved, while it retries. Dates with no saved copy say they can't be loaded right now. Logging out removes the saved copy.
- Alerts come from one rule in **Settings → Alerts**: a **Turn on alerts** switch (on by default) and what to alert on: countries, impact levels and categories (default: United States, High impact, any category). An event must match every part; an empty part means any. When on, every upcoming matching event gets an alert that goes off the lead time before it (10 minutes by default). Bells in the table only show the state and appear only while alerts are on: filled yellow = alert set, filled grey = it triggered (kept 30 days, or until **Clear triggered alerts** in Settings → Alerts); events without an alert have no bell. Clicking a bell opens Settings → Alerts. When an alert goes off, an alarm window shows the time left before the report and stays open until it's acknowledged. Alerts run only while the page is open.

## Tests

```sh
npm test
```
