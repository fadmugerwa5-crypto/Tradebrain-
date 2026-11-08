/* ==========================================================================
   ClassPulse — qr.js : QR generation (vendored qrcode-generator) and
   camera scanning (vendored jsQR + native BarcodeDetector when available).
   ========================================================================== */
(function (global) {
  "use strict";
  const CP = global.CP;
  const Q = (CP.qr = {});

  /* ------------------------------------------------------------ generate */
  Q.svg = function (text, opts) {
    opts = opts || {};
    const cell = opts.cell || 5;
    const margin = opts.margin == null ? 2 : opts.margin;
    try {
      const qr = global.qrcode(0, opts.ec || "M");
      qr.addData(String(text));
      qr.make();
      return qr.createSvgTag({ cellSize: cell, margin: margin, scalable: true })
        .replace(/width="[^"]*"/, "")
        .replace(/height="[^"]*"/, "")
        .replace("<svg ", '<svg class="cp-qr" ');
    } catch (e) {
      console.error("qr gen", e);
      return '<div style="padding:20px;color:#000">QR unavailable</div>';
    }
  };

  Q.canvas = function (text, opts) {
    opts = opts || {};
    const wrap = document.createElement("div");
    wrap.innerHTML = Q.svg(text, opts);
    return wrap.firstElementChild;
  };

  /* --------------------------------------------------------------- scan */
  // Live camera scanner. Works on Android (native BarcodeDetector fast path)
  // and everywhere else through jsQR. Requires a secure context (https or
  // localhost) because browsers gate camera access on it.
  Q.createScanner = function (video, canvas, onResult) {
    let stream = null;
    let raf = null;
    let stopped = false;
    let detector = null;
    let lastHit = 0;
    let lastText = "";

    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    function frame() {
      if (stopped) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const w = Math.min(640, video.videoWidth);
        const h = Math.round((w / video.videoWidth) * video.videoHeight);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w; canvas.height = h;
        }
        ctx.drawImage(video, 0, 0, w, h);

        if (detector) {
          detector
            .detect(canvas)
            .then((codes) => {
              if (codes && codes.length) fire(codes[0].rawValue);
            })
            .catch(() => {});
        } else {
          const img = ctx.getImageData(0, 0, w, h);
          const res = global.jsQR(img.data, w, h, { inversionAttempts: "dontInvert" });
          if (res && res.data) fire(res.data);
        }
      }
      raf = requestAnimationFrame(frame);
    }

    function fire(text) {
      const now = Date.now();
      if (text === lastText && now - lastHit < 2500) return; // debounce dupes
      lastText = text; lastHit = now;
      CP.haptic(18);
      onResult(text);
    }

    return {
      async start() {
        if (!CP.hasCamera()) throw new Error("This device has no camera API.");
        if (!CP.secureContext()) throw new Error("Camera needs a secure origin (https:// or http://localhost).");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        video.srcObject = stream;
        video.setAttribute("playsinline", "true");
        await video.play().catch(() => {});
        if (global.BarcodeDetector) {
          try {
            const fmts = await global.BarcodeDetector.getSupportedFormats();
            if (fmts && fmts.indexOf("qr_code") >= 0) {
              detector = new global.BarcodeDetector({ formats: ["qr_code"] });
            }
          } catch (e) { detector = null; }
        }
        stopped = false;
        raf = requestAnimationFrame(frame);
        return true;
      },
      stop() {
        stopped = true;
        if (raf) cancelAnimationFrame(raf);
        raf = null;
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
        if (video) video.srcObject = null;
      },
      get running() { return !!stream; },
    };
  };

  /* --------------------------------------------------------- scan a file */
  Q.fromImageFile = function (file, cb) {
    const img = new Image();
    img.onload = function () {
      const c = document.createElement("canvas");
      const w = Math.min(1000, img.width);
      const h = Math.round((w / img.width) * img.height);
      c.width = w; c.height = h;
      const cx = c.getContext("2d");
      cx.drawImage(img, 0, 0, w, h);
      const d = cx.getImageData(0, 0, w, h);
      const r = global.jsQR(d.data, w, h, { inversionAttempts: "attemptBoth" });
      cb(r && r.data ? r.data : null);
    };
    img.onerror = () => cb(null);
    img.src = URL.createObjectURL(file);
  };
})(window);
