// TradeBrain desktop shell. The app is a static bundle: this serves it from memory-light local files
// on a FIXED loopback port (localhost counts as a secure context, and saved keys/journal live in browser
// storage tied to that origin). No trading server exists: the app talks to Binance/Deriv/AI directly.
const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PORT = 18787;
const HOST = "127.0.0.1";
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".map": "application/json" };
let win = null;
let server = null;

function appDir() {
  const c = [path.join(process.resourcesPath || "", "app"), path.join(__dirname, "..", "dist")];
  return c.find((p) => fs.existsSync(path.join(p, "index.html"))) || null;
}

function serve(root) {
  return new Promise((resolve, reject) => {
    server = http.createServer((req, res) => {
      let rel = decodeURIComponent((req.url || "/").split("?")[0]);
      if (rel.endsWith("/")) rel += "index.html";
      const file = path.normalize(path.join(root, rel));
      if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, buf) => {
        if (err) { res.writeHead(404); return res.end("Not found"); }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
        res.end(buf);
      });
    });
    server.once("error", reject);
    server.listen(PORT, HOST, resolve);
  });
}

function pageHtml(title, body) {
  return "data:text/html;charset=utf-8," + encodeURIComponent(`<meta charset="utf-8"><title>${title}</title><body style="margin:0;background:#0c0e12;color:#9bb0c4;font:15px system-ui,sans-serif;display:grid;place-items:center;height:100vh"><div style="max-width:560px;padding:24px;white-space:pre-wrap">${body}</div>`);
}

async function main() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: "#e6eff7", title: "TradeBrain", autoHideMenuBar: true,
    // webSecurity is off so the app can call Binance/AI endpoints directly (no CORS wall). Only the local bundle is ever loaded here.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: false },
  });
  win.on("closed", () => { win = null; });
  const root = appDir();
  if (!root) return win.loadURL(pageHtml("Could not start", "App files not found. The installer was built without the app."));
  try { await serve(root); } catch (e) { return win.loadURL(pageHtml("Could not start", `Port ${PORT} is busy (is TradeBrain already open?).\n${e.message}`)); }
  const origin = `http://${HOST}:${PORT}`;
  win.webContents.setWindowOpenHandler(({ url }) => { if (!url.startsWith(origin)) shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!url.startsWith(origin) && !url.startsWith("data:")) { e.preventDefault(); shell.openExternal(url); } });
  await win.loadURL(origin + "/");
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(main).catch((e) => { dialog.showErrorBox("TradeBrain", String((e && e.message) || e)); app.quit(); });
  app.on("window-all-closed", () => { if (server) server.close(); app.quit(); });
}
