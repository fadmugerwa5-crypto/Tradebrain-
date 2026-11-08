# v1.6.0 — easier setup, and Android + Windows apps

## Setting up a school (Admin → School setup)

| What | Where | Notes |
|---|---|---|
| Checklist | School setup | Ticks staff, DOS account, classes, timetable, term dates, phones connected (+ optional QR posters, learners, syllabus). Also shown on the Admin home until finished. |
| Create many classes | School setup → *Create classes in one go* | `S1-S6` × `A, B, C` (or `A-D`). Each new class gets its own room and QR code. Existing classes are left alone. |
| Rename / delete a class | School setup → tap a class | Rename moves the lessons; the room gets a **new QR code** (reprint the poster). Refused when learners, marks or syllabus progress belong to the class. Delete warns, removes lessons/room/QR/learners, and is refused while the class has assessments (marks are never deleted with a class). |
| Timetable import | Admin home → Import timetable | If the file names classes or teachers that do not exist, you are asked first. New teachers become placeholders ("Teacher T-105") with no PIN; import the staff list first to avoid that. |
| Staff import + starting PINs | Admin home → Import staff list | Switch on by default: anyone without a PIN gets a random non-obvious 4-digit PIN and you get a printable sheet. PINs are stored scrambled, so the sheet is shown **once**. *People → "N people have no PIN"* does the same for existing accounts. |
| Join code | School setup → Show join code | QR with the server address. On a new phone: sign-in screen → *Scan the school's join code*. Needs the admin phone to be connected to the server by an address other phones can reach (not `localhost`). |
| Start a term | School setup → Start a new term | Sets the term name and dates. Deletes nothing. |
| Weekly summary | Academics → Weekly summary (DOS, Head, Admin) | Attendance & punctuality, missed lessons, syllabus behind, marks and plans waiting, what is coming up. Print/PDF and Excel. |

## The apps

One workflow, `.github/workflows/build-apps.yml`, runs the tests and then builds both apps:

* **Android** → artifact `ClassPulse-Android-APK` (`app-debug.apk`).
* **Windows** → artifact `ClassPulse-Windows` (`ClassPulse-Setup-1.6.0.exe` installer and `ClassPulse-Portable-1.6.0.exe`).

Both are standalone: the app files are inside them and data is kept on the device. Neither needs a website.
To share data between devices they connect to the school server (`node server/server.cjs`,
or `server/start-server.bat` on a Windows PC with Node 22+).

Windows will warn "Windows protected your PC" because the file is not code-signed: **More info → Run anyway**.

## Not verified here

* The **Windows build** (Electron + electron-builder on GitHub's Windows machine) and the **Android build** were not run
  in the environment this was written in. The file server inside the Windows app was tested on its own
  (serves the app, blocks path tricks); the window itself was not.
* Camera scanning of the join code needs a real phone/PC camera; in testing, the code is parsed and applied through
  the same function the scanner calls.
