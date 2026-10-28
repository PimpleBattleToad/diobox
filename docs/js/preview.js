/* Превью собранной диорамы: камера смотрит внутрь коробки с открытой стороны,
   грани проецируются и заливаются текстурами панелей. */
(function (global) {
  "use strict";

  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]];
  }
  function norm(a) {
    var l = Math.sqrt(dot(a, a)) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }

  /* Базис камеры: f — вперёд, r — вправо, u — вверх. */
  function lookAt(eye, target, up) {
    var f = norm(sub(target, eye));
    var r = norm(cross(f, up));
    var u = cross(r, f);
    return { r: r, u: u, f: f, eye: eye };
  }

  /* Текстуры граней под именами панелей. */
  function texture(art, name, net, ppm) {
    if (name === "back") return art.panel("back", net.W, net.H, net, [0, 1, 0, 1], false);
    if (name === "left" || name === "right") {
      return art.panel(name, net.H, net.D, net, [0, 1, 0, 1], false);
    }
    if (name === "top") return art.panel("top", net.W, net.D, net, [0, 1, 0, 1], false);
    return art.panel("floor", net.W, net.D, net, [0, 1, 0, 1], false);
  }

  function render(net, art, o) {
    o = o || {};
    var w = o.w || 1200, h = o.h || 900;
    var ss = 2;
    var W = net.W, D = net.D, H = net.H;
    var cv = document.createElement("canvas");
    cv.width = w * ss;
    cv.height = h * ss;
    var ctx = cv.getContext("2d");
    ctx.scale(ss, ss);

    // фон
    ctx.fillStyle = "#181a1d";
    ctx.fillRect(0, 0, w, h);

    var dist = Math.max(1.25 * W, 1.10 * D);
    var eye = [W * 0.46, D + dist, H * 0.72];
    var target = [W * 0.5, 0, H * 0.44];
    var cam = lookAt(eye, target, [0, 0, 1]);

    function camCoords(p) {
      var d = sub(p, cam.eye);
      return [dot(d, cam.r), dot(d, cam.u), dot(d, cam.f)];
    }

    // подбор масштаба: коробка целиком в кадре
    var corners = [];
    [0, W].forEach(function (x) {
      [0, D].forEach(function (dd) {
        [0, H].forEach(function (hh) { corners.push(camCoords([x, dd, hh])); });
      });
    });
    var lim = [];
    corners.forEach(function (c) {
      var z = Math.max(c[2], 1e-6);
      if (Math.abs(c[0]) > 1e-9) lim.push((w / 2) * z / Math.abs(c[0]));
      if (Math.abs(c[1]) > 1e-9) lim.push((h / 2) * z / Math.abs(c[1]));
    });
    var fpx = lim.length ? 0.88 * Math.min.apply(null, lim) : h * 0.5;

    function proj(p) {
      var c = camCoords(p);
      var z = Math.max(c[2], 1e-6);
      return [w / 2 + fpx * c[0] / z, h / 2 - fpx * c[1] / z];
    }

    var faces = [
      ["back", [[0, 0, H], [W, 0, H], [W, 0, 0], [0, 0, 0]]],
      ["left", [[0, 0, H], [0, 0, 0], [0, D, 0], [0, D, H]]],
      ["right", [[W, 0, 0], [W, 0, H], [W, D, H], [W, D, 0]]],
      ["floor", [[0, 0, 0], [W, 0, 0], [W, D, 0], [0, D, 0]]]
    ];
    if (net.C) faces.push(["top", [[0, D, H], [W, D, H], [W, 0, H], [0, 0, H]]]);

    var texPpm = 6;                       // 600 px на 100 мм — с запасом
    faces.forEach(function (f) {
      var tex = texture(art, f[0], net, texPpm);
      var quad = f[1].map(proj);
      var src = [[0, 0], [tex.width, 0], [tex.width, tex.height], [0, tex.height]];
      Warp.quad(ctx, tex, src, quad, 10);
    });

    // каркас коробки
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 1;
    var edges = [
      [[0, 0, H], [W, 0, H]], [[0, 0, H], [0, 0, 0]], [[0, 0, H], [0, D, H]],
      [[W, 0, H], [W, 0, 0]], [[W, 0, H], [W, D, H]],
      [[0, 0, 0], [W, 0, 0]], [[0, 0, 0], [0, D, 0]], [[W, 0, 0], [W, D, 0]],
      [[0, D, 0], [W, D, 0]], [[0, D, 0], [0, D, H]], [[W, D, 0], [W, D, H]]
    ];
    edges.forEach(function (e) {
      var a = proj(e[0]), b = proj(e[1]);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    });
    ctx.restore();

    return cv;
  }

  global.Preview = { render: render };
})(window);
