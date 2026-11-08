/* ==========================================================================
   ClassPulse — ui.js : toasts, sheets, dialogs, reusable snippets
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;

  function overlays() {
    let el = document.getElementById("overlays");
    if (!el) { el = document.createElement("div"); el.id = "overlays"; document.body.appendChild(el); }
    return el;
  }

  /* --------------------------------------------------------------- toast */
  CP.toast = function (o) {
    if (typeof o === "string") o = { msg: o };
    let host = document.getElementById("toasts");
    if (!host) { host = document.createElement("div"); host.className = "toasts"; host.id = "toasts"; document.body.appendChild(host); }
    const el = document.createElement("div");
    el.className = "toast " + (o.kind || "");
    const ic = o.kind === "ok" ? "checkCircle" : o.kind === "err" ? "xCircle" : o.kind === "warn" ? "alert" : "info";
    el.innerHTML = `<span class="ic" style="color:${o.kind === "ok" ? "var(--ok)" : o.kind === "err" ? "var(--danger)" : o.kind === "warn" ? "var(--warn)" : "var(--info)"}">${CP.icon(ic)}</span><span class="grow">${CP.esc(o.msg)}</span>`;
    host.appendChild(el);
    setTimeout(() => {
      el.style.transition = "opacity .3s, transform .3s";
      el.style.opacity = "0"; el.style.transform = "translateY(-10px)";
      setTimeout(() => el.remove(), 320);
    }, o.ms || 3000);
  };

  /* --------------------------------------------------------------- sheet */
  CP.sheet = function (o) {
    const scrim = document.createElement("div");
    scrim.className = "scrim";
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    sheet.innerHTML = `
      <div class="grab"></div>
      ${o.title ? `<div class="row between mb-4"><h2>${CP.esc(o.title)}</h2>
        <button class="icon-btn" data-close>${CP.icon("x")}</button></div>` : ""}
      <div data-body></div>`;
    const body = sheet.querySelector("[data-body]");
    if (typeof o.body === "string") body.innerHTML = o.body;
    else if (o.body) body.appendChild(o.body);
    scrim.appendChild(sheet);
    overlays().appendChild(scrim);
    requestAnimationFrame(() => scrim.style.opacity = "1");

    function close() {
      scrim.style.transition = "opacity .18s";
      scrim.style.opacity = "0";
      setTimeout(() => scrim.remove(), 190);
      document.removeEventListener("keydown", onKey);
      o.onClose && o.onClose();
    }
    function onKey(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", onKey);
    scrim.addEventListener("click", (e) => { if (e.target === scrim && o.dismissable !== false) close(); });
    sheet.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
    CP.haptic(8);
    return { close, el: sheet, body };
  };

  /* -------------------------------------------------------------- confirm */
  CP.confirm = function (o) {
    return new Promise((resolve) => {
      const s = CP.sheet({
        title: o.title || "Are you sure?",
        body: `<p class="muted t-sm mb-5">${CP.esc(o.msg || "")}</p>
          <div class="row gap-3">
            <button class="btn grow" data-no>${CP.esc(o.cancel || "Cancel")}</button>
            <button class="btn ${o.danger ? "danger" : "primary"} grow" data-yes>${CP.esc(o.ok || "Confirm")}</button>
          </div>`,
        onClose: () => resolve(false),
      });
      s.body.querySelector("[data-no]").onclick = () => { s.close(); resolve(false); };
      s.body.querySelector("[data-yes]").onclick = () => { resolve(true); s.close(); };
    });
  };

  /* --------------------------------------------------------------- prompt */
  CP.prompt = function (o) {
    return new Promise((resolve) => {
      const s = CP.sheet({
        title: o.title || "Enter value",
        body: `<div class="field mb-5"><label>${CP.esc(o.label || "")}</label>
            <input class="input" data-in type="${o.type || "text"}" value="${CP.esc(o.value || "")}"
              placeholder="${CP.esc(o.placeholder || "")}" ${o.inputmode ? `inputmode="${o.inputmode}"` : ""}>
          </div>
          <div class="row gap-3">
            <button class="btn grow" data-no>Cancel</button>
            <button class="btn primary grow" data-yes>Save</button>
          </div>`,
        onClose: () => resolve(null),
      });
      const input = s.body.querySelector("[data-in]");
      setTimeout(() => input.focus(), 120);
      s.body.querySelector("[data-no]").onclick = () => { s.close(); resolve(null); };
      s.body.querySelector("[data-yes]").onclick = () => { const v = input.value; resolve(v); s.close(); };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { const v = input.value; resolve(v); s.close(); }
      });
    });
  };

  /* --------------------------------------------------------------- picker */
  CP.pick = function (o) {
    return new Promise((resolve) => {
      const s = CP.sheet({
        title: o.title || "Choose",
        body: `<div class="list" data-list>${o.options
          .map((x, i) => `<button class="li press" data-i="${i}">
              ${x.icon ? `<span style="width:34px;height:34px;border-radius:11px;display:grid;place-items:center;background:${x.color || "var(--bg-2)"};color:#fff">${CP.icon(x.icon)}</span>` : ""}
              <span class="body"><span class="name">${CP.esc(x.label)}</span>
                ${x.sub ? `<span class="meta">${CP.esc(x.sub)}</span>` : ""}</span>
              ${CP.icon("chevron")}
            </button>`).join("")}</div>`,
        onClose: () => resolve(null),
      });
      s.body.querySelectorAll("[data-i]").forEach((b) =>
        b.addEventListener("click", () => { const v = o.options[+b.dataset.i].value; s.close(); resolve(v); })
      );
    });
  };

  /* --------------------------------------------------------- state labels */
  const STATE = {
    "on-time": { label: "On time", cls: "ok", icon: "check" },
    late: { label: "Late", cls: "warn", icon: "clock" },
    missing: { label: "Not attended", cls: "danger", icon: "x" },
    absent: { label: "Absent", cls: "danger", icon: "xCircle" },
    covered: { label: "Covered", cls: "info", icon: "swap" },
    pending: { label: "Pending", cls: "", icon: "timer" },
    leave: { label: "On leave / duty", cls: "info", icon: "calendar" },
    cancelled: { label: "Cancelled", cls: "", icon: "x" },
  };
  CP.stateMeta = (s) => STATE[s] || { label: s, cls: "", icon: "info" };
  CP.pill = function (state, text) {
    const m = CP.stateMeta(state);
    return `<span class="pill ${m.cls}"><span class="dt"></span>${CP.esc(text || m.label)}</span>`;
  };
  CP.dotColor = (state) =>
    ({ "on-time": "var(--ok)", late: "var(--warn)", missing: "var(--danger)", absent: "var(--danger)", covered: "var(--info)", pending: "var(--fg-3)", leave: "var(--info)" }[state] || "var(--fg-3)");

  /* ------------------------------------------------------------- avatars */
  CP.avatarHTML = function (user, size) {
    const u = typeof user === "string" ? { name: user } : user || { name: "?" };
    const grad = CP.avatarGradient(u.id || u.name);
    const dot = u.online
      ? `<span class="dot" style="background:var(--ok)"></span>`
      : "";
    return `<span class="avatar ${size || ""}" style="background:${grad}">${CP.initials(u.name)}${dot}</span>`;
  };

  /* --------------------------------------------------------------- pieces */
  CP.stat = function (o) {
    return `<div class="stat accentbar ${o.tone || ""}">
      <div class="k">${CP.esc(o.k)}</div>
      <div class="v ${o.tone || ""}">${o.v}</div>
      ${o.d ? `<div class="d">${o.d}</div>` : ""}
      ${o.spark || ""}
    </div>`;
  };

  CP.li = function (o) {
    return `<div class="li ${o.left ? "left " + o.left : ""} ${o.press ? "press" : ""}" ${o.attr || ""}>
      ${o.lead || ""}
      <div class="body">
        <div class="name truncate">${o.name}</div>
        ${o.meta ? `<div class="meta">${o.meta}</div>` : ""}
      </div>
      ${o.tail ? `<div class="tail">${o.tail}</div>` : ""}
    </div>`;
  };

  CP.empty = function (title, sub, icon) {
    return `<div class="empty">${CP.icon(icon || "sparkle")}
      <div class="fw-6 t-md">${CP.esc(title)}</div>
      ${sub ? `<div class="t-sm dim mt-2">${CP.esc(sub)}</div>` : ""}</div>`;
  };

  CP.banner = function (kind, title, text, icon) {
    return `<div class="banner ${kind}">
      <span class="ic ${kind === "danger" ? "danger" : kind === "warn" ? "warn" : "info"}">${CP.icon(icon || (kind === "danger" ? "alert" : kind === "warn" ? "alert" : "info"))}</span>
      <div class="grow"><div class="fw-7 t-sm">${CP.esc(title)}</div>
      <div class="t-sm muted mt-1">${CP.esc(text)}</div></div></div>`;
  };

  CP.section = function (title, action) {
    return `<div class="row between mt-5 mb-3">
      <h3 class="upper dim" style="margin:0">${CP.esc(title)}</h3>
      ${action || ""}
    </div>`;
  };

  CP.seg = function (name, items, active) {
    return `<div class="seg" data-seg="${name}">${items
      .map((i) => `<button data-v="${i.value}" class="${i.value === active ? "on" : ""}">${CP.esc(i.label)}</button>`)
      .join("")}</div>`;
  };

  CP.bindSeg = function (root, name, cb) {
    const el = root.querySelector(`[data-seg="${name}"]`);
    if (!el) return;
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (!b) return;
      el.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      CP.haptic(8);
      cb(b.dataset.v);
    });
  };

  /* --------------------------------------------------------- success burst */
  CP.burst = function (o) {
    const el = document.createElement("div");
    el.className = "burst";
    const ok = o.kind !== "err";
    const col = ok ? "var(--ok)" : "var(--danger)";
    el.innerHTML = `<div class="text-c">
      <div class="ring" style="margin:0 auto">
        <svg viewBox="0 0 120 120">
          <circle cx="60" cy="60" r="54" fill="none" stroke="var(--line)" stroke-width="7"/>
          <circle class="path" cx="60" cy="60" r="54" fill="none" stroke="${col}" stroke-width="7"
            stroke-linecap="round" stroke-dasharray="340" />
        </svg>
        <div class="tick" style="color:${col}">${CP.icon(ok ? "check" : "x", ' style="stroke-width:2.6"')}</div>
      </div>
      <div class="mt-5 t-lg fw-7">${CP.esc(o.title || (ok ? "Recorded" : "Failed"))}</div>
      ${o.sub ? `<div class="mt-2 t-sm muted">${CP.esc(o.sub)}</div>` : ""}
      ${o.extra ? `<div class="mt-4">${o.extra}</div>` : ""}
    </div>`;
    overlays().appendChild(el);
    CP.haptic(ok ? [12, 40, 22] : [30, 60, 30]);
    const kill = () => { el.style.transition = "opacity .25s"; el.style.opacity = "0"; setTimeout(() => el.remove(), 260); };
    el.addEventListener("click", kill);
    setTimeout(kill, o.ms || (ok ? 1900 : 2600));
    return kill;
  };

  /* ------------------------------------------------------------ skeletons */
  CP.skeletonList = function (n) {
    return Array.from({ length: n || 4 }).map(() =>
      `<div class="li"><div class="skeleton" style="width:38px;height:38px;border-radius:13px"></div>
        <div class="body"><div class="skeleton" style="height:13px;width:55%"></div>
        <div class="skeleton mt-2" style="height:10px;width:35%"></div></div></div>`).join("");
  };

  /* ------------------------------------------------------------ go/attach */
  CP.on = function (root, sel, evt, fn) {
    root.querySelectorAll(sel).forEach((el) => el.addEventListener(evt, fn));
  };
})(window);
