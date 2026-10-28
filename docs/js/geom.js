/* Плоская развёртка вкладыша-диорамы.
   Координаты в миллиметрах, ось Y вниз (как у изображения).
   Порт insert_generator.Net — один в один, чтобы выкройка из браузера
   совпадала с тем, что печатает Python-версия. */
(function (global) {
  "use strict";

  var MM_INCH = 25.4;

  var PAPERS = {                       // портрет: ширина x высота, мм
    a1: [594.0, 841.0],
    a2: [420.0, 594.0],
    a3: [297.0, 420.0],
    a4: [210.0, 297.0],
    letter: [215.9, 279.4],
    legal: [215.9, 355.6]
  };

  function Net(o) {
    this.W = o.W;
    this.D = o.D;
    this.H = o.H;
    this.T = o.T == null ? 12 : o.T;
    this.C = o.C == null ? true : !!o.C;
    this.layout = o.layout || "cross";
  }

  /* имя -> [x0, y0, x1, y1] */
  Net.prototype.panels = function () {
    var W = this.W, D = this.D, H = this.H, T = this.T, p;
    if (this.layout === "back") {
      p = {
        back: [0, 0, W, H],
        floor: [0, H, W, H + D],
        left: [-D, 0, 0, H],
        right: [W, 0, W + D, H]
      };
      if (this.C) p.top = [0, -D, W, 0];
      if (T > 0) {
        p.tab_bot_left = [-D, H, 0, H + T];
        p.tab_bot_right = [W, H, W + D, H + T];
        if (this.C) {
          p.tab_top_left = [-D, -T, 0, 0];
          p.tab_top_right = [W, -T, W + D, 0];
        }
      }
      return p;
    }
    p = {
      floor: [0, 0, W, D],
      back: [0, -H, W, 0],
      left: [-H, 0, 0, D],
      right: [W, 0, W + H, D]
    };
    if (this.C) p.top = [0, -(H + D), W, -H];
    if (T > 0) {
      p.tab_left = [-H, -T, 0, 0];
      p.tab_right = [W, -T, W + H, 0];
      if (this.C) {
        p.tab_top_left = [-H - T, 0, -H, D];
        p.tab_top_right = [W + H, 0, W + H + T, D];
      }
    }
    return p;
  };

  /* С каких сторон панели режется контур (там нужен вылет под рез). */
  Net.prototype.bleedSides = function () {
    var b;
    if (this.layout === "back") {
      b = {
        back: [false, false, false, false],
        floor: [true, false, true, true],
        left: [true, false, false, false],
        right: [false, false, true, false]
      };
      if (this.C) b.top = [true, true, true, false];
      return b;
    }
    b = {
      floor: [false, false, false, true],
      back: [true, true, true, false],
      left: [true, false, false, true],
      right: [false, false, true, true]
    };
    if (this.C) b.top = [true, true, true, false];
    return b;
  };

  Net.prototype.topEdge = function () {
    if (this.layout === "back") return this.C ? -this.D : 0;
    return this.C ? -(this.H + this.D) : -this.H;
  };

  Net.prototype.outline = function () {
    var W = this.W, D = this.D, H = this.H, T = this.T, top;
    if (this.layout === "back") {
      if (T <= 0) {
        if (this.C) {
          return [[0, -D], [W, -D], [W, 0], [W + D, 0], [W + D, H], [W, H],
                  [W, H + D], [0, H + D], [0, H], [-D, H], [-D, 0], [0, 0]];
        }
        return [[-D, 0], [W + D, 0], [W + D, H], [W, H], [W, H + D], [0, H + D],
                [0, H], [-D, H]];
      }
      if (this.C) {
        return [[0, -D], [W, -D], [W, -T], [W + D, -T], [W + D, H + T],
                [W, H + T], [W, H + D], [0, H + D], [0, H + T], [-D, H + T],
                [-D, -T], [0, -T]];
      }
      return [[-D, 0], [W + D, 0], [W + D, H + T], [W, H + T], [W, H + D],
              [0, H + D], [0, H + T], [-D, H + T]];
    }
    top = this.topEdge();
    if (T <= 0) {
      return [[-H, 0], [0, 0], [0, top], [W, top], [W, 0], [W + H, 0],
              [W + H, D], [-H, D]];
    }
    if (this.C) {
      return [[0, top], [W, top], [W, -T], [W + H, -T], [W + H, 0],
              [W + H + T, 0], [W + H + T, D], [-H - T, D], [-H - T, 0],
              [-H, 0], [-H, -T], [0, -T]];
    }
    return [[-H, -T], [0, -T], [0, top], [W, top], [W, -T], [W + H, -T],
            [W + H, D], [-H, D]];
  };

  Net.prototype.folds = function () {
    var W = this.W, D = this.D, H = this.H, T = this.T, f;
    if (this.layout === "back") {
      f = [[[0, 0], [0, H]], [[W, 0], [W, H]], [[0, H], [W, H]]];
      if (this.C) f.push([[0, 0], [W, 0]]);
      if (T > 0) {
        f.push([[-D, H], [0, H]], [[W, H], [W + D, H]]);
        if (this.C) f.push([[-D, 0], [0, 0]], [[W, 0], [W + D, 0]]);
      }
      return f;
    }
    f = [[[0, 0], [W, 0]], [[0, 0], [0, D]], [[W, 0], [W, D]]];
    if (this.C) f.push([[0, -H], [W, -H]]);
    if (T > 0) {
      f.push([[-H, 0], [0, 0]], [[W, 0], [W + H, 0]]);
      if (this.C) f.push([[-H, 0], [-H, D]], [[W + H, 0], [W + H, D]]);
    }
    return f;
  };

  /* Разрезы, отделяющие клапан от соседней панели. */
  Net.prototype.slits = function () {
    var W = this.W, H = this.H, T = this.T, s;
    if (T <= 0) return [];
    if (this.layout === "back") {
      s = [[[0, H], [0, H + T]], [[W, H], [W, H + T]]];
      if (this.C) s.push([[0, -T], [0, 0]], [[W, -T], [W, 0]]);
      return s;
    }
    return [[[0, -H], [0, 0]], [[W, -H], [W, 0]]];
  };

  Net.prototype.bbox = function () {
    var top, side;
    if (this.layout === "back") {
      return [-this.D, this.C ? -this.D : 0, this.W + this.D, this.H + this.D];
    }
    top = this.H + (this.C ? this.D : 0);
    if (this.T > 0) top = Math.max(top, this.T);
    side = (this.T > 0 && this.C) ? this.T : 0;
    return [-(this.H + side), -top, this.W + this.H + side, this.D];
  };

  function layoutFootprint(layout, W, D, H, T, C) {
    var b = new Net({ W: W, D: D, H: H, T: T, C: C, layout: layout }).bbox();
    return [b[2] - b[0], b[3] - b[1]];
  }

  /* Компактная раскладка: сначала меньшая длинная сторона листа, потом площадь. */
  function pickLayout(W, D, H, T, C) {
    var best = "cross", bestS = null, lays = ["cross", "back"];
    for (var i = 0; i < lays.length; i++) {
      var wh = layoutFootprint(lays[i], W, D, H, T, C);
      var s = [Math.round(Math.max(wh[0], wh[1]) * 10) / 10,
               Math.round(wh[0] * wh[1])];
      if (bestS === null || s[0] < bestS[0] || (s[0] === bestS[0] && s[1] < bestS[1])) {
        best = lays[i];
        bestS = s;
      }
    }
    return best;
  }

  global.Geom = {
    MM_INCH: MM_INCH,
    PAPERS: PAPERS,
    Net: Net,
    layoutFootprint: layoutFootprint,
    pickLayout: pickLayout
  };
})(window);
