/* Отрисовка плоской развёртки на canvas — порт render_sheet(). */
(function (global) {
  "use strict";

  var CUT = "#181818";
  var FOLD = "#787878";
  var GLUE = "#eee7dc";
  var GLUE_EDGE = "#a89880";
  var LABEL = "#5a5a5a";
  var MM_INCH = 25.4;

  function font(px, bold) {
    return (bold ? "700 " : "400 ") + Math.max(6, Math.round(px)) +
      'px Arial, "Segoe UI", Roboto, sans-serif';
  }

  function dashed(ctx, a, b, color, width, dash, gap) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.setLineDash([Math.max(1, dash), Math.max(1, gap)]);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.restore();
  }

  function poly(ctx, pts, color, width) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function text(ctx, s, x, y, f, color, halo) {
    ctx.save();
    ctx.font = f;
    ctx.textBaseline = "top";
    if (halo) {
      ctx.lineWidth = Math.max(2, halo);
      ctx.strokeStyle = "#ffffff";
      ctx.lineJoin = "round";
      ctx.strokeText(s, x, y);
    }
    ctx.fillStyle = color;
    ctx.fillText(s, x, y);
    ctx.restore();
  }

  function measure(ctx, s, f) {
    ctx.font = f;
    return ctx.measureText(s).width;
  }

  /* net — Geom.Net, art — Art, o — параметры листа. */
  function render(net, art, o) {
    var dpi = o.dpi || 300;
    var ppm = dpi / MM_INCH;
    var margin = o.marginMm == null ? 12 : o.marginMm;
    var bleed = o.bleedMm == null ? 3 : o.bleedMm;
    var marks = o.marks !== false;
    var labels = !!o.labels;
    var blank = !!o.blank;

    var b = net.bbox();
    var bx0 = b[0], by0 = b[1], bx1 = b[2], by1 = b[3];
    var widthMm = (bx1 - bx0) + 2 * margin;
    var heightMm = (by1 - by0) + 2 * margin + (marks ? 18 : 0);

    var limit = o.maxPx || 40e6;
    var px = widthMm * ppm * heightMm * ppm;
    if (px > limit) {                       // не даём браузеру упасть
      var k = Math.sqrt(limit / px);
      ppm = ppm * k;
      dpi = ppm * MM_INCH;
    }

    var Wpx = Math.round(widthMm * ppm), Hpx = Math.round(heightMm * ppm);
    var cv = document.createElement("canvas");
    cv.width = Wpx;
    cv.height = Hpx;
    var ctx = cv.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, Wpx, Hpx);

    var ox = margin - bx0, oy = margin - by0;
    function P(x, y) { return [(x + ox) * ppm, (y + oy) * ppm]; }

    var panels = net.panels();
    var bside = net.bleedSides();
    var order = ["floor", "left", "right", "back", "top"].filter(function (n) {
      return panels[n];
    });
    var box = art.fill === "box" && art.src;

    if (!blank) {
      order.forEach(function (name) {
        var p = panels[name];
        var pw = p[2] - p[0], ph = p[3] - p[1];
        var s = bside[name] || [false, false, false, false];
        var bl = s[0] ? bleed : 0, bt = s[1] ? bleed : 0;
        var br = s[2] ? bleed : 0, bb = s[3] ? bleed : 0;
        var aw = pw + bl + br, ah = ph + bt + bb;
        var rot = net.layout === "back" && (name === "left" || name === "right");
        var tex;
        if (box) {
          var frac = [-bl / pw, 1 + br / pw, -bt / ph, 1 + bb / ph];
          tex = art.panel(name, aw, ah, net, frac, rot);
        } else if (name === "back") {
          tex = art.back(aw, ah);
        } else if (name === "left" || name === "right") {
          tex = art.side(name, aw, ah);
        } else if (name === "top") {
          tex = art.canopy(aw, ah);
        } else {
          tex = art.floor(aw, ah);
        }
        var at = P(p[0] - bl, p[1] - bt);
        ctx.drawImage(tex, at[0], at[1], aw * ppm, ah * ppm);
      });
    }

    // клапаны
    Object.keys(panels).forEach(function (name) {
      if (name.indexOf("tab_") !== 0) return;
      var p = panels[name];
      var a = P(p[0], p[1]), c = P(p[2], p[3]);
      ctx.fillStyle = GLUE;
      ctx.fillRect(a[0], a[1], c[0] - a[0], c[1] - a[1]);
    });

    var wCut = Math.max(1, 0.35 * ppm);
    var wHalo = wCut + 2;
    var wFold = Math.max(1, 0.22 * ppm);

    if (marks) {
      // разрезы
      net.slits().forEach(function (s) {
        var a = P(s[0][0], s[0][1]), c = P(s[1][0], s[1][1]);
        ctx.save();
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = wHalo;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
        ctx.strokeStyle = CUT;
        ctx.lineWidth = wCut;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
        ctx.restore();
      });
      // сгибы
      var fd = 2.4 * ppm, fg = 1.8 * ppm;
      net.folds().forEach(function (f) {
        dashed(ctx, P(f[0][0], f[0][1]), P(f[1][0], f[1][1]), FOLD, wFold, fd, fg);
      });
      // контур
      var pts = net.outline().map(function (p) { return P(p[0], p[1]); });
      poly(ctx, pts, "#fff", wHalo);
      poly(ctx, pts, CUT, wCut);

      // рамка листа
      var pad = 4 * ppm;
      var fx0 = Math.min.apply(null, pts.map(function (p) { return p[0]; })) - pad;
      var fy0 = Math.min.apply(null, pts.map(function (p) { return p[1]; })) - pad;
      var fx1 = Math.max.apply(null, pts.map(function (p) { return p[0]; })) + pad;
      var fy1 = Math.max.apply(null, pts.map(function (p) { return p[1]; })) + pad;
      ctx.save();
      ctx.strokeStyle = "#d2d2d2";
      ctx.lineWidth = Math.max(1, 0.15 * ppm);
      ctx.strokeRect(fx0, fy0, fx1 - fx0, fy1 - fy0);
      ctx.restore();
    }

    // подписи на клапанах
    var fTab = font(2.3 * ppm, true);
    Object.keys(panels).forEach(function (name) {
      if (name.indexOf("tab_") !== 0) return;
      var p = panels[name];
      var c = P((p[0] + p[2]) / 2, (p[1] + p[3]) / 2);
      if ((p[3] - p[1]) > (p[2] - p[0])) {
        ctx.save();
        ctx.translate(c[0], c[1]);
        ctx.rotate(-Math.PI / 2);
        ctx.font = fTab;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "rgb(176,152,112)";
        ctx.fillText("КЛЕЙ", 0, 0);
        ctx.restore();
        return;
      }
      ctx.font = fTab;
      var tw = ctx.measureText("КЛЕЙ").width;
      text(ctx, "КЛЕЙ", c[0] - tw / 2, c[1] - 0.9 * ppm, fTab, "rgb(176,152,112)");
    });

    // подписи панелей
    if (labels && marks) {
      var fLbl = font(2.6 * ppm, true), fDim = font(2.1 * ppm);
      var info = {
        back: ["ЗАДНИК", Math.round(net.W) + " × " + Math.round(net.H) + " мм"],
        left: ["БОКОВИНА", Math.round(net.D) + " × " + Math.round(net.H) + " мм"],
        right: ["БОКОВИНА", Math.round(net.D) + " × " + Math.round(net.H) + " мм"],
        floor: ["ПОЛ", Math.round(net.W) + " × " + Math.round(net.D) + " мм"],
        top: ["ПОТОЛОК", Math.round(net.W) + " × " + Math.round(net.D) + " мм"]
      };
      Object.keys(info).forEach(function (name) {
        if (!panels[name]) return;
        var p = panels[name];
        var c = P((p[0] + p[2]) / 2, (p[1] + p[3]) / 2);
        var halo = Math.max(1, 0.35 * ppm);
        var l1 = info[name][0], l2 = info[name][1];
        var w1 = measure(ctx, l1, fLbl), w2 = measure(ctx, l2, fDim);
        text(ctx, l1, c[0] - w1 / 2, c[1] - 2.4 * ppm, fLbl, "#464646", halo);
        text(ctx, l2, c[0] - w2 / 2, c[1] + 0.2 * ppm, fDim, "#464646", halo);
      });
    }

    if (!marks) return { canvas: cv, widthMm: widthMm, heightMm: heightMm,
                         dpi: dpi, capped: dpi < (o.dpi || 300) - 0.5 };

    // линейка 50 мм
    var r0 = P(bx0, by1 + 5.6);
    var rlen = 50 * ppm;
    var fSc = font(2.0 * ppm);
    ctx.save();
    ctx.strokeStyle = CUT;
    ctx.lineWidth = Math.max(1, 0.2 * ppm);
    ctx.beginPath(); ctx.moveTo(r0[0], r0[1]); ctx.lineTo(r0[0] + rlen, r0[1]); ctx.stroke();
    ctx.lineWidth = Math.max(1, 0.18 * ppm);
    for (var i = 0; i <= 50; i += 5) {
      var hh = (i % 10 === 0 ? 2.2 : 1.2) * ppm;
      ctx.beginPath();
      ctx.moveTo(r0[0] + i * ppm, r0[1]);
      ctx.lineTo(r0[0] + i * ppm, r0[1] - hh);
      ctx.stroke();
    }
    ctx.restore();
    for (var t = 0; t <= 50; t += 10) {
      text(ctx, String(t), r0[0] + t * ppm - 1.4 * ppm, r0[1] + 0.6 * ppm, fSc, LABEL);
    }
    text(ctx, "мм · масштаб 1:1", r0[0] + rlen + 3 * ppm, r0[1] + 0.9 * ppm, fSc, LABEL);

    // легенда
    var fLg = font(2.4 * ppm);
    var items = [["резать", "cut"], ["сгиб", "fold"], ["клей", "glue"]];
    var sample = 10 * ppm, gapLg = 1.6 * ppm, stepLg = 4.5 * ppm;
    var left = P(bx0, 0)[0];
    var maxW = P(bx1 - 96, 0)[0] - left;
    var right = left + maxW;
    var curX = left, curY = P(0, by1 + 12.6)[1];
    var rowH = 5.2 * ppm;
    items.forEach(function (it) {
      var tw2 = measure(ctx, it[0], fLg);
      var w = sample + gapLg + tw2;
      if (curX > left && curX + w > right) { curX = left; curY += rowH; }
      if (curX + w > right) return;
      if (it[1] === "cut") {
        ctx.save();
        ctx.strokeStyle = CUT;
        ctx.lineWidth = wCut;
        ctx.beginPath(); ctx.moveTo(curX, curY); ctx.lineTo(curX + sample, curY); ctx.stroke();
        ctx.restore();
      } else if (it[1] === "fold") {
        dashed(ctx, [curX, curY], [curX + sample, curY], FOLD, wFold,
               fd * 0.55, fg * 0.55);
      } else {
        ctx.save();
        ctx.fillStyle = GLUE;
        ctx.strokeStyle = GLUE_EDGE;
        ctx.lineWidth = Math.max(1, 0.16 * ppm);
        ctx.fillRect(curX, curY - 1.7 * ppm, sample, 3.4 * ppm);
        ctx.strokeRect(curX, curY - 1.7 * ppm, sample, 3.4 * ppm);
        ctx.restore();
      }
      text(ctx, it[0], curX + sample + gapLg, curY - 2.4 * ppm, fLg, LABEL);
      curX += w + stepLg;
    });

    // штамп
    var sp = P(bx1 - 92, by1 + 5);
    var sx = sp[0], sy = sp[1];
    var fT = font(3.0 * ppm, true), fS = font(2.1 * ppm);
    if (o.title) {
      text(ctx, o.title, sx, sy, fT, "#282828");
      sy += 4.8 * ppm;
    }
    if (o.subtitle) {
      text(ctx, o.subtitle, sx, sy, fS, LABEL);
      sy += 3.4 * ppm;
    }
    var line1 = "ЗАДНИК " + Math.round(net.W) + "×" + Math.round(net.H) +
      " · БОКОВИНА " + Math.round(net.D) + "×" + Math.round(net.H) + " (×2)" +
      " · ПОЛ " + Math.round(net.W) + "×" + Math.round(net.D) +
      (net.C ? " · ПОТОЛОК " + Math.round(net.W) + "×" + Math.round(net.D) : "") +
      " мм";
    var today = new Date();
    var date = String(today.getDate()).padStart(2, "0") + "." +
      String(today.getMonth() + 1).padStart(2, "0") + "." + today.getFullYear();
    var line2 = o.boxMm
      ? "коробка " + Math.round(o.boxMm[0]) + "×" + Math.round(o.boxMm[1]) + "×" +
        Math.round(o.boxMm[2]) + " мм (внутри) · " + date
      : date;
    text(ctx, line1, sx, sy, fS, LABEL);
    text(ctx, line2, sx, sy + 3.3 * ppm, fS, LABEL);

    return { canvas: cv, widthMm: widthMm, heightMm: heightMm, dpi: dpi,
             capped: dpi < (o.dpi || 300) - 0.5 };
  }

  global.Sheet = { render: render, MM_INCH: MM_INCH };
})(window);
