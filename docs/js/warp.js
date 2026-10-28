/* Проективная раскладка текстуры на четырёхугольник средствами Canvas 2D.
   Canvas умеет только аффинные трансформации, поэтому квад разбивается на
   сетку ячеек: каждая рисуется своей аффинной матрицей (по трём углам) и
   подрезается по своей ячейке. Ячейки чуть перекрываются — швов не видно. */
(function (global) {
  "use strict";

  /* Гомография по четырём парам точек: [x,y] -> [x,y]. Матрица 3x3. */
  function homography(from, to) {
    var A = [], b = [], i;
    for (i = 0; i < 4; i++) {
      var x = from[i][0], y = from[i][1], u = to[i][0], v = to[i][1];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    for (var c = 0; c < 8; c++) {
      var piv = c, max = Math.abs(A[c][c]);
      for (var r = c + 1; r < 8; r++) {
        if (Math.abs(A[r][c]) > max) { max = Math.abs(A[r][c]); piv = r; }
      }
      if (max < 1e-12) return null;
      if (piv !== c) {
        var t = A[piv]; A[piv] = A[c]; A[c] = t;
        var tb = b[piv]; b[piv] = b[c]; b[c] = tb;
      }
      for (var rr = c + 1; rr < 8; rr++) {
        var f = A[rr][c] / A[c][c];
        if (!f) continue;
        for (var cc = c; cc < 8; cc++) A[rr][cc] -= f * A[c][cc];
        b[rr] -= f * b[c];
      }
    }
    var h = new Array(8);
    for (var k = 7; k >= 0; k--) {
      var s = b[k];
      for (var j = k + 1; j < 8; j++) s -= A[k][j] * h[j];
      h[k] = s / A[k][k];
      if (!isFinite(h[k])) return null;
    }
    return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
  }

  function applyH(M, x, y) {
    var d = M[2][0] * x + M[2][1] * y + M[2][2];
    if (Math.abs(d) < 1e-12) return null;
    return [(M[0][0] * x + M[0][1] * y + M[0][2]) / d,
            (M[1][0] * x + M[1][1] * y + M[1][2]) / d];
  }

  /* Аффинная матрица по трём парам точек (источник -> приёмник). */
  function affine3(s, d) {
    var x0 = s[0][0], y0 = s[0][1], x1 = s[1][0], y1 = s[1][1],
        x2 = s[2][0], y2 = s[2][1];
    var u0 = d[0][0], v0 = d[0][1], u1 = d[1][0], v1 = d[1][1],
        u2 = d[2][0], v2 = d[2][1];
    var det = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (Math.abs(det) < 1e-9) return null;
    var a = ((u1 - u0) * (y2 - y0) - (u2 - u0) * (y1 - y0)) / det;
    var b = ((v1 - v0) * (y2 - y0) - (v2 - v0) * (y1 - y0)) / det;
    var c = ((u2 - u0) * (x1 - x0) - (u1 - u0) * (x2 - x0)) / det;
    var e = ((v2 - v0) * (x1 - x0) - (v1 - v0) * (x2 - x0)) / det;
    return [a, b, c, e, u0 - a * x0 - c * y0, v0 - b * x0 - e * y0];
  }

  function bilerp(q, u, v) {
    var a = (1 - u) * (1 - v), b = u * (1 - v), c = u * v, d = (1 - u) * v;
    return [a * q[0][0] + b * q[1][0] + c * q[2][0] + d * q[3][0],
            a * q[0][1] + b * q[1][1] + c * q[2][1] + d * q[3][1]];
  }

  /* Текстура tex: область src (координаты текстуры) кладётся на область dst
     (координаты контекста). Разбиение n x n. */
  function quad(ctx, tex, src, dst, n) {
    n = Math.max(1, Math.round(n || 16));
    var inv = homography(dst, src);      // координаты контекста -> текстуры
    if (!inv) {
      ctx.drawImage(tex, dst[0][0], dst[0][1],
                    Math.max(1, dst[2][0] - dst[0][0]),
                    Math.max(1, dst[2][1] - dst[0][1]));
      return;
    }
    var base = ctx.getTransform();
    for (var j = 0; j < n; j++) {
      for (var i = 0; i < n; i++) {
        var u0 = i / n, u1 = (i + 1) / n, v0 = j / n, v1 = (j + 1) / n;
        var d00 = bilerp(dst, u0, v0), d10 = bilerp(dst, u1, v0);
        var d11 = bilerp(dst, u1, v1), d01 = bilerp(dst, u0, v1);
        var s00 = applyH(inv, d00[0], d00[1]), s10 = applyH(inv, d10[0], d10[1]);
        var s01 = applyH(inv, d01[0], d01[1]);
        if (!s00 || !s10 || !s01) continue;
        var M = affine3([s00, s10, s01], [d00, d10, d01]);
        if (!M) continue;

        // масштаб ячейки: сколько пикселей контекста на пиксель текстуры
        var det = Math.abs(M[0] * M[3] - M[1] * M[2]);
        var scale = Math.sqrt(det) || 1;
        var pad = Math.max(1.2, 1.6 / scale);   // перекрытие в пикселях текстуры

        var s11 = applyH(inv, d11[0], d11[1]) || s01;
        var bx = Math.min(s00[0], s10[0], s11[0], s01[0]) - pad;
        var by = Math.min(s00[1], s10[1], s11[1], s01[1]) - pad;
        var bw = Math.max(s00[0], s10[0], s11[0], s01[0]) + pad - bx;
        var bh = Math.max(s00[1], s10[1], s11[1], s01[1]) + pad - by;
        if (bw <= 0.01 || bh <= 0.01) continue;

        ctx.setTransform(base.multiply(new DOMMatrix([M[0], M[1], M[2], M[3], M[4], M[5]])));
        ctx.drawImage(tex, bx, by, bw, bh, bx, by, bw, bh);
      }
    }
    ctx.setTransform(base);
  }

  global.Warp = { homography: homography, applyH: applyH, quad: quad };
})(window);
