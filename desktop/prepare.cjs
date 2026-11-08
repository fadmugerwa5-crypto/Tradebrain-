// Copies the shared web app (../app) into desktop/app so electron-builder can bundle it.
const fs = require("node:fs");
const path = require("node:path");
const from = path.join(__dirname, "..", "app");
const to = path.join(__dirname, "app");
if (!fs.existsSync(path.join(from, "index.html"))) { console.error("Cannot find ../app/index.html"); process.exit(1); }
fs.rmSync(to, { recursive: true, force: true });
fs.cpSync(from, to, { recursive: true });
console.log("Copied the app into desktop/app");
