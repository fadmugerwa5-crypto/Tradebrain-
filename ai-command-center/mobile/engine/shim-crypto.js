'use strict';
// Synchronous crypto for the in-app engine (sha256, hmac, aes-256-gcm, random). Verified against Node's crypto in test/engine.test.js.
const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
function sha256(data) {
  const l = data.length, n = ((l + 9 + 63) >> 6) << 6, m = new Uint8Array(n); m.set(data); m[l] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(n - 4, (l * 8) >>> 0); dv.setUint32(n - 8, Math.floor(l / 0x20000000));
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]), w = new Uint32Array(64);
  const rr = (x, c) => (x >>> c) | (x << (32 - c));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const a = rr(w[i-15],7) ^ rr(w[i-15],18) ^ (w[i-15] >>> 3), b = rr(w[i-2],17) ^ rr(w[i-2],19) ^ (w[i-2] >>> 10); w[i] = (w[i-16] + a + w[i-7] + b) | 0; }
    let [a,b,c,d,e,f,g,h] = H;
    for (let i = 0; i < 64; i++) { const t1 = (h + (rr(e,6) ^ rr(e,11) ^ rr(e,25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0, t2 = ((rr(a,2) ^ rr(a,13) ^ rr(a,22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0; h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0; }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32), ov = new DataView(out.buffer); for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]); return out;
}
function hmac(key, data) {
  if (key.length > 64) key = sha256(key); const k = new Uint8Array(64); k.set(key);
  const ip = new Uint8Array(64 + data.length), op = new Uint8Array(96);
  for (let i = 0; i < 64; i++) { ip[i] = k[i] ^ 0x36; op[i] = k[i] ^ 0x5c; } ip.set(data, 64); op.set(sha256(ip), 64); return sha256(op);
}
// AES-256
const SB = new Uint8Array(256); (() => { let p = 1, q = 1; do { p = p ^ ((p << 1) & 0xff) ^ (p & 0x80 ? 0x1b : 0); q ^= q << 1; q ^= q << 2; q ^= q << 4; q &= 0xff; if (q & 0x80) q ^= 0x09; const x = q ^ ((q << 1) | (q >> 7)) ^ ((q << 2) | (q >> 6)) ^ ((q << 3) | (q >> 5)) ^ ((q << 4) | (q >> 4)); SB[p] = (x ^ 0x63) & 0xff; } while (p !== 1); SB[0] = 0x63; })();
const xt = (x) => ((x << 1) ^ (x & 0x80 ? 0x1b : 0)) & 0xff;
function expandKey(key) {
  const w = new Uint8Array(240); w.set(key); let rc = 1;
  for (let i = 32; i < 240; i += 4) { let t = w.slice(i - 4, i);
    if (i % 32 === 0) { t = new Uint8Array([SB[t[1]] ^ rc, SB[t[2]], SB[t[3]], SB[t[0]]]); rc = xt(rc); } else if (i % 32 === 16) t = t.map((x) => SB[x]);
    for (let j = 0; j < 4; j++) w[i + j] = w[i - 32 + j] ^ t[j]; }
  return w;
}
function encBlock(w, inp) {
  const s = new Uint8Array(inp); const add = (r) => { for (let i = 0; i < 16; i++) s[i] ^= w[r * 16 + i]; }; add(0);
  for (let r = 1; r <= 14; r++) {
    for (let i = 0; i < 16; i++) s[i] = SB[s[i]];
    const t = s.slice(); for (let c = 0; c < 4; c++) for (let rw = 0; rw < 4; rw++) s[c * 4 + rw] = t[((c + rw) % 4) * 4 + rw];
    if (r < 14) for (let c = 0; c < 4; c++) { const a0 = s[c*4], a1 = s[c*4+1], a2 = s[c*4+2], a3 = s[c*4+3]; s[c*4] = xt(a0) ^ xt(a1) ^ a1 ^ a2 ^ a3; s[c*4+1] = a0 ^ xt(a1) ^ xt(a2) ^ a2 ^ a3; s[c*4+2] = a0 ^ a1 ^ xt(a2) ^ xt(a3) ^ a3; s[c*4+3] = xt(a0) ^ a0 ^ a1 ^ a2 ^ xt(a3); }
    add(r);
  }
  return s;
}
function gmul(x, y) { // GF(2^128), 16-byte big-endian blocks
  const z = new Uint8Array(16), v = y.slice();
  for (let i = 0; i < 128; i++) { if ((x[i >> 3] >> (7 - (i & 7))) & 1) for (let j = 0; j < 16; j++) z[j] ^= v[j];
    const lsb = v[15] & 1; for (let j = 15; j > 0; j--) v[j] = (v[j] >> 1) | ((v[j-1] & 1) << 7); v[0] >>= 1; if (lsb) v[0] ^= 0xe1; }
  return z;
}
function ghash(H, data) { let y = new Uint8Array(16); for (let o = 0; o < data.length; o += 16) { for (let i = 0; i < 16; i++) y[i] ^= data[o + i]; y = gmul(y, H); } return y; }
function gcm(key, iv, input, decrypt, tag) {
  const w = expandKey(key), H = encBlock(w, new Uint8Array(16)), j0 = new Uint8Array(16); j0.set(iv); j0[15] = 1;
  const out = new Uint8Array(input.length), ctr = j0.slice();
  for (let o = 0; o < input.length; o += 16) { for (let i = 15; i >= 12; i--) if (++ctr[i] & 0xff) break; else ctr[i] = 0; const ks = encBlock(w, ctr); for (let i = 0; i < 16 && o + i < input.length; i++) out[o + i] = input[o + i] ^ ks[i]; }
  const ct = decrypt ? input : out, pad = new Uint8Array(Math.ceil(ct.length / 16) * 16 + 16); pad.set(ct); new DataView(pad.buffer).setUint32(pad.length - 4, (ct.length * 8) >>> 0);
  const s = ghash(H, pad), e = encBlock(w, j0), t = new Uint8Array(16); for (let i = 0; i < 16; i++) t[i] = s[i] ^ e[i];
  if (decrypt) { let d = 0; for (let i = 0; i < 16; i++) d |= t[i] ^ tag[i]; if (d) throw new Error('Unsupported state or unable to authenticate data'); return out; }
  return { out, tag: t };
}
const u8 = (x, enc) => typeof x === 'string' ? (enc === 'base64' ? Uint8Array.from(atob(x), (c) => c.charCodeAt(0)) : new TextEncoder().encode(x)) : new Uint8Array(x);
const toB64 = (a) => { let s = ''; for (const b of a) s += String.fromCharCode(b); return btoa(s); };
const hex = (a) => Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
// Minimal Buffer replacement (only what the engine uses)
class Buf extends Uint8Array {
  static from(x, enc) { if (typeof x === 'string' && enc === 'base64') return new Buf(u8(x, 'base64')); if (typeof x === 'string') return new Buf(u8(x)); return new Buf(x); }
  static byteLength(s) { return new TextEncoder().encode(String(s)).length; }
  static concat(l) { const n = l.reduce((a, b) => a + b.length, 0), o = new Buf(n); let p = 0; for (const b of l) { o.set(b, p); p += b.length; } return o; }
  toString(enc) { if (enc === 'base64') return toB64(this); if (enc === 'hex') return hex(this); if (enc === 'base64url') return toB64(this).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); return new TextDecoder().decode(this); }
}
function rand(n) { const a = new Buf(n); globalThis.crypto.getRandomValues(a); return a; }
const out = (a) => ({ digest: (e) => { const b = new Buf(a); return e ? b.toString(e) : b; } });
module.exports = {
  Buffer: Buf,
  randomBytes: rand,
  createHash: () => { const parts = []; const h = { update: (d) => { parts.push(u8(d)); return h; }, digest: (e) => out(sha256(Buf.concat(parts))).digest(e) }; return h; },
  createHmac: (_a, key) => { const parts = []; const h = { update: (d) => { parts.push(u8(d)); return h; }, digest: (e) => out(hmac(u8(key), Buf.concat(parts))).digest(e) }; return h; },
  timingSafeEqual: (a, b) => { let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; },
  createCipheriv: (_a, key, iv) => { const parts = []; let tag; return { update: (d, ie) => { parts.push(u8(d, ie)); return new Buf(0); }, final: () => { const r = gcm(u8(key), u8(iv), Buf.concat(parts), false); tag = r.tag; return new Buf(r.out); }, getAuthTag: () => new Buf(tag) }; },
  createDecipheriv: (_a, key, iv) => { const parts = []; let tag; return { setAuthTag: (t) => { tag = u8(t); }, update: (d) => { parts.push(u8(d)); return new Buf(0); }, final: () => new Buf(gcm(u8(key), u8(iv), Buf.concat(parts), true, tag)) }; },
};
