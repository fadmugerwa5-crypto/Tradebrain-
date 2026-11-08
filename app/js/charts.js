/* ==========================================================================
   ClassPulse — charts.js : dependency-free SVG charts
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const CH = (CP.charts = {});

  const NS = "http://www.w3.org/2000/svg";

  /* ---------------------------------------------------------------- ring */
  CH.ring = function (value, o) {
    o = o || {};
    const size = o.size || 132;
    const sw = o.stroke || 11;
    const r = (size - sw) / 2;
    const c = 2 * Math.PI * r;
    const v = CP.clamp(value, 0, 100);
    const off = c - (v / 100) * c;
    const col = o.color || (v >= 90 ? "var(--ok)" : v >= 75 ? "var(--accent-500)" : v >= 60 ? "var(--warn)" : "var(--danger)");
    const id = "g" + Math.random().toString(36).slice(2, 7);
    return `<div class="ring-stat" style="${o.style || ""}">
      <svg viewBox="0 0 ${size} ${size}">
        <defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${col}" stop-opacity="1"/>
          <stop offset="100%" stop-color="${col}" stop-opacity=".55"/>
        </linearGradient></defs>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--line)" stroke-width="${sw}"/>
        <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="url(#${id})" stroke-width="${sw}"
          stroke-linecap="round" stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${off.toFixed(1)}"
          style="transition:stroke-dashoffset .8s cubic-bezier(.22,1,.36,1)"/>
      </svg>
      <div class="mid"><div><div class="v" style="color:${col}">${o.text != null ? o.text : v + "%"}</div>
      ${o.label ? `<div class="k">${CP.esc(o.label)}</div>` : ""}</div></div>
    </div>`;
  };

  /* ---------------------------------------------------------------- bars */
  CH.bars = function (data, o) {
    o = o || {};
    const h = o.height || 150;
    const padB = 22, padT = 10;
    const n = Math.max(1, data.length);
    const max = Math.max.apply(null, data.map((d) => d.value).concat([1]));
    const bw = 100 / n;
    const bars = data.map((d, i) => {
      const vh = ((h - padB - padT) * d.value) / max;
      const x = i * bw + bw * 0.18;
      const w = bw * 0.64;
      const y = h - padB - vh;
      const col = d.color || "var(--brand-500)";
      return `<g>
        <rect x="${x}%" y="${y}" width="${w}%" height="${Math.max(2, vh)}" rx="4" fill="${col}" opacity="${d.dim ? .35 : 1}">
          <animate attributeName="height" from="0" to="${Math.max(2, vh)}" dur=".6s" fill="freeze"/>
          <animate attributeName="y" from="${h - padB}" to="${y}" dur=".6s" fill="freeze"/>
        </rect>
        ${o.values !== false && d.show !== false ? `<text x="${x + w / 2}%" y="${y - 5}" text-anchor="middle" font-size="9.5" fill="var(--fg-2)" font-weight="700">${d.top != null ? d.top : ""}</text>` : ""}
        <text x="${x + w / 2}%" y="${h - 7}" text-anchor="middle" font-size="9.5" fill="var(--fg-3)" font-weight="600">${CP.esc(d.label)}</text>
      </g>`;
    }).join("");
    return `<svg class="chart-svg" viewBox="0 0 100 ${h}" preserveAspectRatio="none" style="height:${h}px">
      <line x1="0" y1="${h - padB}" x2="100" y2="${h - padB}" stroke="var(--line)"/>
      ${bars}</svg>`;
  };

  /* ----------------------------------------------------------- stacked bar */
  CH.stack = function (rows, o) {
    o = o || {};
    const keys = o.keys;
    const colors = o.colors;
    return `<div class="col gap-3">${rows.map((r) => {
      const total = CP.sum(keys, (k) => r[k] || 0) || 1;
      return `<div>
        <div class="row between t-sm mb-2"><span class="fw-6 truncate">${CP.esc(r.label)}</span>
          <span class="dim mono">${r.total != null ? r.total : total}</span></div>
        <div style="display:flex;height:9px;border-radius:99px;overflow:hidden;background:var(--bg-2)">
          ${keys.map((k, i) => r[k] ? `<div style="flex:${r[k]};background:${colors[i]}" title="${CP.esc(o.labels ? o.labels[i] : k)}: ${r[k]}"></div>` : "").join("")}
        </div>
      </div>`;
    }).join("")}</div>`;
  };

  /* --------------------------------------------------------------- spark */
  CH.spark = function (values, o) {
    o = o || {};
    if (!values.length) return "";
    const w = 100, h = o.height || 30;
    const max = Math.max.apply(null, values);
    const min = Math.min.apply(null, values);
    const span = max - min || 1;
    const pts = values.map((v, i) => [(i / (values.length - 1 || 1)) * w, h - ((v - min) / span) * (h - 6) - 3]);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
    const id = "s" + Math.random().toString(36).slice(2, 7);
    const col = o.color || "var(--brand-400)";
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${col}" stop-opacity=".45"/>
        <stop offset="100%" stop-color="${col}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${d} L${w} ${h} L0 ${h} Z" fill="url(#${id})"/>
      <path d="${d}" fill="none" stroke="${col}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  };

  /* ---------------------------------------------------------------- line */
  CH.line = function (series, o) {
    o = o || {};
    const h = o.height || 170;
    const padL = 4, padB = 20, padT = 12;
    const all = series.reduce((a, s) => a.concat(s.values), []);
    const max = Math.max.apply(null, all.concat([1]));
    const n = Math.max(1, series[0].values.length);
    const X = (i) => padL + (i / (n - 1 || 1)) * (100 - padL * 2);
    const Y = (v) => h - padB - (v / max) * (h - padB - padT);
    return `<svg class="chart-svg" viewBox="0 0 100 ${h}" preserveAspectRatio="none" style="height:${h}px">
      ${[0, 0.25, 0.5, 0.75, 1].map((g) => `<line x1="0" x2="100" y1="${(h - padB) * (1 - g) + padT * g}" y2="${(h - padB) * (1 - g) + padT * g}" stroke="var(--line)" stroke-dasharray="2 3"/>`).join("")}
      ${series.map((s) => {
        const d = s.values.map((v, i) => (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(v).toFixed(1)).join(" ");
        return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round"/>` +
          s.values.map((v, i) => `<circle cx="${X(i).toFixed(1)}" cy="${Y(v).toFixed(1)}" r="1.6" fill="${s.color}"/>`).join("");
      }).join("")}
      ${o.labels ? o.labels.map((l, i) => `<text x="${X(i).toFixed(1)}" y="${h - 5}" text-anchor="middle" font-size="8.5" fill="var(--fg-3)">${CP.esc(l)}</text>`).join("") : ""}
    </svg>`;
  };

  /* -------------------------------------------------------------- heatmap */
  CH.heatmap = function (o) {
    // o = { rows:[{label, values:[0..1]}], cols:[labels] }
    const cells = o.rows.map((r) =>
      `<div class="row gap-2"><div class="t-xs dim truncate" style="width:58px;text-align:right">${CP.esc(r.label)}</div>
        <div class="grow heat" style="grid-template-columns:repeat(${r.values.length},1fr)">
          ${r.values.map((v) => {
            const c = v == null ? "var(--bg-3)" :
              `color-mix(in srgb, ${v >= 90 ? "var(--ok)" : v >= 75 ? "var(--accent-500)" : v >= 60 ? "var(--warn)" : "var(--danger)"} ${Math.max(12, v)}%, transparent)`;
            return `<div class="cell" style="background:${c}" title="${v == null ? "—" : v + "%"}"></div>`;
          }).join("")}
        </div></div>`).join("");
    return `<div class="col gap-2">
      <div class="row gap-2"><div style="width:58px"></div>
        <div class="grow heat" style="grid-template-columns:repeat(${o.cols.length},1fr)">
          ${o.cols.map((c) => `<div class="t-xs dim text-c">${CP.esc(c)}</div>`).join("")}</div></div>
      ${cells}</div>`;
  };

  /* ------------------------------------------------------------ donut list */
  CH.donut = function (parts, o) {
    o = o || {};
    const size = o.size || 120;
    const sw = o.stroke || 16;
    const r = (size - sw) / 2;
    const c = 2 * Math.PI * r;
    const total = CP.sum(parts, (p) => p.value) || 1;
    let acc = 0;
    const arcs = parts.map((p) => {
      const frac = p.value / total;
      const dash = frac * c;
      const el = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${p.color}"
        stroke-width="${sw}" stroke-dasharray="${dash.toFixed(1)} ${(c - dash).toFixed(1)}"
        stroke-dashoffset="${(-acc * c).toFixed(1)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
      acc += frac;
      return el;
    }).join("");
    return `<div class="col gap-3 center" style="align-items:center">
      <div style="position:relative;width:${size}px;height:${size}px">
        <svg viewBox="0 0 ${size} ${size}" style="width:100%;height:100%">
          <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--bg-3)" stroke-width="${sw}"/>
          ${arcs}
        </svg>
        <div style="position:absolute;inset:0;display:grid;place-items:center">
          <div class="text-c"><div class="t-xl fw-7">${o.center || total}</div>
          <div class="t-xs dim upper">${CP.esc(o.centerLabel || "total")}</div></div>
        </div>
      </div>
      <div class="col gap-2" style="width:100%">
        ${parts.map((p) => `<div class="row between t-sm"><span class="row gap-2"><i style="width:9px;height:9px;border-radius:3px;background:${p.color};display:inline-block"></i>${CP.esc(p.label)}</span><b class="mono">${p.value}</b></div>`).join("")}
      </div></div>`;
  };

  /* --------------------------------------------------------------- gauge */
  CH.gauge = function (value, o) {
    o = o || {};
    const size = o.size || 140;
    const col = value >= 90 ? "var(--ok)" : value >= 75 ? "var(--accent-500)" : value >= 60 ? "var(--warn)" : "var(--danger)";
    const r = size / 2 - 12;
    const cx = size / 2, cy = size / 2;
    const start = Math.PI * 0.75, end = Math.PI * 2.25;
    const a = start + (CP.clamp(value, 0, 100) / 100) * (end - start);
    const P = (ang) => [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
    const [x1, y1] = P(start), [x2, y2] = P(end), [x3, y3] = P(a);
    const large = a - start > Math.PI ? 1 : 0;
    return `<svg viewBox="0 0 ${size} ${size}" style="width:${size}px;height:${size}px">
      <path d="M${x1} ${y1} A${r} ${r} 0 1 1 ${x2} ${y2}" fill="none" stroke="var(--line)" stroke-width="10" stroke-linecap="round"/>
      <path d="M${x1} ${y1} A${r} ${r} 0 ${large} 1 ${x3} ${y3}" fill="none" stroke="${col}" stroke-width="10" stroke-linecap="round"/>
      <text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="24" font-weight="800" fill="${col}">${value}%</text>
      ${o.label ? `<text x="${cx}" y="${cy + 18}" text-anchor="middle" font-size="9" fill="var(--fg-3)" font-weight="700" letter-spacing="1">${CP.esc(o.label.toUpperCase())}</text>` : ""}
    </svg>`;
  };
})(window);
