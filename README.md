# TruCent — V-001.P

Household expense splitting + "where did my salary go" tracker, built with React + Vite.
**This build ships with zero dummy data** — every list starts empty, and the only
seed profile is "You." Add household members from the profile switcher (top-right avatar).

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
