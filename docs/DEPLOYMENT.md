# Running ClassPulse for real

This is the plain-language guide. No coding is needed — you copy one command,
press Enter, and the app is running.

There is one rule you cannot get around:

> **A phone will not open its camera on a `http://` address, except
> `http://localhost` on the computer that runs the server.**

So a teacher's phone can only scan when the address in its browser starts with
`https://`. That is a rule of every phone browser, not of ClassPulse. Everything
below exists to give you that `https://` address.

---

## What you need

- One computer in the school that stays on during the school day
  (a staff-room desktop is fine — it does not need to be powerful).
- The school Wi-Fi.
- Internet on that computer, for the recommended setup.

---

## Option A — School computer + Cloudflare Tunnel (recommended)

This is the only option that is free, needs no router changes, and gives you a
working `https://` address in about five minutes.

1. **Start ClassPulse** on the school computer. Open PowerShell in the
   `classpulse` folder and run:

   ```powershell
   node server/server.cjs --port 8787
   ```

   Leave that window open. It prints `http://localhost:8787/`.

2. **Install Cloudflare Tunnel** (once). Download `cloudflared` for Windows from
   <https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/>
   and put `cloudflared.exe` in the same `classpulse` folder.

3. **Open the tunnel.** In a *second* PowerShell window, in the same folder:

   ```powershell
   .\cloudflared.exe tunnel --url http://localhost:8787
   ```

   It prints a line like:

   ```
   https://brave-river-1234.trycloudflare.com
   ```

   **That `https://…trycloudflare.com` address is your school's app.** Open it on
   a phone and the camera will work.

4. **Tell ClassPulse the school's network.** Sign in as the administrator on a
   phone that is on the school Wi-Fi, go to **Settings → Rules & anti-cheating**,
   press **“Use this connection”**, then **Save**.

   That button asks the server which address it sees you from and adds the
   school's network for you. The line under it will say either
   *“counts as the school network”* or *“is NOT the school network”* — read it
   before you save.

5. **Put it on the teachers' phones.** On each phone, open the `https://` address
   in Chrome, then **⋮ → Add to Home screen**. It now behaves like an app.

### Keeping it running

- The free `trycloudflare.com` address **changes every time you restart the
  tunnel**. That is fine while you are testing, but not for a term.
- For a permanent address, make a free Cloudflare account and create a *named
  tunnel* (`cloudflared tunnel create classpulse`). This gives you a fixed
  `https://classpulse.yourdomain.com`. Ask whoever set up the school website to
  help, or follow Cloudflare's own wizard — it is a form, not code.
- To start everything automatically when the computer boots, put both commands
  in a `start-classpulse.bat` file and add a shortcut to it in
  `shell:startup` (press **Win+R**, type `shell:startup`, press Enter).

---

## Option B — Host it online (Render, Railway, Fly)

Use this if no school computer can stay on.

1. Put the `classpulse` folder in a private GitHub repository.
2. On <https://render.com>, create a **Web Service** from that repository.
   - Build command: *(leave empty)*
   - Start command: `node server/server.cjs --port $PORT`
   - Add a **persistent disk** mounted at `/data`, and set the environment
     variable `CLASSPULSE_DB=/data/classpulse.db`
     (without a disk, the database is wiped on every deploy).
3. Render gives you an `https://…onrender.com` address. The camera works there.
4. In **Settings → Rules & anti-cheating**, on a phone on the school Wi-Fi,
   press **“Use this connection”** and Save.

**Important:** the free tier goes to sleep after a while and takes ~30 seconds to
wake. The first teacher to arrive will stare at a blank screen. A paid tier or
Option A avoids that.

---

## Option C — Your own domain and certificate (Caddy)

For a school with an IT person and a fixed public IP.

Install [Caddy](https://caddyserver.com/) and give it a `Caddyfile`:

```
classpulse.yourschool.edu {
    reverse_proxy localhost:8787
}
```

Caddy fetches and renews the certificate automatically. Then point the school's
DNS at the server, open port 443, and add the school's **public** IP under
**Settings → Rules & anti-cheating**.

---

## The scanning rules, and what they really stop

Three switches work together, under **Settings → Rules & anti-cheating**:

| Switch | What it does |
|---|---|
| **Gate scan before class scan** | A classroom scan is refused until that teacher has scanned the gate code today. |
| **School Wi-Fi only** | The *server* checks the address the request came from. A phone on mobile data, or at home, is refused. |
| **Rolling classroom codes** | The code on screen changes every 45 seconds (used with *Rolling display*). |

### Be clear about the limit

If you **print** a classroom poster, that code never changes. A teacher can
photograph it once and scan the photo from anywhere — including the staff room,
which *is* on the school Wi-Fi, so “School Wi-Fi only” will not stop them.

- “School Wi-Fi only” stops **home** and **mobile-data** scanning. It does not
  stop scanning from inside the school.
- The gate rule stops a teacher who never arrived from marking a lesson, but not
  one who arrived and then sat in the staff room.
- The only code-based fix is a **changing** code: *Rolling display* on a spare
  phone or a TV in the classroom. A photo of it dies within 45 seconds.
- Otherwise, the honest control is the DOS walking round, or random live-photo
  spot checks.

Print the **gate** poster. For classrooms, prefer *Rolling display* wherever a
spare screen exists.

---

## Backups

- The database is one file: `server/classpulse.db` (or `CLASSPULSE_DB`).
  Copy it to a USB stick each week. Nothing else is needed to restore.
- **Settings → Export** also writes the whole school to a CSV/JSON file that can
  be imported on another machine.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Black camera box, “camera unavailable” | You are on `http://192.168…` | Use the `https://` address from the tunnel. |
| “Connect to the school Wi-Fi to record a scan” | The server sees a public address | Press **“Use this connection”** while on the school Wi-Fi, then Save. |
| “This connection is NOT the school network” | You saved the wrong network | Delete the addresses, press **“Use this connection”** again. |
| Everyone locked out of scanning | Wrong network saved | On the server computer, open `http://localhost:8787`, sign in, clear the field, Save. `localhost` is always allowed. |
| “Scan the gate code first” | Gate rule is on and no gate scan today | Scan the gate poster, then the classroom. |
| Address changes every restart | Free Cloudflare tunnel | Make a named tunnel (Option A, “Keeping it running”). |
| Data gone after a deploy | No persistent disk | Add the disk and `CLASSPULSE_DB` (Option B). |
