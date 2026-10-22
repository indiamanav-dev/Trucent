# The easy way — no coding, no installing Android Studio

This builds the app in the cloud (on GitHub's free servers) instead of on
your own computer. You never open a terminal, never install Node.js or
Android Studio, and never touch a single line of code. You just upload
files and click buttons.

Total cost: **₹0**. Total time: about 15 minutes of your attention, then a
10-minute wait while it builds itself.

## What you need

- A free [GitHub](https://github.com/signup) account (just an email address).
- [GitHub Desktop](https://desktop.github.com/) — a simple app, not a coding
  tool. It's the easiest way to upload a whole folder of files correctly.

## Step 1 — Create the account and a new repository

1. Sign up at github.com if you haven't already.
2. Click the **+** icon (top right) → **New repository**.
3. Name it `trucent-app`, keep it **Public**, click **Create repository**.

## Step 2 — Upload the project files

1. Install and open **GitHub Desktop**, sign in with your GitHub account.
2. **File → Clone repository** → pick the `trucent-app` repo you just made
   → choose any folder on your computer to save it in → **Clone**.
3. This creates an empty folder on your computer. Unzip the project zip I
   gave you, and copy **everything inside it** into that folder (so
   `package.json`, the `src` folder, `.github` folder, etc. all sit directly
   inside it).
4. Go back to GitHub Desktop — it will show all the new files listed,
   ready to upload. Type anything in the message box at the bottom left
   (e.g. "first upload"), click **Commit to main**, then click
   **Push origin** at the top.

That's it — the files are now on GitHub, which automatically starts
building your app.

## Step 3 — Watch it build (fully automatic)

1. On github.com, open your `trucent-app` repository.
2. Click the **Actions** tab near the top.
3. You'll see a build running (a small orange dot, turning to a green
   checkmark when done). This takes about 5–10 minutes. You don't need to
   do anything — just wait.

*(First time only: GitHub may show a banner asking to "enable workflows" —
click the button it gives you.)*

## Step 4 — Get your shareable link

1. Once the build finishes (green checkmark), go to the **Releases**
   section — it's on the right-hand side of your repository's main page.
2. Click the newest release. You'll see a file called
   `TruCent-V-001.P.apk` — right-click it (or long-press on mobile) and
   copy its link.
3. **This link is what you share** — with yourself (to install on your own
   phone) or with anyone else. It works for anyone, doesn't expire, and
   they don't need a GitHub account to use it.

## Step 5 — Install it on Android

1. Open that link on the Android phone → it downloads the `.apk` file.
2. Tap the downloaded file. Android will block it the first time — tap
   through to **Settings** and allow installs from whichever app you
   downloaded it through (Chrome, Files, etc.).
3. Tap **Install**. You may see a "Play Protect" warning since it's not
   from the Play Store — tap **Install anyway**. This is normal for any
   app installed this way, not a sign of a problem.
4. Open the app → go to **Track** → tap **Allow SMS access** → tap
   **Allow** on Android's own permission popup.
5. Done — real transactions from the phone's SMS start showing up.

## If you ever want to update the app later

Repeat Step 2 (copy the new files in, commit, push in GitHub Desktop) —
the build and Release happen automatically again.

**Do the "Enable in-place updates" section below first** (one-time, ~3
minutes). Without it, Android treats every build as a different app (each
one gets a different signing key), so installing a new version means
uninstalling the old one first — which **erases all your local data**, because
the app stores everything on the phone, not on a server. With it set up, a new
build installs as a normal update and keeps your data.

## Enable in-place updates (do this once, before your first real update)

A signing key is how Android decides "is this an update to the same app, or a
different app pretending to have the same name?" This gives the project a
permanent key, stored as encrypted secrets in your own GitHub repo, so every
future build signs the same way.

1. You received a separate file called **`trucent-signing-secrets-PRIVATE.txt`**
   alongside the project zip. It is deliberately *not* inside the project
   folder: your repo is public, so anything inside the folder you push would be
   visible to the whole internet, and anyone could then sign a fake "update" to
   your app. **Never copy that file into the project folder.**
2. On your repo's GitHub page: **Settings** tab -> **Secrets and variables**
   -> **Actions** -> **New repository secret**.
3. Create a secret named exactly `KEYSTORE_PASSWORD`. For the value, copy the
   password line from the private file.
4. Create a second secret named exactly `KEYSTORE_BASE64`. For the value, copy
   the long single line from the private file (~3,640 characters — that is
   expected). Copy it from the file itself, not from a chat window: a string
   this long reliably gets a character corrupted when it passes through
   chat/markdown, which would silently produce a broken key.
5. That's it — no code changes. The next build picks the secrets up
   automatically, and the build log says **"Using the persistent signing key
   from repo secrets"** when it's working. (If you only set one of the two
   secrets, it safely falls back to a one-off key and says so in the log.)

**If you already installed a build made before this**, that copy was signed
with a one-off key, so the first update after adding the secrets still needs one
last uninstall. Every build *after* that updates cleanly in place.

Keep the private file somewhere safe outside GitHub too (a password manager is
ideal). If you ever lose it you can't sign future updates with the same key —
you'd be back to uninstall-to-update.

## Not sharing this repo publicly

A **Public** GitHub repo means anyone can see your source code (not your
personal data — the code never contains your transactions, those only ever
exist on your phone). If you'd rather keep the code private too, you can
make the repository **Private** instead in Step 1 — GitHub Actions still
works for free on private repos for personal accounts, just with a monthly
minutes limit that this small project won't come close to using up.
