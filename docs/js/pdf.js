/* Минимальный генератор PDF: по одной JPEG-странице на лист.
   Своими руками, чтобы не тянуть библиотеку и работать офлайн. */
(function (global) {
  "use strict";

  var MM_INCH = 25.4;
  var PT_MM = 72 / 25.4;

  var PAPERS = {
    a1: [594, 841], a2: [420, 594], a3: [297, 420], a4: [210, 297],
    letter: [215.9, 279.4], legal: [215.9, 355.6]
  };

  function choosePaper(wMm, hMm, margin, prefer) {
    if (prefer && prefer !== "auto") {
      var p = PAPERS[prefer];
      if (wMm <= p[0] && hMm <= p[1]) return [prefer, p[0], p[1], true];
      if (wMm <= p[1] && hMm <= p[0]) return [prefer, p[1], p[0], true];
      return [prefer, Math.max(p[0], p[1]), Math.min(p[0], p[1]), false];
    }
    var names = ["a4", "a3"];
    for (var i = 0; i < names.length; i++) {
      var q = PAPERS[names[i]];
      if (wMm <= q[0] - 2 * margin && hMm <= q[1] - 2 * margin) {
        return [names[i], q[0], q[1], true];
      }
      if (wMm <= q[1] - 2 * margin && hMm <= q[0] - 2 * margin) {
        return [names[i], q[1], q[0], true];
      }
    }
    var a4 = PAPERS.a4;
    return ["a4", wMm > hMm ? a4[1] : a4[0], wMm > hMm ? a4[0] : a4[1], false];
  }

  function canvas(w, h) {
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function jpegBytes(cv, q) {
    return new Promise(function (res) {
      cv.toBlob(function (blob) {
        var fr = new FileReader();
        fr.onload = function () { res(new Uint8Array(fr.result)); };
        fr.readAsArrayBuffer(blob);
      }, "image/jpeg", q == null ? 0.92 : q);
    });
  }

  function enc(s) {
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
    return out;
  }

  function cat(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), off = 0;
    for (i = 0; i < parts.length; i++) { out.set(parts[i], off); off += parts[i].length; }
    return out;
  }

  /* sheet — {canvas, widthMm, heightMm, dpi}; возвращает {blob, pages, ...}. */
  async function build(sheet, o) {
    o = o || {};
    var dpi = sheet.dpi;
    var ppm = dpi / MM_INCH;
    var margin = o.marginMm == null ? 10 : o.marginMm;
    var overlap = o.overlapMm == null ? 10 : o.overlapMm;
    var paper = o.paper || "auto";
    var wMm = sheet.widthMm, hMm = sheet.heightMm;
    var info = { pages: 1, paper: null, tiles: [1, 1], fits: true, dpi: dpi };

    // готовим страницы как JPEG
    var images = [];
    if (paper === "none") {
      images.push({ cv: sheet.canvas, w: wMm, h: hMm });
      info.paper = "none";
    } else {
      var ch = choosePaper(wMm, hMm, margin, paper);
      info.paper = ch[0];
      info.fits = ch[3];
      var pw = ch[1], ph = ch[2];
      if (ch[3]) {
        var page = canvas(pw * ppm, ph * ppm);
        var ctx = page.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, page.width, page.height);
        ctx.drawImage(sheet.canvas, Math.round((pw - wMm) / 2 * ppm),
                      Math.round((ph - hMm) / 2 * ppm));
        images.push({ cv: page, w: pw, h: ph });
      } else {
        var tw = pw - 2 * margin, th = ph - 2 * margin;
        var stepX = tw - overlap, stepY = th - overlap;
        var ncols = Math.max(1, Math.ceil((wMm - overlap) / stepX));
        var nrows = Math.max(1, Math.ceil((hMm - overlap) / stepY));
        info.tiles = [ncols, nrows];
        info.pages = ncols * nrows;
        for (var r = 0; r < nrows; r++) {
          for (var c = 0; c < ncols; c++) {
            var x0 = c * stepX, y0 = r * stepY;
            var x1 = Math.min(x0 + tw, wMm), y1 = Math.min(y0 + th, hMm);
            if (x1 <= x0 || y1 <= y0) continue;
            var pg = canvas(pw * ppm, ph * ppm);
            var g = pg.getContext("2d");
            g.fillStyle = "#fff";
            g.fillRect(0, 0, pg.width, pg.height);
            g.drawImage(sheet.canvas,
                        Math.round(x0 * ppm), Math.round(y0 * ppm),
                        Math.round((x1 - x0) * ppm), Math.round((y1 - y0) * ppm),
                        Math.round(margin * ppm), Math.round(margin * ppm),
                        Math.round((x1 - x0) * ppm), Math.round((y1 - y0) * ppm));
            g.fillStyle = "#3c3c3c";
            g.font = Math.max(9, Math.round(2.6 * ppm)) + "px Arial, sans-serif";
            g.textBaseline = "top";
            g.fillText("лист " + (images.length + 1) + "/" + info.pages +
                       " · колонка " + (c + 1) + "/" + ncols +
                       " · ряд " + (r + 1) + "/" + nrows +
                       " · наложение " + overlap + " мм",
                       margin * ppm, margin * ppm * 0.35);
            if (c > 0 || r > 0) {
              var m = margin * ppm;
              g.strokeStyle = "#969696";
              g.lineWidth = 2;
              g.beginPath();
              g.moveTo(m, m); g.lineTo(m + 9 * ppm, m);
              g.moveTo(m, m); g.lineTo(m, m + 9 * ppm);
              g.stroke();
            }
            images.push({ cv: pg, w: pw, h: ph });
          }
        }
        if (!images.length) {
          images.push({ cv: sheet.canvas, w: wMm, h: hMm });
          info.pages = 1;
        }
      }
    }

    // собираем PDF
    var parts = [], offsets = [], size = 0;
    function push(u8) { parts.push(u8); size += u8.length; }
    function objStart() { offsets.push(size); }

    push(enc("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"));
    var kids = [];
    var nextObj = 3;
    var plan = images.map(function (im) {
      var pageObj = nextObj++;
      var imgObj = nextObj++;
      var contObj = nextObj++;
      kids.push(pageObj + " 0 R");
      return { page: pageObj, img: imgObj, cont: contObj, im: im };
    });

    objStart();  // 1 — каталог
    push(enc("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"));
    objStart();  // 2 — страницы
    push(enc("2 0 obj\n<< /Type /Pages /Kids [" + kids.join(" ") +
             "] /Count " + kids.length + " >>\nendobj\n"));

    for (var i = 0; i < plan.length; i++) {
      var it = plan[i];
      var pwpt = it.im.w * PT_MM, phpt = it.im.h * PT_MM;
      objStart();
      push(enc(it.page + " 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " +
               pwpt.toFixed(3) + " " + phpt.toFixed(3) +
               "] /Resources << /XObject << /Im0 " + it.img + " 0 R >> >>" +
               " /Contents " + it.cont + " 0 R >>\nendobj\n"));

      var content = "q\n" + pwpt.toFixed(3) + " 0 0 " + phpt.toFixed(3) +
                    " 0 0 cm\n/Im0 Do\nQ\n";
      var cb = enc(content);
      objStart();
      push(enc(it.cont + " 0 obj\n<< /Length " + cb.length + " >>\nstream\n"));
      push(cb);
      push(enc("\nendstream\nendobj\n"));

      var bytes = await jpegBytes(it.im.cv);
      objStart();
      push(enc(it.img + " 0 obj\n<< /Type /XObject /Subtype /Image /Width " +
               it.im.cv.width + " /Height " + it.im.cv.height +
               " /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode" +
               " /Length " + bytes.length + " >>\nstream\n"));
      push(bytes);
      push(enc("\nendstream\nendobj\n"));
    }

    var xref = size;
    var x = "xref\n0 " + (offsets.length + 1) + "\n0000000000 65535 f \n";
    for (var k = 0; k < offsets.length; k++) {
      x += String(offsets[k]).padStart(10, "0") + " 00000 n \n";
    }
    x += "trailer\n<< /Size " + (offsets.length + 1) + " /Root 1 0 R >>\n" +
         "startxref\n" + xref + "\n%%EOF\n";
    push(enc(x));

    var blob = new Blob([cat(parts)], { type: "application/pdf" });
    info.blob = blob;
    info.bytes = size;
    return info;
  }

  global.PDFOut = { build: build, choosePaper: choosePaper, PAPERS: PAPERS };
})(window);
