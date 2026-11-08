/* ==========================================================================
   ClassPulse — util.js : helpers, icons, formatting, storage
   Global namespace: CP
   ========================================================================== */
(function (global) {
  "use strict";

  const CP = (global.CP = global.CP || {});

  /* ---------- ids -------------------------------------------------------- */
  let _seq = 0;
  CP.uid = function (prefix) {
    _seq = (_seq + 1) % 100000;
    return (
      (prefix || "id") +
      "_" +
      Date.now().toString(36) +
      _seq.toString(36) +
      Math.random().toString(36).slice(2, 6)
    );
  };

  /* ---------- storage ---------------------------------------------------- */
  const NS = "classpulse.v1.";
  CP.storage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(NS + key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
      } catch (e) {
        return fallback;
      }
    },
    set(key, val) {
      try {
        localStorage.setItem(NS + key, JSON.stringify(val));
        return true;
      } catch (e) {
        console.warn("storage full", e);
        return false;
      }
    },
    del(key) {
      try { localStorage.removeItem(NS + key); } catch (e) {}
    },
    keys() {
      const out = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(NS) === 0) out.push(k.slice(NS.length));
      }
      return out;
    },
    usage() {
      let n = 0;
      this.keys().forEach((k) => {
        n += (localStorage.getItem(NS + k) || "").length;
      });
      return n;
    },
  };

  /* ---------- crypto-ish ------------------------------------------------ */
  // Lightweight, dependency-free digest. NOT a substitute for a server-side
  // password hash — see docs/SECURITY notes. Used only to avoid storing raw PINs.
  CP.digest = function (str) {
    let h1 = 0x811c9dc5, h2 = 0x01000193;
    const s = "cp::" + String(str);
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 ^= c; h1 = Math.imul(h1, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
      h2 = ((h2 << 13) | (h2 >>> 19)) >>> 0;
    }
    return (
      h1.toString(16).padStart(8, "0") +
      h2.toString(16).padStart(8, "0")
    );
  };

  /* ---------- date / time ------------------------------------------------ */
  const pad = (n) => String(n).padStart(2, "0");

  CP.time = {
    hm(d) {
      d = new Date(d);
      return pad(d.getHours()) + ":" + pad(d.getMinutes());
    },
    hms(d) {
      d = new Date(d);
      return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
    },
    ampm(d) {
      d = new Date(d);
      let h = d.getHours();
      const m = pad(d.getMinutes());
      const ap = h >= 12 ? "PM" : "AM";
      h = h % 12 || 12;
      return h + ":" + m + " " + ap;
    },
    dayKey(d) {
      d = new Date(d);
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    },
    dayName(d) {
      return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][
        new Date(d).getDay()
      ];
    },
    dayShort(d) { return this.dayName(d).slice(0, 3); },
    pretty(d, long) {
      d = new Date(d);
      const now = new Date();
      const sameDay = CP.time.dayKey(d) === CP.time.dayKey(now);
      const y = new Date(now.getTime() - 864e5);
      if (sameDay) return "Today";
      if (CP.time.dayKey(d) === CP.time.dayKey(y)) return "Yesterday";
      return d.toLocaleDateString(undefined, {
        day: "numeric",
        month: long ? "long" : "short",
        ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
      });
    },
    // "HH:MM" -> minutes since midnight
    mins(hhmm) {
      const [h, m] = String(hhmm).split(":").map(Number);
      return h * 60 + (m || 0);
    },
    fromMins(m) {
      m = Math.round(m);
      return pad(Math.floor(m / 60) % 24) + ":" + pad(m % 60);
    },
    ago(ts) {
      const s = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 1000));
      if (s < 45) return "just now";
      if (s < 90) return "1 min ago";
      if (s < 3600) return Math.round(s / 60) + " min ago";
      if (s < 7200) return "1 hr ago";
      if (s < 86400) return Math.round(s / 3600) + " hrs ago";
      const d = Math.round(s / 86400);
      return d === 1 ? "yesterday" : d + " days ago";
    },
    mmss(seconds) {
      const s = Math.max(0, Math.floor(seconds));
      return Math.floor(s / 60) + ":" + pad(s % 60);
    },
    weekStart(d) {
      const x = new Date(d);
      const day = (x.getDay() + 6) % 7; // monday = 0
      x.setDate(x.getDate() - day);
      x.setHours(0, 0, 0, 0);
      return x;
    },
  };

  /* ---------- numbers ---------------------------------------------------- */
  CP.pct = function (n, d) {
    if (!d) return 0;
    return Math.round((n / d) * 1000) / 10;
  };
  CP.clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  CP.sum = (arr, f) => arr.reduce((a, x) => a + (f ? f(x) : x), 0);
  CP.avg = (arr, f) => (arr.length ? CP.sum(arr, f) / arr.length : 0);
  CP.by = function (arr, key) {
    const f = typeof key === "function" ? key : (x) => x[key];
    return arr.reduce((m, x) => {
      const k = f(x);
      (m[k] = m[k] || []).push(x);
      return m;
    }, {});
  };
  CP.sortBy = (arr, f, dir) =>
    arr.slice().sort((a, b) => {
      const x = f(a), y = f(b);
      const r = x < y ? -1 : x > y ? 1 : 0;
      return dir === "desc" ? -r : r;
    });
  CP.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  };
  CP.initials = function (name) {
    const p = String(name || "?").trim().split(/\s+/);
    return ((p[0] || "?")[0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase();
  };

  const AV = [
    "#6c5ce7",
    "#00b894",
    "#e17055",
    "#0984e3",
    "#d6306c",
    "#e17000",
    "#8e6fd8",
    "#00b8a9",
    "#e84393",
    "#5f7ff7",
  ];
  CP.avatarGradient = function (seed) {
    let h = 0;
    const s = String(seed || "");
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return AV[h % AV.length];
  };

  /* ---------- async ------------------------------------------------------ */
  CP.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  CP.debounce = function (fn, ms) {
    let t;
    return function (...a) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, a), ms || 200);
    };
  };

  /* ---------- device / platform ------------------------------------------ */
  CP.haptic = function (pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern || 12);
    } catch (e) {}
  };
  CP.isStandalone = function () {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    );
  };
  CP.hasCamera = function () {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  };
  CP.secureContext = function () {
    return window.isSecureContext;
  };
  CP.online = () => navigator.onLine !== false;

  /* ---------- icons ------------------------------------------------------ */
  const P = (d, extra) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"${extra || ""}>${d}</svg>`;
  const F = (d, extra) =>
    `<svg viewBox="0 0 24 24" fill="currentColor"${extra || ""}>${d}</svg>`;

  CP.icon = function (name, extra) {
    const m = {
      home: P('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9.5 21v-6h5v6"/>'),
      scan: P('<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8"/><path d="M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8"/><path d="M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16"/><path d="M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M3.5 12h17"/>'),
      qr: P('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 14h3v3h-3z"/><path d="M20 14v.01M20 20v.01M14 20v.01M17 20v.01"/>'),
      users: P('<circle cx="9" cy="8" r="3.2"/><path d="M2.8 20a6.4 6.4 0 0 1 12.4 0"/><path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.6"/><path d="M18 14.4a6.4 6.4 0 0 1 3.3 5.6"/>'),
      bell: P('<path d="M18 8a6 6 0 1 0-12 0c0 6-2.5 7-2.5 7h17S18 14 18 8Z"/><path d="M10.3 20.5a2 2 0 0 0 3.4 0"/>'),
      chart: P('<path d="M4 20V10"/><path d="M10 20V4"/><path d="M16 20v-7"/><path d="M22 20H2"/>'),
      shield: P('<path d="M12 3l7.5 3v6c0 5-3.2 8.2-7.5 9.5C7.7 20.2 4.5 17 4.5 12V6L12 3Z"/><path d="m9.2 12.2 2 2 3.6-3.9"/>'),
      gear: P('<circle cx="12" cy="12" r="3.1"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/>'),
      check: P('<path d="m4.5 12.5 5 5 10-11"/>'),
      checkCircle: P('<circle cx="12" cy="12" r="9"/><path d="m8 12.3 2.6 2.6L16 9.5"/>'),
      x: P('<path d="M6 6l12 12M18 6 6 18"/>'),
      xCircle: P('<circle cx="12" cy="12" r="9"/><path d="M15 9l-6 6M9 9l6 6"/>'),
      alert: P('<path d="M12 4.5 2.8 20h18.4L12 4.5Z"/><path d="M12 10v4.2"/><path d="M12 17.4v.01"/>'),
      info: P('<circle cx="12" cy="12" r="9"/><path d="M12 11v5.2"/><path d="M12 7.9v.01"/>'),
      clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.3 2"/>'),
      timer: P('<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.8v3.9l2.6 1.5"/><path d="M9.5 3h5"/><path d="M12 3v3"/>'),
      calendar: P('<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18"/><path d="M8 3v4M16 3v4"/>'),
      logout: P('<path d="M15 17l5-5-5-5"/><path d="M20 12H9"/><path d="M12 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21H12"/>'),
      plus: P('<path d="M12 5v14M5 12h14"/>'),
      download: P('<path d="M12 3v12"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4 20h16"/>'),
      print: P('<path d="M7 9V3.5h10V9"/><path d="M7 18H5a2 2 0 0 1-2-2v-4.5A2 2 0 0 1 5 9.5h14a2 2 0 0 1 2 2V16a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7" rx="1.5"/>'),
      edit: P('<path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3Z"/><path d="M14.5 6.5 17.5 9.5"/>'),
      trash: P('<path d="M4 7h16"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10.5 11v5.5M13.5 11v5.5"/>'),
      refresh: P('<path d="M20 11a8 8 0 0 0-13.7-5.3L4 8"/><path d="M4 4.5V8h3.5"/><path d="M4 13a8 8 0 0 0 13.7 5.3L20 16"/><path d="M20 19.5V16h-3.5"/>'),
      wifi: P('<path d="M2.5 8.5a15 15 0 0 1 19 0"/><path d="M6 12.3a10 10 0 0 1 12 0"/><path d="M9.3 16a5 5 0 0 1 5.4 0"/><path d="M12 19.6v.01"/>'),
      wifiOff: P('<path d="M2 2l20 20"/><path d="M8.6 12.8a10 10 0 0 1 3-1.4"/><path d="M5 9.2a15 15 0 0 1 4.3-2"/><path d="M14.6 7.3A15 15 0 0 1 21.5 8.5"/><path d="M12 19.6v.01"/>'),
      search: P('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
      chevron: P('<path d="m9 6 6 6-6 6"/>'),
      chevronDown: P('<path d="m6 9 6 6 6-6"/>'),
      camera: P('<path d="M4 8.5h2.6L8 6h8l1.4 2.5H20A1.5 1.5 0 0 1 21.5 10v8A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18v-8A1.5 1.5 0 0 1 4 8.5Z"/><circle cx="12" cy="13.6" r="3.4"/>'),
      phone: P('<path d="M7.5 3.5h9A2 2 0 0 1 18.5 6v12a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z"/><path d="M11 18h2"/>'),
      mail: P('<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/>'),
      lock: P('<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 15v2.2"/>'),
      sun: P('<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>'),
      moon: P('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>'),
      play: F('<path d="M7 4.5v15l13-7.5-13-7.5Z"/>'),
      pause: F('<rect x="6.5" y="4.5" width="4" height="15" rx="1.4"/><rect x="13.5" y="4.5" width="4" height="15" rx="1.4"/>'),
      flag: P('<path d="M5 21V4"/><path d="M5 4.8h11l-1.6 3.7L16 12.2H5"/>'),
      map: P('<path d="M9 3.5 3.5 5.8v14.7L9 18.2l6 2.3 5.5-2.3V3.5L15 5.8 9 3.5Z"/><path d="M9 3.5v14.7M15 5.8v14.7"/>'),
      book: P('<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v16.5H5.5A1.5 1.5 0 0 0 4 21V4.5Z"/><path d="M4 17.5h15"/>'),
      list: P('<path d="M8 6h13M8 12h13M8 18h13"/><path d="M3.5 6v.01M3.5 12v.01M3.5 18v.01"/>'),
      filter: P('<path d="M3.5 5.5h17l-6.5 8V20l-4-2.2v-4.3l-6.5-8Z"/>'),
      more: P('<circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/>'),
      door: P('<path d="M5 21V3.8A.8.8 0 0 1 5.8 3l10.4 1.4a.8.8 0 0 1 .7.8V21"/><path d="M3 21h18"/><path d="M13.4 12.4v.01"/>'),
      swap: P('<path d="M4 8h13l-3-3"/><path d="M20 16H7l3 3"/>'),
      star: P('<path d="m12 3.6 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3.6Z"/>'),
      zap: P('<path d="M13.5 2.5 5 13.5h5.5l-1 8L18 10.5h-5.5l1-8Z"/>'),
      building: P('<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8.5 7h2M13.5 7h2M8.5 11h2M13.5 11h2M8.5 15h2M13.5 15h2"/><path d="M10 21v-3h4v3"/>'),
      heart: P('<path d="M12 20.3S3.8 15.4 3.8 9.6A4.6 4.6 0 0 1 12 6.9a4.6 4.6 0 0 1 8.2 2.7c0 5.8-8.2 10.7-8.2 10.7Z"/>'),
      sparkle: P('<path d="M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9 12 3.5Z"/>'),
      chart2: P('<path d="M3.5 3.5v17h17"/><path d="m7 15 3.5-4 3 2.6L20 7.5"/>'),
      layers: P('<path d="m12 3 8.5 4.6L12 12.2 3.5 7.6 12 3Z"/><path d="m3.5 12.4 8.5 4.6 8.5-4.6"/><path d="m3.5 16.8 8.5 4.6 8.5-4.6"/>'),
      send: P('<path d="M21 3 10.5 13.5"/><path d="M21 3l-6.8 18-3.7-7.5L3 9.8 21 3Z"/>'),
      key: P('<circle cx="8" cy="14" r="3.6"/><path d="m10.8 11.5 8-8"/><path d="m16.5 5.8 2.2 2.2 2-2-2.2-2.2"/>'),
      shuffle: P('<path d="M4 6h3.5l3 4"/><path d="M20 6h-3.5l-9 12H4"/><path d="M18.5 4l2 2-2 2"/><path d="M18.5 16l2 2-2 2"/>'),
      target: P('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.6"/><circle cx="12" cy="12" r="1"/>'),
      user: P('<circle cx="12" cy="8.2" r="3.7"/><path d="M4.8 20.5a7.2 7.2 0 0 1 14.4 0"/>'),
      userCheck: P('<circle cx="10" cy="8.2" r="3.7"/><path d="M3.5 20.5a6.9 6.9 0 0 1 11.4-5.3"/><path d="m16 17.5 2 2 4-4.5"/>'),
      arrowRight: P('<path d="M5 12h13"/><path d="m13 6.5 5.5 5.5L13 17.5"/>'),
      arrowUp: P('<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>'),
      arrowDown: P('<path d="M12 5v14"/><path d="m6 13 6 6 6-6"/>'),
      finger: P('<path d="M12 3.5a6 6 0 0 0-6 6v3.2"/><path d="M12 20.5a5 5 0 0 0 5-5v-6a5 5 0 0 0-10 0v6a2 2 0 0 0 4 0v-5"/>'),
      offline: P('<path d="M3.5 3.5l17 17"/><path d="M9.5 20.5h5"/><path d="M6.8 13.6A4 4 0 0 1 12 8.2a4 4 0 0 1 3.4 1.8"/><path d="M17.6 16.5c1.6-.7 2.6-2.2 2.6-3.9a5 5 0 0 0-3.6-4.7"/>'),
    };
    const _svg = m[name] || m.info;
    const _ex = extra || "";
    return P(_svg, _ex.includes("class=") ? _ex : _ex + ' class="cp-icon"');
  };

  /* ---------- distinct colours per role ---------------------------------- */
  CP.ROLES = {
    admin: { label: "Administrator", short: "Admin", color: "#ec4899", icon: "shield", blurb: "System owner — everything" },
    head: { label: "Head Teacher", short: "Head", color: "#eab308", icon: "building", blurb: "Whole-school oversight" },
    dos: { label: "Director of Studies", short: "DOS", color: "#6366f1", icon: "target", blurb: "Lessons & punctuality" },
    teacher: { label: "Teacher", short: "Teacher", color: "#10b981", icon: "book", blurb: "My day & my scans" },
  };

  /* ---------- view registries ------------------------------------------- */
  // Declared here (the first script loaded) so every later file can register
  // its own panels the moment it runs, whatever the load order ends up being.
  CP.views = CP.views || { teacher: {}, dos: {}, head: {}, admin: {} };
  ["teacher", "dos", "head", "admin"].forEach((r) => (CP.views[r] = CP.views[r] || {}));
  CP.actions = CP.actions || {};   // shared "run this command" handlers
})(window);
