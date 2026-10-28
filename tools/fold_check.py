"""Проверка физической сборки: берём готовый лист (как напечатан), вырезаем
панели по сетке и раскладываем их на грани коробки по правилам складывания
(лицевая сторона внутрь), затем смотрим внутрь из точки перед коробкой.

Ничего из art-кода тут не используется — только геометрия развёртки, поэтому
это независимая проверка «а сложится ли картинка».

Запуск: python tools/fold_check.py <sheet.png> <out.png> [cross|back]
"""
import sys
import numpy as np
from PIL import Image, ImageDraw

BOX = (199.0, 149.0, 98.0)   # W, D, H
TAB = 12.0
MARGIN = 12.0
PPM = 150 / 25.4


def homography(src, dst):
    A, b = [], []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y])
        b += [u, v]
    h = np.linalg.solve(np.array(A, float), np.array(b, float))
    return np.append(h, 1.0).reshape(3, 3)


def main(sheet_path, out_path, layout="cross", size=(1600, 1200)):
    W, D, H = BOX
    sheet = Image.open(sheet_path).convert("RGB")

    if layout == "back":
        # bbox: (-D, -D, W+D, H+D)
        ox, oy = MARGIN + D, MARGIN + D
        panels = {
            "back": (0, 0, W, H),
            "floor": (0, H, W, H + D),
            "left": (-D, 0, 0, H),
            "right": (W, 0, W + D, H),
            "top": (0, -D, W, 0),
        }
        quads = {
            "back": [(0, 0, H), (W, 0, H), (W, 0, 0), (0, 0, 0)],
            "floor": [(0, 0, 0), (W, 0, 0), (W, D, 0), (0, D, 0)],
            "left": [(0, D, H), (0, 0, H), (0, 0, 0), (0, D, 0)],
            "right": [(W, 0, H), (W, D, H), (W, D, 0), (W, 0, 0)],
            "top": [(0, D, H), (W, D, H), (W, 0, H), (0, 0, H)],
        }
    else:
        ox, oy = MARGIN + (H + TAB), MARGIN + (H + D)
        panels = {
            "back": (0, -H, W, 0),
            "left": (-H, 0, 0, D),
            "right": (W, 0, W + H, D),
            "floor": (0, 0, W, D),
            "top": (0, -(H + D), W, -H),
        }
        quads = {
            "back": [(0, 0, H), (W, 0, H), (W, 0, 0), (0, 0, 0)],
            "left": [(0, 0, H), (0, 0, 0), (0, D, 0), (0, D, H)],
            "right": [(W, 0, 0), (W, 0, H), (W, D, H), (W, D, 0)],
            "floor": [(0, 0, 0), (W, 0, 0), (W, D, 0), (0, D, 0)],
            "top": [(0, D, H), (W, D, H), (W, 0, H), (0, 0, H)],
        }

    def crop(x0, y0, x1, y1):
        box = (int(round((x0 + ox) * PPM)), int(round((y0 + oy) * PPM)),
               int(round((x1 + ox) * PPM)), int(round((y1 + oy) * PPM)))
        return sheet.crop(box)

    eye = np.array([W * 0.5, D + 1.8 * D, H * 0.5])
    target = np.array([W * 0.5, D * 0.5, H * 0.45])
    f = target - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, np.array([0.0, 0.0, 1.0]))
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    w, h = size
    fpx = 1.2 * h

    def proj(p):
        d = np.asarray(p, float) - eye
        cz = max(float(d @ f), 1e-6)
        return (w / 2 + fpx * float(d @ r) / cz, h / 2 - fpx * float(d @ u) / cz)

    canvas = Image.new("RGB", size, (26, 27, 30))
    for name in ("back", "left", "right", "floor", "top"):
        tex = crop(*panels[name])
        tw, th = tex.size
        dst = [proj(p) for p in quads[name]]
        src = [(0, 0), (tw, 0), (tw, th), (0, th)]
        M = homography(dst, src)          # PIL: выход -> вход
        M = M / M[2, 2]
        coeffs = (M[0, 0], M[0, 1], M[0, 2], M[1, 0], M[1, 1], M[1, 2], M[2, 0], M[2, 1])
        warped = tex.transform(size, Image.PERSPECTIVE, coeffs, Image.BICUBIC)
        mask = Image.new("L", size, 0)
        ImageDraw.Draw(mask).polygon(dst, fill=255)
        canvas.paste(warped, (0, 0), mask)
    canvas.save(out_path)
    print("saved", out_path, "layout:", layout)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else "cross")
