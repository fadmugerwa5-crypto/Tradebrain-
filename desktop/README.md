# ClassPulse for Windows

The same app as on phones, in its own window (Electron). It keeps its data on the PC and
connects to the school server like a phone does (sign-in screen → School server, or scan/enter the join code).

* **ClassPulse-Setup-x.y.z.exe** — installer (Start menu shortcut).
* **ClassPulse-Portable-x.y.z.exe** — one file, runs from a USB stick, no install.

Windows may show "Windows protected your PC" because the file is not code-signed.
Click **More info → Run anyway**. (Signing needs a paid certificate.)

Build locally on Windows: `cd desktop && npm install && npm run dist`.
The GitHub workflow does this for you (see `.github/workflows/build-apps.yml`).
