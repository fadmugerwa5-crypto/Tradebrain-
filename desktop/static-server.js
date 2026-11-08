// Tiny static file server for the bundled ClassPulse web files.
// It listens on 127.0.0.1 only, so nobody else on the network can reach it.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
  ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".txt": "text/plain",
};

function createStaticServer(root, port) {
  const base = path.resolve(root);
  const server = http.createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, "http://x").pathname); }
    catch (e) { res.writeHead(400); return res.end("Bad request"); }
    if (pathname.endsWith("/")) pathname += "index.html";
    const file = path.resolve(path.join(base, pathname));
    if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-cache" });
      res.end(data);
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
module.exports = { createStaticServer };
