/* Текстуры панелей из картинки пользователя.
   Порт insert_generator.ArtBuilder: объёмная раскладка (анаморфоза) и плоская. */
(function (global) {
  "use strict";

  function canvas(w, h) {
    var c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  function grey(k) {
    var v = Math.max(0, Math.min(255, Math.round(255 * k)));
    return "rgb(" + v + "," + v + "," + v + ")";
  }

  /* Заполнить прямоугольник картинкой по принципу cover. */
  function coverCrop(img, w, h, fx, fy) {
    var c = canvas(w, h), ctx = c.getContext("2d");
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var s = Math.max(w / iw, h / ih);
    var dw = iw * s, dh = ih * s;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (w - dw) * (fx == null ? 0.5 : fx),
                  (h - dh) * (fy == null ? 0.5 : fy), dw, dh);
    return c;
  }

  /* Вписать целиком (contain) на белом фоне. */
  function containPad(img, w, h) {
    var c = canvas(w, h), ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    var iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    var s = Math.min(w / iw, h / ih);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
    return c;
  }

  function blurCanvas(srcCv, px) {
    var c = canvas(srcCv.width, srcCv.height), ctx = c.getContext("2d");
    var ok = "filter" in ctx;
    if (ok) ctx.filter = "blur(" + px.toFixed(2) + "px)";
    ctx.drawImage(srcCv, 0, 0);
    if (ok) ctx.filter = "none";
    return c;
  }

  /* Мягкое затемнение у сгибов: без него коробка читается как плоская
     картинка. strong — стороны, где проходит сгиб (там тень сильнее). */
  function ao(ctx, w, h, strength, strong, factor) {
    var wx = Math.max(1, 0.07 * w), wy = Math.max(1, 0.07 * h);
    strong = strong || [];
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    if (factor != null && factor < 1) {
      ctx.fillStyle = grey(factor);
      ctx.fillRect(0, 0, w, h);
    }
    var sides = [
      ["left", wx, function () { return ctx.createLinearGradient(0, 0, wx, 0); },
       function (g) { ctx.fillRect(0, 0, wx, h); }],
      ["right", wx, function () { return ctx.createLinearGradient(w, 0, w - wx, 0); },
       function (g) { ctx.fillRect(w - wx, 0, wx, h); }],
      ["top", wy, function () { return ctx.createLinearGradient(0, 0, 0, wy); },
       function (g) { ctx.fillRect(0, 0, w, wy); }],
      ["bottom", wy, function () { return ctx.createLinearGradient(0, h, 0, h - wy); },
       function (g) { ctx.fillRect(0, h - wy, w, wy); }]
    ];
    for (var i = 0; i < sides.length; i++) {
      var name = sides[i][0];
      var k = 1 - strength * (strong.indexOf(name) >= 0 ? 1.0 : 0.5);
      var g = sides[i][2]();
      g.addColorStop(0, grey(k));
      g.addColorStop(1, "#ffffff");
      ctx.fillStyle = g;
      sides[i][3](g);
    }
    ctx.restore();
  }

  function Art(src, ppm, o) {
    o = o || {};
    this.src = src || null;
    this.iw = src ? (src.naturalWidth || src.width) : 0;
    this.ih = src ? (src.naturalHeight || src.height) : 0;
    this.ppm = ppm;
    this.focus = o.focus || [0.5, 0.5];
    this.fill = o.fill || "box";
    this.depthK = o.depthK || 1.8;
    this.artMode = o.artMode || "cover";
    this._win = {};
  }

  /* Прямоугольник «входа в коробку» в пикселях исходника. */
  Art.prototype.windowRect = function (backW, backH) {
    var s = Math.min(this.iw / backW, this.ih / backH);
    var w = backW * s, h = backH * s;
    var fx = Math.min(Math.max(this.focus[0], 0), 1);
    var fy = Math.min(Math.max(this.focus[1], 0), 1);
    return [(this.iw - w) * fx, (this.ih - h) * fy, w, h];
  };

  /* Окно с достройкой краёв на 12% — чтобы вылеты не упирались в пустоту. */
  Art.prototype.windowCanvas = function (backW, backH) {
    var key = backW.toFixed(2) + "x" + backH.toFixed(2);
    if (this._win[key]) return this._win[key];
    var r = this.windowRect(backW, backH);
    var pad = Math.round(0.12 * Math.max(r[2], r[3]));
    var x0 = Math.floor(r[0] - pad), y0 = Math.floor(r[1] - pad);
    var x1 = Math.ceil(r[0] + r[2] + pad), y1 = Math.ceil(r[1] + r[3] + pad);
    var w = x1 - x0, h = y1 - y0;
    var c = canvas(w, h), ctx = c.getContext("2d");
    // видимая часть картинки
    ctx.drawImage(this.src, x0, y0, w, h, 0, 0, w, h);
    // края достраиваем растяжением крайних пикселей
    var iw = this.iw, ih = this.ih;
    var lx = Math.max(0, -x0), ty = Math.max(0, -y0);
    var rx = Math.max(0, x1 - iw), by = Math.max(0, y1 - ih);
    if (lx > 0) ctx.drawImage(this.src, 0, 0, 1, ih, 0, Math.max(0, -y0), lx, ih);
    if (rx > 0) ctx.drawImage(this.src, iw - 1, 0, 1, ih, w - rx, Math.max(0, -y0), rx, ih);
    if (ty > 0) ctx.drawImage(this.src, 0, 0, iw, 1, Math.max(0, -x0), 0, iw, ty);
    if (by > 0) ctx.drawImage(this.src, 0, ih - 1, iw, 1, Math.max(0, -x0), h - by, iw, by);
    var res = { canvas: c, ox: x0, oy: y0 };
    this._win[key] = res;
    return res;
  };

  /* Углы панели (TL, TR, BR, BL) в долях окна. */
  Art.prototype.panelQuad = function (kind, W, H, D, transposed) {
    var k = this.depthK;
    function uv(x, y, z) {
      var xu = 1 - x / W;                       // u идёт против x (см. Python)
      var lam = D > 0 ? (k * D) / (k * D + (D - z)) : 1;
      return [0.5 + (xu - 0.5) * lam, 0.5 - (y / H - 0.5) * lam];
    }
    var corners = {
      back: [[W, H, 0], [0, H, 0], [0, 0, 0], [W, 0, 0]],
      left: [[W, H, 0], [W, 0, 0], [W, 0, D], [W, H, D]],
      right: [[0, 0, 0], [0, H, 0], [0, H, D], [0, 0, D]],
      floor: [[W, 0, 0], [0, 0, 0], [0, 0, D], [W, 0, D]],
      top: [[W, H, D], [0, H, D], [0, H, 0], [W, H, 0]]
    }[kind];
    if (transposed) {
      var order = { left: [0, 3, 2, 1], right: [1, 2, 3, 0] }[kind] || [0, 1, 2, 3];
      corners = order.map(function (i) { return corners[i]; });
    }
    return corners.map(function (p) { return uv(p[0], p[1], p[2]); });
  };

  /* Текстура панели: wMm x hMm в пикселях листа. */
  Art.prototype.panel = function (kind, wMm, hMm, net, frac, transposed) {
    var tw = Math.max(1, Math.round(wMm * this.ppm));
    var th = Math.max(1, Math.round(hMm * this.ppm));
    if (!this.src) return this.placeholder(tw, th);
    frac = frac || [0, 1, 0, 1];
    var win = this.windowCanvas(net.W, net.H);
    var r = this.windowRect(net.W, net.H);
    var uq = this.panelQuad(kind, net.W, net.H, net.D, transposed);
    var quad = uq.map(function (p) {
      return [r[0] + p[0] * r[2] - win.ox, r[1] + p[1] * r[3] - win.oy];
    });
    var unit = [[0, 0], [1, 0], [1, 1], [0, 1]];
    var M = Warp.homography(unit, quad);
    if (!M) return coverCrop(this.src, tw, th, this.focus[0], this.focus[1]);
    var sub = [[frac[0], frac[2]], [frac[1], frac[2]], [frac[1], frac[3]],
               [frac[0], frac[3]]].map(function (p) {
      var q = Warp.applyH(M, p[0], p[1]);
      return q || [0, 0];
    });
    var cv = canvas(tw, th), ctx = cv.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    Warp.quad(ctx, win.canvas, sub, [[0, 0], [tw, 0], [tw, th], [0, th]], 16);
    if (kind === "back") {
      ao(ctx, tw, th, 0.14, ["top", "bottom", "left", "right"], 1);
      return cv;
    }
    if (kind === "top") {
      cv = blurCanvas(cv, Math.max(1, 0.010 * Math.min(tw, th)));
      ao(cv.getContext("2d"), tw, th, 0.22, ["top"], 0.82);
      return cv;
    }
    if (kind === "floor") {
      ao(ctx, tw, th, 0.18, ["top"], 0.96);
      return cv;
    }
    ao(ctx, tw, th, 0.18, ["top"], 0.93);
    return cv;
  };

  /* Заглушка, когда картинки нет (в flat-режиме и для пустой развёртки). */
  Art.prototype.placeholder = function (w, h) {
    var c = canvas(w, h), ctx = c.getContext("2d");
    var g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "rgb(246,244,240)");
    g.addColorStop(1, "rgb(206,214,226)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return c;
  };

  /* --- плоская раскладка (fill = "flat") -------------------------------- */

  Art.prototype.back = function (wMm, hMm) {
    var tw = Math.max(1, Math.round(wMm * this.ppm));
    var th = Math.max(1, Math.round(hMm * this.ppm));
    if (!this.src) return this.placeholder(tw, th);
    if (this.artMode === "contain") return containPad(this.src, tw, th);
    return coverCrop(this.src, tw, th, this.focus[0], this.focus[1]);
  };

  /* Полоса края задника, растянутая вдоль глубины. */
  Art.prototype.side = function (which, wMm, hMm) {
    var tw = Math.max(1, Math.round(wMm * this.ppm));
    var th = Math.max(1, Math.round(hMm * this.ppm));
    if (!this.src) return this.placeholder(tw, th);
    var bw = Math.max(8, Math.round(this.iw * 0.045));
    var sx = which === "left" ? 0 : this.iw - bw;
    var c = canvas(tw, th), ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.src, sx, 0, bw, this.ih, 0, 0, tw, th);
    return blurCanvas(c, Math.max(2, 0.06 * Math.min(tw, th)));
  };

  /* Нижняя полоса задника — пол, с виньеткой. */
  Art.prototype.floor = function (wMm, dMm) {
    var tw = Math.max(1, Math.round(wMm * this.ppm));
    var th = Math.max(1, Math.round(dMm * this.ppm));
    if (!this.src) return this.placeholder(tw, th);
    var bh = Math.max(8, Math.round(this.ih * 0.22));
    var c = canvas(tw, th), ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.src, 0, this.ih - bh, this.iw, bh, 0, 0, tw, th);
    var out = blurCanvas(c, Math.max(2, 0.05 * Math.min(tw, th)));
    var g = out.getContext("2d");
    var rg = g.createRadialGradient(tw / 2, th / 2, Math.min(tw, th) * 0.15,
                                    tw / 2, th / 2, Math.max(tw, th) * 0.72);
    rg.addColorStop(0, "rgba(0,0,0,0)");
    rg.addColorStop(1, "rgba(0,0,0,0.55)");
    g.fillStyle = rg;
    g.fillRect(0, 0, tw, th);
    return out;
  };

  /* Верхняя полоса задника — потолок. */
  Art.prototype.canopy = function (wMm, dMm) {
    var tw = Math.max(1, Math.round(wMm * this.ppm));
    var th = Math.max(1, Math.round(dMm * this.ppm));
    if (!this.src) return this.placeholder(tw, th);
    var bh = Math.max(8, Math.round(this.ih * 0.18));
    var c = canvas(tw, th), ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(this.src, 0, 0, this.iw, bh, 0, 0, tw, th);
    var out = blurCanvas(c, Math.max(2, 0.02 * Math.min(tw, th)));
    ao(out.getContext("2d"), tw, th, 0.22, ["top", "bottom"], 0.82);
    return out;
  };

  global.Art = Art;
  global.ArtUtil = { canvas: canvas, coverCrop: coverCrop, blurCanvas: blurCanvas };
})(window);
