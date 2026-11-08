/* ==========================================================================
   ClassPulse — export.js : real .xlsx files, CSV and print sheets.
   No libraries. The .xlsx is a small, valid OOXML package written as a
   stored (uncompressed) zip, so it opens in Excel, LibreOffice and Sheets.
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const X = (CP.exp = {});

  /* ------------------------------------------------------------- crc32 */
  let TABLE = null;
  function crcTable() {
    if (TABLE) return TABLE;
    TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      TABLE[n] = c >>> 0;
    }
    return TABLE;
  }
  function crc32(bytes) {
    const t = crcTable();
    let c = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  X.crc32 = crc32;

  /* --------------------------------------------------------------- zip */
  const enc = new TextEncoder();
  function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time: time & 0xffff, date: date & 0xffff };
  }
  X.zipStore = function (files) {
    const when = dosDateTime(new Date());
    const chunks = [];
    const central = [];
    let offset = 0;
    files.forEach((f) => {
      const name = enc.encode(f.name);
      const data = typeof f.data === "string" ? enc.encode(f.data) : f.data;
      const crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(8, 0, true); lh.setUint16(10, when.time, true); lh.setUint16(12, when.date, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
      lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
      chunks.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(10, 0, true); ch.setUint16(12, when.time, true); ch.setUint16(14, when.date, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
      ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + data.length;
    });
    let centralSize = 0;
    central.forEach((c) => (centralSize += c.length));
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
    const all = chunks.concat(central, [new Uint8Array(end.buffer)]);
    let total = 0;
    all.forEach((c) => (total += c.length));
    const out = new Uint8Array(total);
    let p = 0;
    all.forEach((c) => { out.set(c, p); p += c.length; });
    return out;
  };

  /* -------------------------------------------------------------- xlsx */
  function xml(s) {
    return String(s == null ? "" : s)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function colName(i) {
    let s = "";
    i += 1;
    while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
    return s;
  }
  function sheetName(n, used) {
    let s = String(n || "Sheet").replace(/[\[\]:*?\/\\]/g, " ").trim().slice(0, 31) || "Sheet";
    let base = s, k = 2;
    while (used.indexOf(s.toLowerCase()) >= 0) { s = base.slice(0, 28) + " " + k++; }
    used.push(s.toLowerCase());
    return s;
  }
  // sheets: [{ name, rows: [[cell,...],...], headerRows?: 1 }]  (cells: string | number | null)
  X.xlsxBytes = function (sheets) {
    const used = [];
    const names = sheets.map((s) => sheetName(s.name, used));
    const sheetXml = sheets.map((sh) => {
      const rows = sh.rows || [];
      const widths = [];
      const headerRows = sh.headerRows == null ? 1 : sh.headerRows;
      const body = rows.map((row, r) => {
        const cells = (row || []).map((v, c) => {
          const len = String(v == null ? "" : v).length;
          widths[c] = Math.max(widths[c] || 8, Math.min(60, len + 2));
          const ref = colName(c) + (r + 1);
          const st = r < headerRows ? ' s="1"' : "";
          if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
          if (v === null || v === undefined || v === "") return `<c r="${ref}"${st}/>`;
          return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
        }).join("");
        return `<row r="${r + 1}">${cells}</row>`;
      }).join("");
      const cols = widths.length ? "<cols>" + widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("") + "</cols>" : "";
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`;
    });
    const files = [
      { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
      { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
      { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${xml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
      { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${names.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${names.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
      { name: "xl/styles.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    ].concat(sheetXml.map((d, i) => ({ name: "xl/worksheets/sheet" + (i + 1) + ".xml", data: d })));
    return X.zipStore(files);
  };
  X.xlsxBlob = function (sheets) {
    return new Blob([X.xlsxBytes(sheets)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  };

  /* --------------------------------------------------------------- csv */
  X.csv = function (columns, rows) {
    const q = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    return [columns.map(q).join(",")].concat(rows.map((r) => r.map(q).join(","))).join("\r\n");
  };

  X.download = function (blob, filename) {
    if (CP.store && CP.store.download) return CP.store.download(blob, filename);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  /* ------------------------------------------------------------- print */
  // tables: [{ heading?, columns:[], rows:[[]], note? }]; meta: [string]
  X.printHtml = function (title, tables, meta) {
    const school = (CP.store && CP.store.data && CP.store.data.school) || {};
    const wide = tables.some((t) => (t.columns || []).length > 7);
    return `<!doctype html><html><head><meta charset="utf-8"><title>${CP.esc(title)}</title>
<style>
@page{size:A4 ${wide ? "landscape" : "portrait"};margin:12mm}
body{font:12px/1.45 "Segoe UI",system-ui,sans-serif;margin:0;color:#111}
.hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:10px}
h1{font-size:17px;margin:0 0 3px}h2{font-size:13px;margin:16px 0 6px}
.meta{font-size:10.5px;color:#555}
table{border-collapse:collapse;width:100%;font-size:11px;margin-bottom:6px}
th,td{border:1px solid #999;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#eee}
.note{font-size:10.5px;color:#444;margin:2px 0 10px}
.sign{margin-top:34px;display:flex;gap:40px;font-size:11px}.sign div{flex:1;border-top:1px solid #111;padding-top:4px}
tr{page-break-inside:avoid}
</style></head><body>
<div class="hdr"><div><h1>${CP.esc(title)}</h1>
<div class="meta">${(meta || []).map((m) => CP.esc(m)).join(" · ")}${meta && meta.length ? " · " : ""}Generated by ClassPulse · ${CP.esc(new Date().toLocaleString())}</div></div>
<div style="text-align:right;font-size:11px"><b>${CP.esc(school.name || "")}</b><br>${CP.esc(school.term || "")}</div></div>
${tables.map((t) => `${t.heading ? `<h2>${CP.esc(t.heading)}</h2>` : ""}
<table><thead><tr>${t.columns.map((c) => `<th>${CP.esc(c)}</th>`).join("")}</tr></thead>
<tbody>${t.rows.length ? t.rows.map((r) => `<tr>${r.map((v) => `<td>${CP.esc(v == null ? "" : v)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${t.columns.length}">No records.</td></tr>`}</tbody></table>
${t.note ? `<div class="note">${CP.esc(t.note)}</div>` : ""}`).join("")}
<div class="sign"><div>Prepared by</div><div>Director of Studies</div><div>Head Teacher</div></div>
<script>setTimeout(function(){window.print()},350)<\/script></body></html>`;
  };
  X.print = function (title, tables, meta) {
    const w = window.open("", "_blank");
    if (!w) { CP.toast({ kind: "err", msg: "Allow pop-ups to print, or use the Excel export." }); return false; }
    w.document.write(X.printHtml(title, tables, meta));
    w.document.close();
    return true;
  };
})(window);
