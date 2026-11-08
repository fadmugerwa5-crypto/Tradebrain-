# Turning ClassPulse into an installable Android app (APK)

The app already runs fully on the phone by itself — no hosting needed. You
just need to wrap it into an APK. Two routes; pick one.

## Route 1 — Cloud build (no coding, no Android SDK, free) — RECOMMENDED

This builds the APK on GitHub's computers. You never install anything.

### Step A — put the project on GitHub (one time)

1. Create a free account at https://github.com.
2. Click **New repository**, name it `classpulse`, set it to **Private**, create.
3. On your computer, open PowerShell in the `classpulse` folder and run:
   ```
   git init
   git add .
   git commit -m "ClassPulse"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/classpulse.git
   git push -u origin main
   ```
   (If `git` is not installed, download it from https://git-scm.com — one installer, default options.)

### Step B — build the APK (one click)

1. On GitHub, open your repository → **Actions** tab.
2. Click **Build ClassPulse APK** → **Run workflow** → **Run workflow**.
3. Wait ~5 minutes. A green tick appears.
4. Click the finished run → scroll down → **Artifacts** → download `ClassPulse-APK`.
5. Unzip it. Inside is `app-debug.apk`.

### Step C — install on the phone

1. Copy `app-debug.apk` to the phone (WhatsApp, email, USB).
2. Tap it. Android says "unknown source" → **Settings → Allow from this source** → install.
3. Open ClassPulse. It runs entirely on the phone. Complete setup on first launch.

When you change the app later, just push to GitHub again and re-run the workflow.

## Route 2 — PWA Builder (needs a public https address)

If you already have an https address (see `docs/DEPLOYMENT.md`):

1. Open https://www.pwabuilder.com, paste the address, **Start**.
2. Green ticks → **Package for stores** → **Android** → **Generate**.
3. Download the ZIP, take out `app-release-signed.apk`, send to phones.

## Route 3 — Build on your own computer (needs Android Studio)

1. Install Android Studio (https://developer.android.com/studio).
2. In the `classpulse` folder: `npm install @capacitor/core @capacitor/cli @capacitor/android`
3. `npx cap add android && npx cap sync android`
4. `npx cap open android` → in Android Studio, **Build → Build APK**.

## Important
- The APK can open and store supported work offline, but multi-phone sharing requires your ClassPulse school server to be running and reachable.
- On the APK sign-in screen, enter the school's HTTPS server URL in **School server**. Do not enter `https://localhost` unless the server is running on that same phone.
- Once connected and signed in, supported attendance, lesson, alert, cover, plan, marks, audit and calendar data sync to the school server. DOS/Head/Admin devices pull the full shared activity snapshot when they reconnect.
- Keep the server backed up and running; an APK alone cannot share records between phones.
- Camera works because Capacitor grants camera permission to the app.


## Route 1 — PWA Builder (recommended, no coding at all)

This turns your live website into a real Android app using Microsoft's free tool.

### Step A — get a public https:// address

A phone app cannot point at your laptop. You need the app reachable on the
internet with https. Easiest free option:

1. Follow **Option B** in `docs/DEPLOYMENT.md` (deploy to Render). You get an
   address like `https://classpulse-xxxx.onrender.com`.
2. Sign in once as the administrator and complete setup on that address.
3. On a phone on the school Wi-Fi, open Settings → Rules & anti-cheating,
   press "Use this connection", Save. (This tells the server the school's
   network.)

### Step B — build the APK

1. Open <https://www.pwabuilder.com/> in a browser.
2. Paste your `https://…onrender.com` address and press **Start**.
3. PWA Builder analyses the site. If it shows green ticks for Manifest,
   Service Worker and Security, press **Package for stores**.
4. Choose **Android**, then **Generate**. It downloads a ZIP containing:
   - `app-release-signed.apk`  ← this is your installable app
   - `assetlinks.json` (for verified links)
5. Copy `app-release-signed.apk` to the teachers' phones (WhatsApp, USB, email)
   and install it. Android will warn "unknown source" — allow it once.

### Step C — distribute
- Send the APK file to staff. They tap it and install.
- When you update the app, rebuild the APK the same way and re-send it.
  (Or, simpler: keep using the website address and "Add to Home screen" — the
  app updates itself.)

## Route 2 — Bubblewrap (for someone technical)

If you have a developer, they can run:

```bash
npm i -g @bubblewrap/cli
bubblewrap init --manifest=https://your-address/manifest.webmanifest
bubblewrap build
```

This produces the same APK. The `twa-manifest.json` file in the project root
can be used as a starting point.

## Important notes
- The APK still talks to your server. If the server is offline, scans are
  saved on the phone and pushed when it comes back.
- The camera only works because the address is `https://`. If you ever point
  the app at an `http://` address, scanning stops.
- Re-running PWA Builder after you change the app (new version) gives you a
  new APK. Staff reinstall it; their logins are kept.

## What I have prepared for you
- `app/manifest.webmanifest` — complete, with icons, shortcuts, theme colour.
- `app/sw.js` — service worker with offline shell and push notifications.
- `app/icons/` — all required sizes (64, 192, 512, maskable).
- `docs/DEPLOYMENT.md` — how to get the https address.
