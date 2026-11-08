// ClassPulse for Windows — the same app as on phones, in its own window.
// Data is kept on this PC. To share data with phones, connect it to the school
// server on the sign-in screen, exactly as on a phone.
const { app, BrowserWindow, Menu, session, shell, dialog } = require("electron");
const path = require("node:path");
const { createStaticServer } = require("./static-server");

const PORT = 47891; // fixed, so the browser storage (your data) always belongs to the same address
const ORIGIN = "http://127.0.0.1:" + PORT;
let win = null;
let server = null;

if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(start).catch((e) => { dialog.showErrorBox("ClassPulse could not start", String(e && e.message || e)); app.quit(); });
}

async function start() {
  try {
    server = await createStaticServer(path.join(__dirname, "app"), PORT);
  } catch (e) {
    dialog.showErrorBox("ClassPulse could not start", "Port " + PORT + " is already in use by another program. Close it and open ClassPulse again.");
    return app.quit();
  }
  // Camera is needed to scan QR codes; allow it for ClassPulse's own address only.
  const ok = (url) => String(url || "").startsWith(ORIGIN);
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb, details) => cb(permission === "media" && ok(details.requestingUrl || wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, permission, origin) => permission === "media" && ok(origin));

  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1280, height: 860, minWidth: 380, minHeight: 600, title: "ClassPulse", autoHideMenuBar: true,
    icon: path.join(__dirname, "app", "icons", "icon-512.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  // Printing and PDF export open a blank window; anything else opens in the normal browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url === "about:blank" || url === "") return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 900, height: 800 } };
    if (/^https?:/i.test(url) && !url.startsWith(ORIGIN)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(ORIGIN)) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); } });
  win.on("closed", () => { win = null; });
  await win.loadURL(ORIGIN + "/index.html");
}

app.on("window-all-closed", () => { if (server) server.close(); app.quit(); });
