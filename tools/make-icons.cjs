/* ==========================================================================
   ClassPulse — tools/make-icons.js
   Zero-dependency PNG icon generator (Node >= 18).
   Draws the ClassPulse mark at any size so the PWA can be installed on
   Android and iOS with a real launcher icon.

       node tools/make-icons.js
   Writes app/icons/icon-192.png, icon-512.png, icon-maskable-512.png,
   icon-64.png and app/icons/icon.svg
   ========================================================================== */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");

/* ------------------------------------------------------------- PNG writer */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // colour type: truecolour + alpha
  ihdr[10] = 0;  // deflate
  ihdr[11] = 0;  // adaptive filtering
  ihdr[12] = 0;  // no interlace
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

/* ------------------------------------------------------------------ shape */
const STROKE = [
  [0.19, 0.56], [0.33, 0.56], [0.40, 0.34], [0.50, 0.74],
  [0.57, 0.50], [0.63, 0.56], [0.81, 0.56],
];

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx, y = ay + t * dy;
  return Math.hypot(px - x, py - y);
}

function distToLine(px, py) {
  let d = Infinity;
  for (let i = 0; i < STROKE.length - 1; i++) {
    const a = STROKE[i], b = STROKE[i + 1];
    d = Math.min(d, distToSegment(px, py, a[0], a[1], b[0], b[1]));
  }
  return d;
}

function mix(a, b, t) { return a + (b - a) * t; }

/**
 * @param {number} size    pixel size
 * @param {boolean} maskable  full-bleed square background (Android adaptive)
 */
function render(size, maskable) {
  const rgba = Buffer.alloc(size * size * 4);
  const inset = maskable ? 0 : size * 0.06;       // rounded corner bleed
  const radius = maskable ? 0 : size * 0.235;
  const SS = 3;                                    // supersampling
  const strokeW = size * (maskable ? 0.062 : 0.075);
  const scale = maskable ? 0.70 : 1.0;             // keep the mark in the safe zone

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          let [cr, cg, cb, ca] = sample(px, py, size, inset, radius, strokeW, scale, maskable);
          r += cr; g += cg; b += cb; a += ca;
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r / n);
      rgba[i + 1] = Math.round(g / n);
      rgba[i + 2] = Math.round(b / n);
      rgba[i + 3] = Math.round(a / n);
    }
  }
  return rgba;
}

function sample(px, py, size, inset, radius, strokeW, scale, maskable) {
  // Inside the rounded square?
  const half = size / 2;
  let inside = true;
  if (!maskable) {
    const x0 = inset, y0 = inset, x1 = size - inset, y1 = size - inset;
    const cx = Math.min(Math.max(px, x0 + radius), x1 - radius);
    const cy = Math.min(Math.max(py, y0 + radius), y1 - radius);
    inside = Math.hypot(px - cx, py - cy) <= radius + 0.001;
  }
  if (!inside) return [0, 0, 0, 0];

  // Diagonal gradient background (#38bdf8 -> #6366f1).
  const t = Math.min(1, Math.max(0, (px / size) * 0.55 + (py / size) * 0.45));
  let r = mix(0x38, 0x63, t);
  let g = mix(0xbd, 0x66, t);
  let b = mix(0xf8, 0xf1, t);

  // The pulse line, in white, scaled about the centre.
  const cx0 = half + (px - half) / scale;
  const cy0 = half + (py - half) / scale;
  const d = distToLine(cx0 / size, cy0 / size);
  const edge = strokeW / (2 * size * scale);
  if (d <= edge) {
    const aa = Math.min(1, (edge - d) * (size * scale) * 0.9 + 0.35);
    r = mix(r, 255, aa); g = mix(g, 255, aa); b = mix(b, 255, aa);
  }
  return [r, g, b, 255];
}

/* ------------------------------------------------------------------- main */
const outDir = path.join(__dirname, "..", "app", "icons");
fs.mkdirSync(outDir, { recursive: true });

const jobs = [
  ["icon-64.png", 64, false],
  ["icon-192.png", 192, false],
  ["icon-512.png", 512, false],
  ["icon-maskable-512.png", 512, true],
];

jobs.forEach(([name, size, maskable]) => {
  const png = encodePng(size, size, render(size, maskable));
  fs.writeFileSync(path.join(outDir, name), png);
  console.log("wrote", path.relative(process.cwd(), path.join(outDir, name)), png.length + " bytes");
});
