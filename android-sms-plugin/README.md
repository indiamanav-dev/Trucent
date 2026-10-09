# Building TruCent V-001.P as an installable Android app

This folder has the **real, working native code** for the SMS auto-import feature.
The home screen widget's native code lives alongside it in `../android-widget/`.
Neither folder has the surrounding Android/Gradle project — that gets generated
by Capacitor's own tooling, which needs network access this build environment
didn't have. You'll generate it in about 5 minutes on your own machine, then
drop these files in.

If you're using the GitHub Actions workflow (`.github/workflows/build-apk.yml`,
see `EASY_INSTALL.md`), all of this — including the widget — happens
automatically on every push. This README is for building locally with Android
Studio instead.

## What you need (all free)

- [Node.js](https://nodejs.org) (v18+)
- [Android Studio](https://developer.android.com/studio) — this gives you the
  Android SDK, Gradle, and a signing wizard, so you don't need to touch the
  command line for the actual build.

## Step-by-step

**1. Install dependencies and build the web app**
```bash
cd trucent-app
npm install
npm run build
```

**2. Generate the Android project**
```bash
npx cap init "TruCent" com.trucent.app --web-dir=dist
npx cap add android
```
This creates the `android/` folder — a full, valid Android Studio project.

**3. Drop in the SMS plugin and the home screen widget**

Copy both sets of native source to where Capacitor expects custom code:
```bash
mkdir -p android/app/src/main/java/com/trucent/app
cp android-sms-plugin/java/com/trucent/app/SmsReaderPlugin.java \
   android/app/src/main/java/com/trucent/app/SmsReaderPlugin.java
cp android-widget/java/com/trucent/app/TruCentWidgetProvider.java \
   android/app/src/main/java/com/trucent/app/TruCentWidgetProvider.java
cp android-widget/java/com/trucent/app/HomeWidgetPlugin.java \
   android/app/src/main/java/com/trucent/app/HomeWidgetPlugin.java

mkdir -p android/app/src/main/res/layout android/app/src/main/res/xml \
         android/app/src/main/res/drawable android/app/src/main/res/values
cp android-widget/res/layout/widget_trucent.xml       android/app/src/main/res/layout/
cp android-widget/res/xml/trucent_widget_info.xml     android/app/src/main/res/xml/
cp android-widget/res/drawable/widget_background.xml  android/app/src/main/res/drawable/
cp android-widget/res/values/widget_strings.xml       android/app/src/main/res/values/
```

**4. Register the plugins**

Open `android/app/src/main/java/com/trucent/app/MainActivity.java` (Capacitor
already generated this) and edit it to match `android-sms-plugin/MainActivity-example.java`
— you're adding an `onCreate` override that calls `registerPlugin(SmsReaderPlugin.class)`
and `registerPlugin(HomeWidgetPlugin.class)` **before** `super.onCreate(...)`
(that ordering matters — see the comment in that file for why).

**5. Add the SMS permissions and the widget receiver**

Open `android/app/src/main/AndroidManifest.xml`:
- Add the two `<uses-permission>` lines from `android-sms-plugin/AndroidManifest-additions.xml`,
  anywhere inside the outer `<manifest>` tag (above `<application>` is the usual spot).
- Add a `<receiver>` entry for the widget, inside `<application>...</application>`:
  ```xml
  <receiver android:name="com.trucent.app.TruCentWidgetProvider" android:exported="false">
      <intent-filter>
          <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />
      </intent-filter>
      <meta-data android:name="android.appwidget.provider" android:resource="@xml/trucent_widget_info" />
  </receiver>
  ```

**6. Sync and open in Android Studio**
```bash
npx cap sync android
npx cap open android
```
This launches Android Studio with the project loaded.

**7. Build a signed release APK**

In Android Studio: **Build → Generate Signed Bundle / APK → APK**.
- First time: click **Create new...** to make a keystore. Save the `.jks`
  file somewhere safe — you'll reuse it for every future update of this app
  (Android won't let you install an "update" signed with a different key).
- Choose **release** build variant, finish the wizard.
- Android Studio drops the finished file at
  `android/app/release/app-release.apk`.

**8. Rename and distribute**

Rename it to something like `TruCent-V-001.P.apk`. Since WhatsApp blocks
`.apk` attachments outright, share it via:
- A Google Drive / Dropbox link, or
- Telegram (which does allow `.apk` files), or
- A direct download link if you host it anywhere

Whoever installs it will need to enable **"Install unknown apps"** for
whichever app they downloaded it through (Android will prompt them for this
automatically on tapping the file) — this is normal for any app installed
outside the Play Store, not specific to this one.

## What happens when someone installs it

1. They install the APK, open the app — it's completely empty (no dummy data).
2. They go to **Track → Connect SMS**, tap **Allow SMS access**.
3. Android shows its own permission dialog (this is the OS, not the app,
   asking) — they tap **Allow**.
4. The app reads messages from the last 180 days and parses out debits,
   credits, refunds, and upcoming bills (credit card statements, EMIs,
   utility bills) — the parsing itself happens in `src/lib.js`, not on the
   native side; see the root README's "What's in this build" section.
5. They can tap the refresh icon on the SMS card anytime to pull newly
   arrived messages; anything already imported (or previously deleted)
   won't come back.
6. If they add the home screen widget (long-press home screen → Widgets →
   TruCent), it shows net position and the next bill without opening the app.

## Why this can't just be a Play Store app

Google Play restricts the `READ_SMS` permission to apps that are the phone's
default SMS handler, with narrow, hard-to-qualify-for exceptions for finance
apps. Sideloading (this APK route) is the only way to ship this specific
feature today without going through that approval process — which is also
exactly why you asked for a sideload build in the first place.

## A note on trust

An unsigned finance app + SMS permission + shared as a file is, unfortunately,
also the current pattern used in a lot of real banking scams in India right
now. That doesn't make this build wrong to make for your own household — but
share it directly with people who know you and know what it is, not as a
forwarded chain message, and expect Android/WhatsApp/Telegram to show
security warnings along the way. That's the system working as intended, not
a sign anything here is broken.
