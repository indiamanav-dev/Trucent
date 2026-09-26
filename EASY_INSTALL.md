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
the build and Release happen automatically again. Note: because each build
uses a freshly generated signing key (see the workflow file's comments),
installing an update may ask you to uninstall the old version first. If
you'd rather have proper in-place updates, that needs one extra one-time
setup (a persistent signing key stored as a "GitHub Secret") — ask me and
I'll walk you through it if you get to that point.

## Not sharing this repo publicly

A **Public** GitHub repo means anyone can see your source code (not your
personal data — the code never contains your transactions, those only ever
exist on your phone). If you'd rather keep the code private too, you can
make the repository **Private** instead in Step 1 — GitHub Actions still
works for free on private repos for personal accounts, just with a monthly
minutes limit that this small project won't come close to using up.
