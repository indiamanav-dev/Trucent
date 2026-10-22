# TruCent — V-001.P

Household expense splitting + "where did my salary go" tracker, built with React + Vite.
**This build ships with zero dummy data** — every list starts empty, and the only
seed profile is "You." Add household members from the profile switcher (top-right avatar).

## What's in this build

- **Local persistence** — data survives closing/reopening the app (not uninstall/reinstall; see the backup discussion in chat for that).
- **Streaks** — a daily logging streak shown in the header and a dedicated dashboard card (7-day history + best streak).
- **Local notifications** — budget 80%/100%, bill due tomorrow, goal 50%/100% funded. Needs `@capacitor/local-notifications` (already in `package.json`); no custom native code required.
- **Home screen widget** — net position + next bill, visible without opening the app. Custom native code in `android-widget/`, wired into the CI build automatically.
- **Money Wrapped** — a Spotify-Wrapped-style recap (top category, biggest win, saving/logging streaks) for this month, last month, or the year so far.
- **WhatsApp nudge** — on any pending settlement, sends a prefilled "you owe me ₹X for Y" message via `wa.me`.
- **Recurring-charge detector** — Money Coach flags merchants billing roughly monthly that aren't yet marked as a recurring bill ("still paying for Netflix?").
- **Export to Excel/PDF** — hand-built `.xlsx` and `.pdf` generators (no dependencies), shared through Android's native share sheet (covers email, WhatsApp, Drive, anything installed) with a browser-download fallback for the web preview.
- **Share the group ledger (Split tab)** — a "Share" button on *Settle up* exports the shared one-off expenses, a per-member paid/share/net summary, and who owes whom, as Excel or PDF. The share message itself lists the outstanding amounts ("Dad owes You ₹300"), so a WhatsApp recipient sees what's due even before opening the attachment. Recurring bills are excluded, matching how the Split tab itself treats them.
- **In-place updates** — the CI build can reuse one permanent signing key (stored as GitHub Secrets, never in the repo), so a new build installs as an update and keeps your local data. See `EASY_INSTALL.md` → "Enable in-place updates".
- **SMS parsing rewritten as testable JS** — the native plugin (`android-sms-plugin/`) now only fetches raw messages; all parsing (debit/credit/refund/bill detection, merchant extraction, category guessing) lives in `src/lib.js` and is covered by `test/*.test.mjs` (64 tests, run with `node test/sms.test.mjs` and `node test/lib2.test.mjs` — no build step needed).
- **Bill SMS → Upcoming** — credit card statements, EMI/loan debits, and utility bills parsed from SMS land in Plan → Upcoming with real due dates, not just UPI/bank transactions.
- **Tap a transaction to see the original SMS** it was parsed from, with what TruCent extracted from it.
- **Refresh button** on the SMS card to pull newly arrived messages on demand, plus a "last synced" timestamp and auto-sync on app open.

Two real bugs were also fixed in this pass: **income previously only counted the
first credit found** (a `.find()` instead of summing all Income transactions —
silently dropped every salary/interest credit after the first), and **refunds
displayed with a "−" sign** in the transaction feed (shown as spending, when
a refund is money coming back in). Both are covered by the test suite now.

## Run it locally

```bash
npm install
npm run dev
```

Opens at `http://localhost:5173`. Edit `src/App.jsx` and it hot-reloads.

## Build for production

```bash
npm run build
npm run preview   # sanity-check the production build locally
```

Output goes to `dist/`.

## Option A — Web deploy (Vercel, ~5 minutes, no SMS import)

**Vercel CLI**
```bash
npm install -g vercel
vercel        # first deploy, follow the prompts
vercel --prod # promote to your production URL
```

**Or GitHub + Vercel dashboard:** push this folder to a repo, import it at
vercel.com → New Project, leave build command as `npm run build` / output `dist`.
Share the resulting URL; on a phone, "Add to Home Screen" makes it behave like
an installed app. Everything works except SMS auto-import, which needs native
Android code (see Option B) — browsers have no API for reading SMS.

## Option B — Sideloadable Android APK, with SMS auto-import

This is the V-001.P build: installable directly on an Android phone without
the Play Store, with the "Connect SMS" feature in Where It Went fully wired up.

**→ See `android-sms-plugin/README.md` for the full step-by-step build guide.**

Short version: `npx cap add android` generates the Android project, you copy
in the native Kotlin plugin from `android-sms-plugin/`, add two permission
lines to the manifest, then build a signed APK in Android Studio. No native
coding required on your end — the plugin code is already written.

That guide also covers realistic distribution (WhatsApp blocks `.apk` files —
use Drive/Telegram instead) and what to expect from Android's own permission
and security prompts along the way.

## Play Store path (if you want it listed publicly later)

1. Get a Play Console developer account ($25 one-time, ID verification).
2. Upload to **Internal testing** first (up to 100 testers, instant, no review).
3. Move to **Closed testing**: needs 12 real testers opted in continuously for 14 days
   before Google grants production access (personal accounts only — organization
   accounts with a D-U-N-S number skip this).
4. Apply for production access, fill the store listing + data safety form, publish.

Note: Google Play restricts `READ_SMS` to apps that are the default SMS handler,
with narrow exceptions — so the SMS auto-import feature as built won't pass Play
review. If you want both Play distribution *and* auto-import, the compliant
replacement is the RBI **Account Aggregator** framework via a licensed TSP
(Setu, Finvu, OneMoney, CAMS Finserv) instead of SMS reading.

## Known limitations of this build

- **No persistence** — state lives in memory only and resets on app restart/refresh.
  Add a backend (e.g. Supabase/Postgres) + auth for real multi-device use.
- **No multi-device sync** — each install has its own local data.
- **SMS parsing is heuristic** — it catches common Indian bank/UPI alert formats
  but isn't guaranteed to catch every bank's exact template; mis-parsed entries
  can be corrected or deleted manually like any other transaction.

## Project structure

```
trucent-app/
├── index.html
├── package.json
├── vite.config.js
├── vercel.json
├── capacitor.config.json
├── android-sms-plugin/          ← native SMS plugin + Android build guide
│   ├── README.md
│   ├── java/com/trucent/app/SmsReaderPlugin.kt
│   ├── AndroidManifest-additions.xml
│   └── MainActivity-example.java
├── public/
│   ├── manifest.webmanifest
│   ├── icon.svg
│   ├── icon-192.png
│   └── icon-512.png
└── src/
    ├── main.jsx
    ├── index.css
    └── App.jsx        ← the whole app lives here
```
