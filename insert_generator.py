#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
insert_generator.py — генератор развёртки вкладыша-диорамы в коробку.

Строит плоскую выкройку «задник + две боковины + пол + клапаны для склейки»,
раскладывает на ней рисунок (главная картинка на задник, её продолжение —
на боковины и на пол), сохраняет PNG 300 dpi + PDF в масштабе 1:1
и превью собранной диорамы.

Примеры:
    python insert_generator.py --box 200x150x100 --art foto.jpg --out out/diorama
    python insert_generator.py --box 250x180x120 --art foto.jpg --side blur --floor solid
    python insert_generator.py --box 200x150x100 --demo --out out/demo

Зависимости: Pillow, numpy.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import math
import os
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageOps

# ----------------------------------------------------------------------------
# Единицы и константы
# ----------------------------------------------------------------------------

MM_INCH = 25.4

PAPERS: Dict[str, Tuple[float, float]] = {          # портрет: ширина x высота, мм
    "a1": (594.0, 841.0),
    "a2": (420.0, 594.0),
    "a3": (297.0, 420.0),
    "a4": (210.0, 297.0),
    "letter": (215.9, 279.4),
    "legal": (215.9, 355.6),
}

CUT_COLOR = (24, 24, 24)
FOLD_COLOR = (120, 120, 120)
GLUE_COLOR = (238, 231, 220)
GLUE_EDGE = (168, 152, 128)
LABEL_COLOR = (90, 90, 90)


# ----------------------------------------------------------------------------
# Геометрия развёртки
# ----------------------------------------------------------------------------

@dataclass
class Net:
    """Плоская развёртка. Координаты в мм, ось Y вниз (как у изображения).

    Две раскладки листа:

    ``layout="cross"`` — боковины крепятся к полу (загиб по короткой стороне
    стенки), классический крест. Начало координат — левый верхний угол пола:
      * пол   : x 0..W,  y 0..D        (y=0 — задняя кромка)
      * задник: x 0..W,  y -H..0       (сгиб по y=0)
      * потолок: x 0..W, y -(H+D)..-H  (сгиб по y=-H, закрывает коробку сверху)
      * левая : x -H..0, y 0..D        (сгиб по x=0)
      * правая: x W..W+H, y 0..D       (сгиб по x=W)
      * клапан: полоса глубиной T у задней кромки боковин, y -T..0

    ``layout="back"`` — боковины крепятся к заднику (загиб по длинной стороне
    стенки), поэтому в стороны уходит глубина, а не высота. Начало координат —
    левый верхний угол задника:
      * задник : x 0..W, y 0..H
      * потолок: x 0..W, y -D..0
      * пол    : x 0..W, y H..H+D
      * левая  : x -D..0, y 0..H
      * правая : x W..W+D, y 0..H
      * клапаны: сверху и снизу стенок (на потолок и под пол)
    """

    W: float          # ширина вкладыша (по коробке)
    D: float          # глубина
    H: float          # высота стенок
    T: float = 12.0   # глубина клеевого клапана
    C: bool = True    # печатать потолок (без него вкладыш открыт сверху)
    layout: str = "cross"   # "cross" — боковины на полу, "back" — на заднике

    # имя -> (x0, y0, x1, y1)
    def panels(self) -> Dict[str, Tuple[float, float, float, float]]:
        W, D, H, T = self.W, self.D, self.H, self.T
        if self.layout == "back":
            p = {
                "back": (0.0, 0.0, W, H),
                "floor": (0.0, H, W, H + D),
                "left": (-D, 0.0, 0.0, H),
                "right": (W, 0.0, W + D, H),
            }
            if self.C:
                p["top"] = (0.0, -D, W, 0.0)
            if T > 0:
                p["tab_bot_left"] = (-D, H, 0.0, H + T)
                p["tab_bot_right"] = (W, H, W + D, H + T)
                if self.C:
                    p["tab_top_left"] = (-D, -T, 0.0, 0.0)
                    p["tab_top_right"] = (W, -T, W + D, 0.0)
            return p
        p = {
            "floor": (0.0, 0.0, W, D),
            "back": (0.0, -H, W, 0.0),
            "left": (-H, 0.0, 0.0, D),
            "right": (W, 0.0, W + H, D),
        }
        if self.C:
            p["top"] = (0.0, -(H + D), W, -H)
        if T > 0:
            p["tab_left"] = (-H, -T, 0.0, 0.0)
            p["tab_right"] = (W, -T, W + H, 0.0)
            if self.C:
                # клапаны у верхних кромок стенок: загибаются на потолок и
                # приклеиваются к нему сверху (изнутри картинка остаётся целой)
                p["tab_top_left"] = (-H - T, 0.0, -H, D)
                p["tab_top_right"] = (W + H, 0.0, W + H + T, D)
        return p

    def bleed_sides(self) -> Dict[str, Tuple[bool, bool, bool, bool]]:
        """С каких сторон панели режется контур (там нужен вылет под рез)."""
        if self.layout == "back":
            b = {
                "back": (False, False, False, False),   # со всех сторон сгибы
                "floor": (True, False, True, True),
                "left": (True, False, False, False),
                "right": (False, False, True, False),
            }
            if self.C:
                b["top"] = (True, True, True, False)
            return b
        b = {
            "floor": (False, False, False, True),   # низ — рез
            "back": (True, True, True, False),      # сгиб только снизу
            "left": (True, False, False, True),     # рез слева и снизу
            "right": (False, False, True, True),
        }
        if self.C:
            b["top"] = (True, True, True, False)    # сгиб только снизу
        return b

    def top_edge(self) -> float:
        """Верхняя граница чертежа по Y (без учёта полей)."""
        if self.layout == "back":
            return -self.D if self.C else 0.0
        return -(self.H + self.D) if self.C else -self.H

    def outline(self) -> List[Tuple[float, float]]:
        """Внешний контур вырубки (по часовой стрелке)."""
        W, D, H, T = self.W, self.D, self.H, self.T
        if self.layout == "back":
            if T <= 0:
                if self.C:
                    return [
                        (0.0, -D), (W, -D), (W, 0.0), (W + D, 0.0),
                        (W + D, H), (W, H), (W, H + D), (0.0, H + D),
                        (0.0, H), (-D, H), (-D, 0.0), (0.0, 0.0),
                    ]
                return [
                    (-D, 0.0), (W + D, 0.0), (W + D, H), (W, H),
                    (W, H + D), (0.0, H + D), (0.0, H), (-D, H),
                ]
            if self.C:
                # сверху и снизу стенок стоят клапаны, контур идёт уступами
                return [
                    (0.0, -D), (W, -D),
                    (W, -T), (W + D, -T),
                    (W + D, H + T), (W, H + T),
                    (W, H + D), (0.0, H + D),
                    (0.0, H + T), (-D, H + T),
                    (-D, -T), (0.0, -T),
                ]
            return [
                (-D, 0.0), (W + D, 0.0),
                (W + D, H + T), (W, H + T),
                (W, H + D), (0.0, H + D),
                (0.0, H + T), (-D, H + T),
            ]
        top = self.top_edge()
        if T <= 0:
            return [
                (-H, 0.0),
                (0.0, 0.0),
                (0.0, top),
                (W, top),
                (W, 0.0),
                (W + H, 0.0),
                (W + H, D),
                (-H, D),
            ]
        if self.C:
            # клапаны стоят у верхних кромок стенок, поэтому контур идёт
            # уступами: сверху узкая колонна потолка, ниже — полная ширина
            return [
                (0.0, top),
                (W, top),
                (W, -T),
                (W + H, -T),
                (W + H, 0.0),
                (W + H + T, 0.0),
                (W + H + T, D),
                (-H - T, D),
                (-H - T, 0.0),
                (-H, 0.0),
                (-H, -T),
                (0.0, -T),
            ]
        return [
            (-H, -T),
            (0.0, -T),
            (0.0, top),
            (W, top),
            (W, -T),
            (W + H, -T),
            (W + H, D),
            (-H, D),
        ]

    def folds(self) -> List[Tuple[Tuple[float, float], Tuple[float, float]]]:
        W, D, H, T = self.W, self.D, self.H, self.T
        if self.layout == "back":
            f = [
                ((0.0, 0.0), (0.0, H)),            # задник — левая стенка
                ((W, 0.0), (W, H)),                # задник — правая стенка
                ((0.0, H), (W, H)),                # задник — пол
            ]
            if self.C:
                f += [((0.0, 0.0), (W, 0.0))]      # задник — потолок
            if T > 0:
                f += [((-D, H), (0.0, H)), ((W, H), (W + D, H))]   # стенки — пол
                if self.C:
                    f += [((-D, 0.0), (0.0, 0.0)),                 # стенки — потолок
                          ((W, 0.0), (W + D, 0.0))]
            return f
        f = [
            ((0.0, 0.0), (W, 0.0)),            # пол — задник
            ((0.0, 0.0), (0.0, D)),            # пол — левая стенка
            ((W, 0.0), (W, D)),                # пол — правая стенка
        ]
        if self.C:
            f += [((0.0, -H), (W, -H))]        # задник — потолок
        if T > 0:
            f += [((-H, 0.0), (0.0, 0.0)),     # левая стенка — клапан
                  ((W, 0.0), (W + H, 0.0))]    # правая стенка — клапан
            if self.C:
                f += [((-H, 0.0), (-H, D)),           # левая стенка — клапан на потолок
                      ((W + H, 0.0), (W + H, D))]     # правая стенка — клапан на потолок
        return f

    def slits(self) -> List[Tuple[Tuple[float, float], Tuple[float, float]]]:
        """Разрезы, отделяющие клапан от соседней панели (иначе не сложится)."""
        W, D, H, T = self.W, self.D, self.H, self.T
        if T <= 0:
            return []
        if self.layout == "back":
            s = [((0.0, H), (0.0, H + T)), ((W, H), (W, H + T))]
            if self.C:
                s += [((0.0, -T), (0.0, 0.0)), ((W, -T), (W, 0.0))]
            return s
        return [
            ((0.0, -H), (0.0, 0.0)),
            ((W, -H), (W, 0.0)),
        ]

    def bbox(self) -> Tuple[float, float, float, float]:
        if self.layout == "back":
            y0 = -self.D if self.C else 0.0
            return -self.D, y0, self.W + self.D, self.H + self.D
        top = self.H + (self.D if self.C else 0.0)
        if self.T > 0:
            top = max(top, self.T)
        # клапаны на потолок выносят край листа ещё на T с каждой стороны
        side = self.T if (self.T > 0 and self.C) else 0.0
        return -(self.H + side), -top, self.W + self.H + side, self.D


def layout_footprint(layout: str, W: float, D: float, H: float,
                     T: float, C: bool) -> Tuple[float, float]:
    """Габариты листа для выбранной раскладки."""
    n = Net(W=W, D=D, H=H, T=T, C=C, layout=layout)
    x0, y0, x1, y1 = n.bbox()
    return x1 - x0, y1 - y0


def pick_layout(W: float, D: float, H: float, T: float, C: bool) -> str:
    """Компактная раскладка: сначала меньшая длинная сторона листа, потом площадь.

    Длинная сторона важнее: именно она решает, влезет ли выкройка на A4/A3.
    """
    best, best_s = "cross", None
    for name in ("cross", "back"):
        w, h = layout_footprint(name, W, D, H, T, C)
        score = (round(max(w, h), 1), round(w * h))
        if best_s is None or score < best_s:
            best, best_s = name, score
    return best


# ----------------------------------------------------------------------------
# Шрифты и мелкие помощники рисования
# ----------------------------------------------------------------------------

def load_font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    cands = []
    win = os.environ.get("WINDIR", r"C:\Windows")
    if bold:
        cands += [os.path.join(win, "Fonts", "arialbd.ttf"),
                  os.path.join(win, "Fonts", "seguisb.ttf")]
    cands += [os.path.join(win, "Fonts", "arial.ttf"),
              os.path.join(win, "Fonts", "segoeui.ttf"),
              os.path.join(win, "Fonts", "tahoma.ttf"),
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]
    for p in cands:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except OSError:
                pass
    try:
        return ImageFont.load_default(size=size)
    except TypeError:                                    # Pillow < 10.1
        return ImageFont.load_default()


def dashed(draw: ImageDraw.ImageDraw, p0, p1, color, width=1, dash=8.0, gap=5.0):
    x0, y0 = p0
    x1, y1 = p1
    length = math.hypot(x1 - x0, y1 - y0)
    if length <= 0:
        return
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    t = 0.0
    while t < length:
        t2 = min(t + dash, length)
        draw.line([(x0 + ux * t, y0 + uy * t), (x0 + ux * t2, y0 + uy * t2)],
                  fill=color, width=width)
        t = t2 + gap


def cover_crop(img: Image.Image, tw: int, th: int,
               fx: float = 0.5, fy: float = 0.5) -> Image.Image:
    tw, th = max(1, int(round(tw))), max(1, int(round(th)))
    w, h = img.size
    s = max(tw / w, th / h)
    nw, nh = max(tw, int(round(w * s))), max(th, int(round(h * s)))
    im = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - tw) * min(max(fx, 0.0), 1.0)
    top = (nh - th) * min(max(fy, 0.0), 1.0)
    return im.crop((int(round(left)), int(round(top)),
                    int(round(left)) + tw, int(round(top)) + th))


def contain_pad(img: Image.Image, tw: int, th: int, bg) -> Image.Image:
    tw, th = max(1, int(round(tw))), max(1, int(round(th)))
    w, h = img.size
    s = min(tw / w, th / h)
    nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
    im = img.resize((nw, nh), Image.LANCZOS)
    canvas = Image.new("RGB", (tw, th), bg)
    canvas.paste(im, ((tw - nw) // 2, (th - nh) // 2))
    return canvas


def tint(img: Image.Image, factor: float, blend_to=None, alpha: float = 0.0) -> Image.Image:
    a = np.asarray(img.convert("RGB"), dtype=np.float32) * factor
    if blend_to is not None and alpha > 0:
        tgt = np.asarray(blend_to, dtype=np.float32).reshape(1, 1, 3)
        a = a * (1 - alpha) + tgt * alpha
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), "RGB")


def _sample_quad(src: Image.Image, quad, size) -> Image.Image:
    """Прямоугольник size <- четырёхугольник quad исходника (проективно).

    Нужен для объёмной раскладки: каждая панель — трапеция внутри картинки.
    """
    w, h = max(1, int(size[0])), max(1, int(size[1]))
    dst = [(0.0, 0.0), (w, 0.0), (w, h), (0.0, h)]
    M = _homography(dst, [(float(x), float(y)) for (x, y) in quad])
    if not np.all(np.isfinite(M)) or abs(M[2, 2]) < 1e-9:
        return cover_crop(src, w, h)
    M = M / M[2, 2]
    coeffs = tuple(float(v) for v in
                   (M[0, 0], M[0, 1], M[0, 2], M[1, 0], M[1, 1], M[1, 2],
                    M[2, 0], M[2, 1]))
    try:
        return src.convert("RGB").transform((w, h), Image.PERSPECTIVE, coeffs,
                                            resample=Image.BICUBIC)
    except (ValueError, ZeroDivisionError):
        return cover_crop(src, w, h)


# ----------------------------------------------------------------------------
# Текстуры панелей
# ----------------------------------------------------------------------------

def _ao(img: Image.Image, strength: float = 0.16, width: float = 0.07,
        strong: Tuple[str, ...] = ("top",), factor: float = 1.0) -> Image.Image:
    """Мягкое затемнение у сгибов: без него собранная коробка читается как
    плоская картинка. strong — стороны, где проходит сгиб (там тень сильнее).
    В текстуре верх/низ/лево/право — это стороны развёртки, а не коробки.
    """
    w, h = img.size
    yy = np.broadcast_to(np.linspace(0.0, 1.0, h, dtype=np.float32)[:, None], (h, w))
    xx = np.broadcast_to(np.linspace(0.0, 1.0, w, dtype=np.float32)[None, :], (h, w))
    wd = max(width, 1e-3)

    def side(k: str) -> float:
        return 1.0 if k in strong else 0.5

    near = [np.clip(1.0 - xx / wd, 0, 1) * side("left"),
            np.clip(1.0 - (1.0 - xx) / wd, 0, 1) * side("right"),
            np.clip(1.0 - yy / wd, 0, 1) * side("top"),
            np.clip(1.0 - (1.0 - yy) / wd, 0, 1) * side("bottom")]
    m = np.maximum.reduce(near) ** 1.6
    shade = factor * (1.0 - strength * m)
    arr = np.asarray(img.convert("RGB"), np.float32) * shade[..., None]
    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


class ArtBuilder:
    """Готовит текстуры для каждой панели из исходного рисунка.

    fill="box"  — картинка считается видом внутрь коробки: задник получает
                  её середину, а боковины, пол и потолок — края, как если бы
                  рисунок продолжался за сгибы (перспективная раскладка).
    fill="flat" — старый режим: картинка только на заднике, остальное
                  выводится из его краёв (side_mode / floor_mode).
    """

    def __init__(self, src: Optional[Image.Image], ppm: float,
                 side_mode: str = "wrap", floor_mode: str = "blur",
                 focus: Tuple[float, float] = (0.5, 0.5),
                 art_mode: str = "cover", bg=(255, 255, 255),
                 fill: str = "box", depth_k: float = 1.8):
        self.src = src
        self.ppm = ppm
        self.side_mode = side_mode
        self.floor_mode = floor_mode
        self.focus = focus
        self.art_mode = art_mode
        self.bg = bg
        self.fill = fill
        self.depth_k = max(0.25, float(depth_k))
        self._back_cache: Dict[Tuple[float, float], Image.Image] = {}
        self._win_cache: Dict[Tuple[float, float], Tuple[Image.Image, float, float]] = {}

    # -- задник -------------------------------------------------------------
    def back(self, w_mm: float, h_mm: float) -> Image.Image:
        key = (round(w_mm, 3), round(h_mm, 3))
        if key in self._back_cache:
            return self._back_cache[key]
        tw, th = int(round(w_mm * self.ppm)), int(round(h_mm * self.ppm))
        if self.src is None:
            im = self._placeholder(tw, th)
        elif self.art_mode == "contain":
            im = contain_pad(self.src, tw, th, self.bg)
        else:
            im = cover_crop(self.src, tw, th, *self.focus)
        self._back_cache[key] = im
        return im

    def _placeholder(self, tw: int, th: int) -> Image.Image:
        """Серая заглушка, если рисунок не задан."""
        y = np.linspace(0, 1, max(1, th), dtype=np.float32)[:, None]
        base = (np.array([246, 244, 240], np.float32)[None, None, :]
                + (np.array([206, 214, 226], np.float32)
                   - np.array([246, 244, 240], np.float32))[None, None, :] * y)
        arr = np.repeat(base, max(1, tw), axis=1)
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

    # -- боковины -----------------------------------------------------------
    def side(self, side: str, w_mm: float, h_mm: float,
             back_w_mm: float, back_h_mm: float) -> Image.Image:
        """w_mm — размер вдоль оси X развёртки (это высота стенки),
        h_mm — вдоль Y (это глубина).

        Текстура строится так, чтобы у сгиба с полом картинка продолжала
        край задника: профиль берётся по вертикали задника и растягивается
        на всю глубину стенки (постоянен вдоль Y).
        """
        tw, th = int(round(w_mm * self.ppm)), int(round(h_mm * self.ppm))
        back = self.back(back_w_mm, back_h_mm)

        if self.side_mode == "none" or self.src is None:
            return Image.new("RGB", (tw, th), self.bg if self.src is None else (232, 232, 232))

        strip_frac = 0.045
        sw = max(2, int(back.width * strip_frac))
        if side == "left":
            strip = back.crop((0, 0, sw, back.height))
        else:
            strip = back.crop((back.width - sw, 0, back.width, back.height))

        arr = np.asarray(strip.convert("RGB"), np.float32)
        # профиль вдоль высоты стенки: индекс 0 = верх задника
        prof = arr.mean(axis=1)
        if prof.shape[0] != tw:
            src_i = np.arange(prof.shape[0], dtype=np.float64)
            dst_i = np.linspace(0, prof.shape[0] - 1, tw)
            prof = np.stack([np.interp(dst_i, src_i, prof[:, i]) for i in range(3)], axis=1)

        # левая стенка: X=-H — верх, X=0 — низ; правая наоборот
        if side == "right":
            prof = prof[::-1]

        if self.side_mode == "solid":
            mean = prof.reshape(-1, 3).mean(axis=0)
            color = tuple(int(v) for v in np.clip(mean, 0, 255))
            return Image.new("RGB", (tw, th), color)

        # «wrap»: полоса постоянна вдоль Y (глубины) и меняется вдоль X (высоты)
        grad = np.repeat(prof[None, :, :], th, axis=0)          # (th, tw, 3)
        im = Image.fromarray(np.clip(grad, 0, 255).astype(np.uint8), "RGB")
        radius = 0.012 * max(tw, th) if self.side_mode == "blur" else 0.004 * max(tw, th)
        im = im.filter(ImageFilter.GaussianBlur(radius=max(1.0, radius)))
        return tint(im, 0.94)

    # -- пол ----------------------------------------------------------------
    def floor(self, w_mm: float, d_mm: float,
              back_w_mm: float, back_h_mm: float) -> Image.Image:
        tw, th = int(round(w_mm * self.ppm)), int(round(d_mm * self.ppm))
        back = self.back(back_w_mm, back_h_mm)

        if self.floor_mode == "none" or self.src is None:
            return Image.new("RGB", (tw, th), self.bg if self.src is None else (226, 226, 226))

        band_h = max(4, int(back.height * 0.22))
        band = back.crop((0, back.height - band_h, back.width, back.height))

        if self.floor_mode == "solid":
            arr = np.asarray(band.convert("RGB"), np.float32)
            mean = arr.reshape(-1, 3).mean(axis=0)
            return Image.new("RGB", (tw, th), tuple(mean.astype(int)))

        im = band.resize((tw, th), Image.BICUBIC)
        im = im.filter(ImageFilter.GaussianBlur(radius=max(3.0, 0.03 * th)))

        # лёгкая виньетка + подъём теней (иначе тёмный низ даёт «дыру»)
        yy, xx = np.mgrid[0:th, 0:tw].astype(np.float32)
        cx, cy = tw * 0.5, th * 0.42
        r = np.sqrt(((xx - cx) / max(tw, 1)) ** 2 + ((yy - cy) / max(th, 1)) ** 2)
        v = np.clip(1.0 - 0.28 * r, 0.74, 1.0)[..., None]
        arr = np.power(np.asarray(im.convert("RGB"), np.float32) / 255.0, 0.80) * 255.0
        arr = arr * v
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")

    # -- объёмная раскладка: картинка как вид внутрь коробки ----------------
    def canopy(self, w_mm: float, d_mm: float) -> Image.Image:
        """Мягкий «свод» для потолка в плоской раскладке."""
        tw = max(1, int(round(w_mm * self.ppm)))
        th = max(1, int(round(d_mm * self.ppm)))
        if self.src is None:
            return self._placeholder(tw, th)
        iw, ih = self.src.size
        band = self.src.convert("RGB").crop((0, 0, iw, max(1, int(ih * 0.18))))
        im = band.resize((tw, th), Image.BICUBIC)
        im = im.filter(ImageFilter.GaussianBlur(max(2.0, 0.02 * min(tw, th))))
        return _ao(im, strength=0.22, strong=("top", "bottom"), factor=0.82)

    def _window(self, back_w: float, back_h: float):
        """Прямоугольник «входа в коробку» в пикселях исходника.

        Он же — рамка, которую пользователь двигает на странице: всё, что
        попало внутрь, уходит на панели, остальное не печатается.
        """
        iw, ih = self.src.size
        s = min(iw / back_w, ih / back_h)
        w, h = back_w * s, back_h * s
        fx = min(max(self.focus[0], 0.0), 1.0)
        fy = min(max(self.focus[1], 0.0), 1.0)
        return (iw - w) * fx, (ih - h) * fy, w, h

    def _window_canvas(self, back_w: float, back_h: float):
        """Окно, вырезанное из исходника, с достройкой краёв (для вылетов)."""
        key = (round(back_w, 3), round(back_h, 3))
        if key in self._win_cache:
            return self._win_cache[key]

        iw, ih = self.src.size
        wx, wy, ww, wh = self._window(back_w, back_h)
        pad = int(round(0.12 * max(ww, wh)))
        x0 = int(math.floor(wx - pad))
        y0 = int(math.floor(wy - pad))
        x1 = int(math.ceil(wx + ww + pad))
        y1 = int(math.ceil(wy + wh + pad))

        cx0, cy0 = max(0, x0), max(0, y0)
        cx1, cy1 = min(iw, x1), min(ih, y1)
        arr = np.asarray(self.src.convert("RGB").crop((cx0, cy0, cx1, cy1)), np.uint8)
        arr = np.pad(arr, ((cy0 - y0, y1 - cy1), (cx0 - x0, x1 - cx1), (0, 0)),
                     mode="edge")
        res = (Image.fromarray(arr, "RGB"), x0, y0)
        self._win_cache[key] = res
        return res

    def _panel_quad(self, kind: str, W: float, H: float, D: float,
                    layout: str = "cross"):
        """Углы панели (TL, TR, BR, BL) в долях окна — перспектива из точки
        съёмки перед коробкой на середине высоты.

        В раскладке «боковины на заднике» стенки на листе повёрнуты на 90°
        (ширина панели — глубина, высота — высота), поэтому у них свой набор
        углов; остальные панели совпадают с «крестом».
        """
        k = self.depth_k

        def uv(x: float, y: float, z: float):
            # Развёртка печатается лицевой стороной внутрь и складывается без
            # зеркального отражения: ось u (вправо по листу) совпадает с
            # координатой x, поэтому u = x / W. Превью дополнительно отзеркалено
            # по горизонтали отдельно (его камера левосторонняя).
            xu = x / W
            lam = (k * D) / (k * D + (D - z)) if D > 0 else 1.0
            return (0.5 + (xu - 0.5) * lam, 0.5 - (y / H - 0.5) * lam)

        # Углы заданы в порядке текстуры (TL, TR, BR, BL).
        corners = {
            "back": [(0, H, 0), (W, H, 0), (W, 0, 0), (0, 0, 0)],
            "left": [(0, H, 0), (0, 0, 0), (0, 0, D), (0, H, D)],
            "right": [(W, 0, 0), (W, H, 0), (W, H, D), (W, 0, D)],
            "floor": [(0, 0, 0), (W, 0, 0), (W, 0, D), (0, 0, D)],
            # потолок приклеен к заднику верхней кромкой: у развёртки его
            # верх (t=0) — это передний край коробки, низ (t=1) — задник
            "top": [(0, H, D), (W, H, D), (W, H, 0), (0, H, 0)],
        }
        if layout == "back" and kind in ("left", "right"):
            # стенка повёрнута: u идёт по глубине, v — по высоте
            corners = {
                "left": [(0, H, D), (0, H, 0), (0, 0, 0), (0, 0, D)],
                "right": [(W, H, 0), (W, H, D), (W, 0, D), (W, 0, 0)],
            }[kind]
        else:
            corners = corners[kind]
        return [uv(*p) for p in corners]

    def panel(self, kind: str, w_mm: float, h_mm: float, net: "Net",
              frac: Tuple[float, float, float, float] = (0.0, 1.0, 0.0, 1.0)
              ) -> Image.Image:
        """Текстура панели в объёмной раскладке.

        frac = (s0, s1, t0, t1) — какая часть панели нужна: при вылетах под
        рез панель выходит за свои границы, и перспектива это учитывает.
        """
        tw = max(1, int(round(w_mm * self.ppm)))
        th = max(1, int(round(h_mm * self.ppm)))
        if self.src is None:
            return self._placeholder(tw, th)

        canvas, ox, oy = self._window_canvas(net.W, net.H)
        wx, wy, ww, wh = self._window(net.W, net.H)
        quad = [(wx + u * ww, wy + v * wh)
                for (u, v) in self._panel_quad(kind, net.W, net.H, net.D,
                                               layout=getattr(net, "layout", "cross"))]

        unit = [(0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)]
        Hm = _homography(unit, quad)
        if not np.all(np.isfinite(Hm)):
            return cover_crop(self.src, tw, th, *self.focus)

        s0, s1, t0, t1 = frac
        out = []
        for (s, t) in [(s0, t0), (s1, t0), (s1, t1), (s0, t1)]:
            p = Hm @ np.array([s, t, 1.0])
            if abs(p[2]) < 1e-9:
                return cover_crop(self.src, tw, th, *self.focus)
            out.append((p[0] / p[2] - ox, p[1] / p[2] - oy))
        im = _sample_quad(canvas, out, (tw, th))

        # тени у сгибов + приглушённый потолок: иначе коробка выглядит плоской
        if kind == "back":
            return _ao(im, strength=0.14, strong=("top", "bottom", "left", "right"))
        if kind == "top":
            # потолок видно под острым углом и он в тени: лёгкое размытие
            # убирает «полосы» от растянутой полоски картинки
            im = im.filter(ImageFilter.GaussianBlur(max(1.0, 0.010 * min(tw, th))))
            return _ao(im, strength=0.22, strong=("top",), factor=0.82)
        if kind == "floor":
            return _ao(im, strength=0.18, strong=("top",), factor=0.96)
        return _ao(im, strength=0.18, strong=("top",), factor=0.93)


# ----------------------------------------------------------------------------
# Отрисовка плоской развёртки
# ----------------------------------------------------------------------------

@dataclass
class SheetResult:
    image: Image.Image
    width_mm: float
    height_mm: float
    net: Net


def render_sheet(net: Net, art: ArtBuilder, dpi: float, margin_mm: float,
                 bleed_mm: float, marks: bool = True, labels: bool = False,
                 title: str = "", subtitle: str = "",
                 box_mm: Optional[Tuple[float, float, float]] = None,
                 blank: bool = False) -> SheetResult:
    ppm = dpi / MM_INCH
    bx0, by0, bx1, by1 = net.bbox()
    width_mm = (bx1 - bx0) + 2 * margin_mm
    height_mm = (by1 - by0) + 2 * margin_mm + (18.0 if marks else 0.0)
    Wpx = int(round(width_mm * ppm))
    Hpx = int(round(height_mm * ppm))

    # сдвиг: координаты развёртки -> пиксели листа
    ox_mm = margin_mm - bx0
    oy_mm = margin_mm - by0

    def P(x_mm: float, y_mm: float) -> Tuple[float, float]:
        return ((x_mm + ox_mm) * ppm, (y_mm + oy_mm) * ppm)

    canvas = Image.new("RGB", (Wpx, Hpx), (255, 255, 255))

    panels = net.panels()
    bside = net.bleed_sides()

    # --- рисунок на панелях -------------------------------------------------
    order = [n for n in ("floor", "left", "right", "back", "top") if n in panels]
    box = art.fill == "box" and art.src is not None
    for name in ([] if blank else order):
        x0, y0, x1, y1 = panels[name]
        pw, ph = x1 - x0, y1 - y0

        # текстура с вылетами только с резаных сторон
        l, t, r, b = bside[name]
        bl = bleed_mm if l else 0.0
        bt = bleed_mm if t else 0.0
        br = bleed_mm if r else 0.0
        bb = bleed_mm if b else 0.0
        aw, ah = pw + bl + br, ph + bt + bb

        # в раскладке «боковины на заднике» стенки на листе повёрнуты на 90°
        rot = net.layout == "back" and name in ("left", "right")

        if box:
            frac = (-bl / pw, 1.0 + br / pw, -bt / ph, 1.0 + bb / ph)
            tex = art.panel(name, aw, ah, net, frac)
        elif name == "back":
            tex = art.back(aw, ah)
        elif name in ("left", "right"):
            tex = art.side(name, aw, ah, net.W, net.H)
            if rot:
                tex = tex.transpose(Image.TRANSPOSE).resize(
                    (max(1, int(round(aw * ppm))), max(1, int(round(ah * ppm)))),
                    Image.BICUBIC)
        elif name == "top":
            tex = art.canopy(aw, ah)
        else:
            tex = art.floor(aw, ah, net.W, net.H)

        tx, ty = P(x0 - bl, y0 - bt)
        tgt = (int(round(tx)), int(round(ty)),
               int(round(tx + aw * ppm)), int(round(ty + ah * ppm)))
        if tex.size != (tgt[2] - tgt[0], tgt[3] - tgt[1]):
            tex = tex.resize((tgt[2] - tgt[0], tgt[3] - tgt[1]), Image.LANCZOS)
        canvas.paste(tex, (tgt[0], tgt[1]))

    # --- клапаны для склейки ------------------------------------------------
    for name in [n for n in panels if n.startswith("tab_")]:
        x0, y0, x1, y1 = panels[name]
        p0 = P(x0, y0)
        p1 = P(x1, y1)
        ImageDraw.Draw(canvas).rectangle(
            [int(round(p0[0])), int(round(p0[1])), int(round(p1[0])), int(round(p1[1]))],
            fill=GLUE_COLOR)

    if not marks:
        return SheetResult(canvas, width_mm, height_mm, net)

    # --- линии сгиба и реза ------------------------------------------------
    dr = ImageDraw.Draw(canvas)
    w_cut = max(1, int(round(0.35 * ppm)))
    w_halo = w_cut + 2
    w_fold = max(1, int(round(0.22 * ppm)))

    for (a, b) in net.slits():
        dr.line([P(*a), P(*b)], fill=(255, 255, 255), width=w_halo)
        dr.line([P(*a), P(*b)], fill=CUT_COLOR, width=w_cut)

    fold_dash = 2.4 * ppm
    fold_gap = 1.8 * ppm
    for (a, b) in net.folds():
        dashed(dr, P(*a), P(*b), FOLD_COLOR, width=w_fold,
               dash=fold_dash, gap=fold_gap)

    poly = [P(x, y) for (x, y) in net.outline()]
    poly_closed = poly + [poly[0]]
    dr.line(poly_closed, fill=(255, 255, 255), width=w_halo, joint="curve")
    dr.line(poly_closed, fill=CUT_COLOR, width=w_cut, joint="curve")

    # --- рамка листа и линейка ---------------------------------------------
    pad = 4.0 * ppm
    fx0 = min(p[0] for p in poly) - pad
    fy0 = min(p[1] for p in poly) - pad
    fx1 = max(p[0] for p in poly) + pad
    fy1 = max(p[1] for p in poly) + pad
    dr.rectangle([fx0, fy0, fx1, fy1],
                 outline=(210, 210, 210), width=max(1, int(0.15 * ppm)))

    # --- подписи на клапанах -----------------------------------------------
    f_tab = load_font(max(9, int(2.3 * ppm)), bold=True)
    for name in [n for n in panels if n.startswith("tab_")]:
        x0, y0, x1, y1 = panels[name]
        cx, cy = P((x0 + x1) / 2, (y0 + y1) / 2)
        txt = "КЛЕЙ"
        if (y1 - y0) > (x1 - x0):
            # узкая вертикальная полоса — пишем вдоль неё
            bb = dr.textbbox((0, 0), txt, font=f_tab)
            tw, th = bb[2] - bb[0] + 4, bb[3] - bb[1] + 4
            tile = Image.new("RGBA", (tw, th), (0, 0, 0, 0))
            ImageDraw.Draw(tile).text((2 - bb[0], 2 - bb[1]), txt, font=f_tab,
                                      fill=(176, 152, 112, 255))
            tile = tile.rotate(90, expand=True)
            canvas.paste(tile, (int(round(cx - tile.width / 2)),
                                int(round(cy - tile.height / 2))), tile)
            continue
        tb = dr.textbbox((0, 0), txt, font=f_tab)
        dr.text((cx - (tb[2] - tb[0]) / 2, cy - (tb[3] - tb[1]) / 2),
                txt, font=f_tab, fill=(176, 152, 112))

    # --- подписи панелей (только для пробной печати) -----------------------
    if labels:
        f_lbl = load_font(max(9, int(2.6 * ppm)), bold=True)
        f_dim = load_font(max(8, int(2.1 * ppm)))
        info = {
            "back": ("ЗАДНИК", f"{net.W:.0f} × {net.H:.0f} мм"),
            "left": ("БОКОВИНА", f"{net.D:.0f} × {net.H:.0f} мм"),
            "right": ("БОКОВИНА", f"{net.D:.0f} × {net.H:.0f} мм"),
            "floor": ("ПОЛ", f"{net.W:.0f} × {net.D:.0f} мм"),
            "top": ("ПОТОЛОК", f"{net.W:.0f} × {net.D:.0f} мм"),
        }
        for name, (t1, t2) in info.items():
            if name not in panels:
                continue
            x0, y0, x1, y1 = panels[name]
            cx, cy = P((x0 + x1) / 2, (y0 + y1) / 2)
            for txt, fnt, dy in ((t1, f_lbl, -1), (t2, f_dim, 1)):
                tb = dr.textbbox((0, 0), txt, font=fnt)
                tw_, th_ = tb[2] - tb[0], tb[3] - tb[1]
                pos = (cx - tw_ / 2, cy + dy * th_ * 0.78 - th_ / 2)
                dr.text(pos, txt, font=fnt, fill=(70, 70, 70),
                        stroke_width=max(1, int(0.35 * ppm)),
                        stroke_fill=(255, 255, 255))

    # --- масштабная линейка 50 мм ------------------------------------------
    rx, ry = P(bx0, by1 + 5.6)
    rlen = 50.0 * ppm
    dr.line([(rx, ry), (rx + rlen, ry)], fill=CUT_COLOR, width=max(1, int(0.2 * ppm)))
    f_sc = load_font(max(8, int(2.0 * ppm)))
    for i in range(0, 51, 5):
        h = 2.2 * ppm if i % 10 == 0 else 1.2 * ppm
        dr.line([(rx + i * ppm, ry), (rx + i * ppm, ry - h)],
                fill=CUT_COLOR, width=max(1, int(0.18 * ppm)))
        if i % 10 == 0:
            dr.text((rx + i * ppm - 1.4 * ppm, ry + 0.6 * ppm), f"{i}",
                    font=f_sc, fill=LABEL_COLOR)
    dr.text((rx + rlen + 3.0 * ppm, ry + 0.9 * ppm), "мм · масштаб 1:1",
            font=f_sc, fill=LABEL_COLOR)

    # --- легенда: где резать, где сгибать -----------------------------------
    # у узких листов легенда может не влезть в одну строку — тогда переносим
    f_lg = load_font(max(9, int(2.4 * ppm)))
    leg_items = (("резать", "cut"), ("сгиб", "fold"), ("клей", "glue"))
    sample = 10.0 * ppm
    gap_lg = 1.6 * ppm
    step_lg = 4.5 * ppm
    leg_left = P(bx0, 0.0)[0]
    leg_max = P(bx1 - 96.0, 0.0)[0] - leg_left
    leg_right = leg_left + leg_max
    cur_x = leg_left
    leg_y = P(0.0, by1 + 12.6)[1]
    row_h = 5.2 * ppm
    tws = []
    for txt, _kind in leg_items:
        tb = dr.textbbox((0, 0), txt, font=f_lg)
        tws.append(tb[2] - tb[0])
    for (txt, kind), tw in zip(leg_items, tws):
        width = sample + gap_lg + tw
        if cur_x > leg_left and cur_x + width > leg_right:
            cur_x = leg_left
            leg_y += row_h
        if cur_x + width > leg_right:
            break                      # места нет совсем — легенду не рисуем
        if kind == "cut":
            dr.line([(cur_x, leg_y), (cur_x + sample, leg_y)],
                    fill=CUT_COLOR, width=w_cut)
        elif kind == "fold":
            dashed(dr, (cur_x, leg_y), (cur_x + sample, leg_y), FOLD_COLOR,
                   width=w_fold, dash=fold_dash * 0.55, gap=fold_gap * 0.55)
        else:
            dr.rectangle([cur_x, leg_y - 1.7 * ppm,
                          cur_x + sample, leg_y + 1.7 * ppm],
                         fill=GLUE_COLOR, outline=GLUE_EDGE,
                         width=max(1, int(0.16 * ppm)))
        dr.text((cur_x + sample + gap_lg, leg_y - 2.4 * ppm), txt,
                font=f_lg, fill=LABEL_COLOR)
        cur_x += width + step_lg

    # --- штамп -------------------------------------------------------------
    sx, sy = P(bx1 - 92.0, by1 + 5.0)
    f_t = load_font(max(10, int(3.0 * ppm)), bold=True)
    f_s = load_font(max(8, int(2.1 * ppm)))
    lines = []
    if title:
        dr.text((sx, sy), title, font=f_t, fill=(40, 40, 40))
        sy += 4.8 * ppm
    if subtitle:
        dr.text((sx, sy), subtitle, font=f_s, fill=LABEL_COLOR)
        sy += 3.4 * ppm
    lines.append(f"ЗАДНИК {net.W:.0f}×{net.H:.0f} · БОКОВИНА {net.D:.0f}×{net.H:.0f} (×2)"
                 f" · ПОЛ {net.W:.0f}×{net.D:.0f}"
                 + (f" · ПОТОЛОК {net.W:.0f}×{net.D:.0f}" if net.C else "")
                 + " мм")
    if box_mm:
        lines.append(f"коробка {box_mm[0]:.0f}×{box_mm[1]:.0f}×{box_mm[2]:.0f} мм (внутри) · "
                     f"{_dt.date.today():%d.%m.%Y}")
    else:
        lines.append(f"{_dt.date.today():%d.%m.%Y}")
    for ln in lines:
        dr.text((sx, sy), ln, font=f_s, fill=LABEL_COLOR)
        sy += 3.3 * ppm

    return SheetResult(canvas, width_mm, height_mm, net)


# ----------------------------------------------------------------------------
# PDF (с раскладкой на листы, если выкройка не влезает)
# ----------------------------------------------------------------------------

def _choose_paper(width_mm: float, height_mm: float, margin_mm: float,
                  prefer: str) -> Tuple[str, float, float, bool]:
    """Возвращает (имя, ширина, высота, влезает_целиком)."""
    if prefer and prefer != "auto":
        pw, ph = PAPERS[prefer]
        for (w, h) in ((pw, ph), (ph, pw)):
            if width_mm <= w and height_mm <= h:
                return prefer, w, h, True
        return prefer, max(pw, ph), min(pw, ph), False

    # auto: сначала ищем лист, на который выкройка влезает целиком
    for n in ("a4", "a3"):
        pw, ph = PAPERS[n]
        for (w, h) in ((ph, pw), (pw, ph)):
            if width_mm <= w - 2 * margin_mm and height_mm <= h - 2 * margin_mm:
                return n, w, h, True

    # не влезает — режем A4 (самый доступный формат)
    pw, ph = PAPERS["a4"]
    if width_mm > height_mm:
        pw, ph = ph, pw
    return "a4", pw, ph, False


def save_pdf(img: Image.Image, path: str, width_mm: float, height_mm: float,
             dpi: float, paper: str = "auto", margin_mm: float = 10.0,
             overlap_mm: float = 10.0) -> dict:
    ppm = dpi / MM_INCH
    info = {"pages": 1, "paper": None, "tiles": (1, 1), "fits": True}

    if paper == "none":
        img.save(path, "PDF", resolution=dpi)
        return info

    pname, pw, ph, fits = _choose_paper(width_mm, height_mm, margin_mm, paper)
    info["paper"] = pname
    info["fits"] = fits

    if fits:
        page = Image.new("RGB", (int(round(pw * ppm)), int(round(ph * ppm))),
                         (255, 255, 255))
        dst = (int(round((pw - width_mm) / 2 * ppm)),
               int(round((ph - height_mm) / 2 * ppm)))
        page.paste(img, dst)
        page.save(path, "PDF", resolution=dpi)
        return info

    # --- раскладка на листы ---
    tw = pw - 2 * margin_mm
    th = ph - 2 * margin_mm
    step_x = tw - overlap_mm
    step_y = th - overlap_mm
    ncols = max(1, math.ceil((width_mm - overlap_mm) / step_x))
    nrows = max(1, math.ceil((height_mm - overlap_mm) / step_y))
    info["tiles"] = (ncols, nrows)
    info["pages"] = ncols * nrows

    pages = []
    for r in range(nrows):
        for c in range(ncols):
            page = Image.new("RGB", (int(round(pw * ppm)), int(round(ph * ppm))),
                             (255, 255, 255))
            x0, y0 = c * step_x, r * step_y
            x1, y1 = min(x0 + tw, width_mm), min(y0 + th, height_mm)
            if x1 <= x0 or y1 <= y0:
                continue
            tile = img.crop((int(round(x0 * ppm)), int(round(y0 * ppm)),
                             int(round(x1 * ppm)), int(round(y1 * ppm))))
            page.paste(tile, (int(round(margin_mm * ppm)), int(round(margin_mm * ppm))))
            dr = ImageDraw.Draw(page)
            f = load_font(max(9, int(2.6 * ppm)))
            txt = (f"лист {len(pages) + 1}/{ncols * nrows} · "
                   f"колонка {c + 1}/{ncols} · ряд {r + 1}/{nrows} · "
                   f"наложение {overlap_mm:.0f} мм")
            dr.text((margin_mm * ppm, margin_mm * ppm * 0.35),
                    txt, font=f, fill=(60, 60, 60))
            # уголок-метка совмещения для не-первых листов
            if c > 0 or r > 0:
                m = margin_mm * ppm
                dr.line([(m, m), (m + 9 * ppm, m)], fill=(150, 150, 150), width=2)
                dr.line([(m, m), (m, m + 9 * ppm)], fill=(150, 150, 150), width=2)
            pages.append(page)

    if not pages:
        pages = [img]
        info["pages"] = 1
    pages[0].save(path, "PDF", resolution=dpi,
                  save_all=True, append_images=pages[1:])
    return info


# ----------------------------------------------------------------------------
# Превью собранной диорамы (простая перспективная проекция)
# ----------------------------------------------------------------------------

def _look_at(eye, target, up=(0, 0, 1)):
    eye = np.asarray(eye, float)
    target = np.asarray(target, float)
    up = np.asarray(up, float)
    f = target - eye
    f /= np.linalg.norm(f)
    r = np.cross(f, up)
    r /= np.linalg.norm(r)
    u = np.cross(r, f)
    return np.stack([r, u, f]), eye


def _project(pts, eye, target, fov_deg, wpx, hpx):
    R, e = _look_at(eye, target)
    pts = np.asarray(pts, float)
    cam = (pts - e) @ R.T
    z = np.maximum(cam[:, 2], 1e-6)
    fpx = (hpx / 2.0) / math.tan(math.radians(fov_deg) / 2.0)
    sx = wpx / 2.0 + fpx * cam[:, 0] / z
    sy = hpx / 2.0 - fpx * cam[:, 1] / z
    return np.column_stack([sx, sy]), z


def _homography(src, dst):
    A = []
    for (x, y), (u, v) in zip(src, dst):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    A = np.asarray(A, float)
    _, _, Vt = np.linalg.svd(A)
    return Vt[-1].reshape(3, 3)


def _warp_face(canvas: Image.Image, tex: Image.Image, quad) -> None:
    w, h = tex.size
    src = np.array([[0, 0], [w, 0], [w, h], [0, h]], float)
    Hm = _homography(src, np.asarray(quad, float))
    try:
        Hi = np.linalg.inv(Hm)
    except np.linalg.LinAlgError:
        return
    xs = [p[0] for p in quad]
    ys = [p[1] for p in quad]
    x0 = int(math.floor(min(xs)))
    y0 = int(math.floor(min(ys)))
    x1 = int(math.ceil(max(xs)))
    y1 = int(math.ceil(max(ys)))
    if x1 <= x0 or y1 <= y0:
        return

    # координаты пикселя выходной картинки -> координаты полотна -> текстуры
    off = np.array([[1, 0, x0], [0, 1, y0], [0, 0, 1]], float)
    H = Hi @ off
    H = H / H[2, 2]
    coeffs = tuple(float(v) for v in H.flatten()[:8])

    try:
        warped = tex.convert("RGBA").transform(
            (x1 - x0, y1 - y0), Image.PERSPECTIVE, coeffs, resample=Image.BICUBIC)
    except (ValueError, ZeroDivisionError):
        return

    # безопасная вставка (при выходе за край полотна)
    dw, dh = canvas.size
    sx, sy = max(0, -x0), max(0, -y0)
    ex, ey = min(warped.width, dw - x0), min(warped.height, dh - y0)
    if ex <= sx or ey <= sy:
        return
    if (sx, sy, ex, ey) != (0, 0, warped.width, warped.height):
        warped = warped.crop((sx, sy, ex, ey))
    canvas.alpha_composite(warped, (x0 + sx, y0 + sy))


def render_preview(net: Net, art: ArtBuilder, out_path: str,
                   size=(1600, 1200)) -> None:
    W, D, H = net.W, net.D, net.H
    wpx, hpx = size
    ss = 2
    canvas = Image.new("RGBA", (wpx * ss, hpx * ss), (0, 0, 0, 0))

    # камера смотрит внутрь коробки с открытой стороны, чуть сверху и сбоку;
    # расстояние зависит и от ширины, и от глубины — иначе у глубоких коробок
    # камера оказывается почти вплотную и пол «съедает» кадр
    dist = max(1.25 * W, 1.10 * D)
    eye = (W * 0.46, D + dist, H * 0.72)
    target = (W * 0.5, D * 0.0, H * 0.44)
    R, e = _look_at(eye, target)

    # масштаб подбираем так, чтобы коробка целиком влезла в кадр
    # (координаты — как у камеры: x — ширина, y — глубина, z — высота)
    corners3 = [(x, d, h) for x in (0, W) for d in (0, D) for h in (0, H)]
    c = (np.asarray(corners3, float) - e) @ R.T
    zz = np.maximum(c[:, 2], 1e-6)
    lim = []
    for i in range(len(c)):
        for k, size_px in ((0, wpx * ss), (1, hpx * ss)):
            if abs(c[i, k]) > 1e-9:
                lim.append((size_px / 2.0) * zz[i] / abs(c[i, k]))
    fpx = 0.88 * min(lim) if lim else hpx * ss * 0.5

    def proj(pts):
        cc = (np.asarray(pts, float) - e) @ R.T
        z = np.maximum(cc[:, 2], 1e-6)
        sx = wpx * ss / 2.0 - fpx * cc[:, 0] / z
        sy = hpx * ss / 2.0 - fpx * cc[:, 1] / z
        return np.column_stack([sx, sy])

    box = art.fill == "box" and art.src is not None
    sizes = {"back": (W, H), "left": (H, D), "right": (H, D),
             "floor": (W, D), "top": (W, D)}

    def tex_of(name):
        if box:
            w_mm, h_mm = sizes[name]
            return art.panel(name, w_mm, h_mm, net)
        if name == "back":
            return art.back(W, H)
        if name in ("left", "right"):
            return art.side(name, H, D, W, H)
        if name == "top":
            return art.canopy(W, D)
        return art.floor(W, D, W, H)

    # 3D-углы (u=0,v=0 — левый верхний угол текстуры).
    # ВАЖНО: точки записаны как (x, глубина, высота). Развёртка зеркалит ось X
    # (см. ArtBuilder._panel_quad), поэтому u=0 — это сторона x=W.
    faces = [
        ("back", [(0, 0, H), (W, 0, H), (W, 0, 0), (0, 0, 0)]),
        ("left", [(0, 0, H), (0, 0, 0), (0, D, 0), (0, D, H)]),
        ("right", [(W, 0, 0), (W, 0, H), (W, D, H), (W, D, 0)]),
        ("floor", [(0, 0, 0), (W, 0, 0), (W, D, 0), (0, D, 0)]),
    ]
    if net.C:
        faces.append(("top", [(0, D, H), (W, D, H), (W, 0, H), (0, 0, H)]))

    for name, quad3 in faces:
        _warp_face(canvas, tex_of(name), proj(quad3))

    # каркас коробки — чтобы читалось «внутри коробки»
    dr = ImageDraw.Draw(canvas)
    pts = [(x, y, z) for z in (0, H) for y in (0, D) for x in (0, W)]
    idx = {(0, 0, 0): 0, (W, 0, 0): 1, (0, D, 0): 2, (W, D, 0): 3,
           (0, 0, H): 4, (W, 0, H): 5, (0, D, H): 6, (W, D, H): 7}
    edges = [(0, 1), (1, 3), (3, 2), (2, 0),
             (4, 5), (5, 7), (7, 6), (6, 4),
             (0, 4), (1, 5), (2, 6), (3, 7)]
    qb = proj(pts)
    for a, b in edges:
        dr.line([tuple(qb[a]), tuple(qb[b])], fill=(255, 255, 255, 30), width=2)

    # тонкие рёбра вкладыша
    for _, quad3 in faces:
        q = proj(quad3)
        pp = [tuple(p) for p in q]
        dr.line(pp + [pp[0]], fill=(255, 255, 255, 60), width=3)

    canvas = canvas.resize((wpx, hpx), Image.LANCZOS)

    # фон + мягкая тень
    bg = Image.new("RGBA", (wpx, hpx), (24, 25, 28, 255))
    glow = Image.new("RGBA", (wpx, hpx), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([wpx * 0.12, hpx * 0.55, wpx * 0.88, hpx * 1.1],
               fill=(70, 74, 84, 90))
    glow = glow.filter(ImageFilter.GaussianBlur(hpx * 0.08))
    bg.alpha_composite(glow)
    bg.alpha_composite(canvas)
    bg.convert("RGB").save(out_path, quality=95)


# ----------------------------------------------------------------------------
# Демо-рисунок (если картинки нет)
# ----------------------------------------------------------------------------

def make_demo_art(w=1800, h=1350) -> Image.Image:
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    horizon = 0.62
    sky_top = np.array([32, 74, 128], np.float32)
    sky_bot = np.array([246, 186, 128], np.float32)
    t = np.clip(y / horizon, 0, 1)
    sky = sky_top[None, None, :] * (1 - t[..., None]) + sky_bot[None, None, :] * t[..., None]
    arr = np.repeat(sky, w, axis=1)

    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    # солнце
    cx, cy, r = w * 0.66, h * horizon * 0.62, h * 0.075
    d = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
    sun = np.clip(1.0 - d / (r * 2.4), 0, 1) ** 2
    arr = arr + sun[..., None] * np.array([255, 226, 168], np.float32) * 0.75

    # горы (3 слоя)
    rng = np.random.default_rng(7)
    for i, (base, amp, col) in enumerate([
            (0.60, 0.13, (96, 108, 132)),
            (0.66, 0.10, (68, 82, 104)),
            (0.73, 0.07, (44, 56, 72))]):
        d2 = np.zeros(w, np.float32)
        for k in range(4):
            fr = rng.uniform(0.6, 2.4) * (k + 1) * 0.5
            ph = rng.uniform(0, 6.28)
            d2 += np.sin(np.linspace(ph, ph + fr * 6.28, w, dtype=np.float32)) / (k + 2)
        d2 = d2 / np.abs(d2).max()
        line = (base - amp * (0.5 + 0.5 * d2)) * h
        mask = yy > line[None, :]
        arr = np.where(mask[..., None], np.array(col, np.float32)[None, None, :], arr)

    # земля
    ground = yy > h * 0.74
    gcol = np.array([36, 42, 38], np.float32)[None, None, :]
    gvar = (np.sin(xx * 0.01) * 4 + rng.normal(0, 3, (h, w)))[..., None]
    arr = np.where(ground[..., None], gcol + gvar, arr)

    # деревья по кромке
    for _ in range(140):
        tx = rng.uniform(0, w)
        th_ = rng.uniform(h * 0.05, h * 0.16)
        base_y = h * 0.745 + rng.uniform(-h * 0.02, h * 0.02)
        tri = np.array([[tx, base_y - th_], [tx - th_ * 0.28, base_y],
                        [tx + th_ * 0.28, base_y]], np.float32)
        m = Image.new("L", (w, h), 0)
        ImageDraw.Draw(m).polygon([tuple(p) for p in tri], fill=255)
        arr = np.where(np.asarray(m)[..., None] > 0,
                       np.array([18, 22, 20], np.float32)[None, None, :], arr)

    return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------

def parse_box(s: str) -> Tuple[float, float, float]:
    for sep in ("x", "х", "×", "*", ","):
        if sep in s:
            parts = [p for p in s.replace(sep, " ").split() if p]
            if len(parts) == 3:
                return tuple(float(p) for p in parts)  # type: ignore
    raise argparse.ArgumentTypeError("формат: ШИРИНАxГЛУБИНАxВЫСОТА, например 200x150x100")


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(
        description="Генератор развёртки вкладыша-диорамы в коробку",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter)
    ap.add_argument("--box", type=parse_box, default=(200.0, 150.0, 100.0),
                    help="внутренние размеры коробки ШxГxВ, мм")
    ap.add_argument("--art", help="файл с рисунком (jpg/png/webp)")
    ap.add_argument("--demo", action="store_true", help="сгенерировать демо-рисунок")
    ap.add_argument("--out", default="out/diorama", help="префикс выходных файлов")
    ap.add_argument("--dpi", type=float, default=300.0)
    ap.add_argument("--fit", type=float, default=0.5,
                    help="зазор с каждой стороны для свободной посадки в коробку, мм")
    ap.add_argument("--wall-h", type=float, default=None,
                    help="высота стенок, мм (по умолчанию высота коробки минус 2)")
    ap.add_argument("--tab", type=float, default=12.0, help="глубина клеевого клапана, мм")
    ap.add_argument("--bleed", type=float, default=3.0, help="вылет под рез, мм")
    ap.add_argument("--margin", type=float, default=12.0, help="поле листа, мм")
    ap.add_argument("--side", choices=["wrap", "blur", "solid", "none"], default="wrap",
                    help="как заполнять боковины")
    ap.add_argument("--floor-mode", dest="floor_mode",
                    choices=["blur", "solid", "none"], default="blur",
                    help="как заполнять пол")
    ap.add_argument("--art-mode", dest="art_mode", choices=["cover", "contain"],
                    default="cover", help="как вписывать рисунок в задник")
    ap.add_argument("--fill", choices=["box", "flat"], default="box",
                    help="box — картинка уходит внутрь коробки на все панели; "
                         "flat — только задник, остальное из его краёв")
    ap.add_argument("--depth-k", dest="depth_k", type=float, default=1.8,
                    help="насколько далеко «камера» от коробки при раскладке box")
    ap.add_argument("--no-ceiling", action="store_true",
                    help="не печатать потолок (вкладыш будет открыт сверху)")
    ap.add_argument("--blank", action="store_true",
                    help="пустая развёртка: только контур, сгибы и клапаны — "
                         "для примерки без расхода краски")
    ap.add_argument("--layout", choices=["auto", "cross", "back"], default="auto",
                    help="раскладка листа: auto — самая компактная, "
                         "cross — боковины на полу, back — боковины на заднике")
    ap.add_argument("--focus", default="0.5,0.5",
                    help="точка кадрирования рисунка по X,Y (0..1)")
    ap.add_argument("--paper", default="auto",
                    choices=["auto", "none", "a1", "a2", "a3", "a4", "letter", "legal"],
                    help="формат печати для PDF; auto — первый подходящий")
    ap.add_argument("--tile-margin", type=float, default=10.0, help="поле при печати листами, мм")
    ap.add_argument("--overlap", type=float, default=10.0, help="наложение листов, мм")
    ap.add_argument("--title", default="", help="подпись в штампе")
    ap.add_argument("--no-marks", action="store_true", help="без линий/подписей (только рисунок)")
    ap.add_argument("--labels", action="store_true",
                    help="подписать панели прямо на рисунке (для пробной печати)")
    ap.add_argument("--no-preview", action="store_true", help="не делать превью диорамы")
    args = ap.parse_args(argv)

    bw, bd, bh = args.box
    # стенки почти во всю высоту коробки: 2 мм оставляем на толщину картона и
    # на то, чтобы потолок вкладыша ушёл под верхние клапаны коробки
    wall_h = args.wall_h if args.wall_h is not None else max(20.0, bh - 2.0)
    nw, nd = bw - 2 * args.fit, bd - 2 * args.fit
    layout = args.layout
    if layout == "auto":
        layout = pick_layout(nw, nd, wall_h, args.tab, not args.no_ceiling)
    net = Net(W=nw, D=nd, H=wall_h, T=args.tab,
              C=not args.no_ceiling, layout=layout)

    # --- рисунок ---
    src = None
    if args.art:
        if not os.path.exists(args.art):
            print(f"[!] файл не найден: {args.art}", file=sys.stderr)
            return 2
        src = ImageOps.exif_transpose(Image.open(args.art)).convert("RGB")
    elif args.demo:
        src = make_demo_art()
    elif not args.blank:
        print("[i] рисунок не задан — панели будут с серой заглушкой")

    fx, fy = [float(v) for v in args.focus.split(",")]
    art = ArtBuilder(src, args.dpi / MM_INCH, side_mode=args.side,
                     floor_mode=args.floor_mode, focus=(fx, fy),
                     art_mode=args.art_mode, fill=args.fill,
                     depth_k=args.depth_k)

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    base = os.path.basename(out)

    title = args.title or "Вкладыш-диорама"
    if args.blank:
        subtitle = "пустая развёртка — только линии реза и сгиба"
    else:
        layout_txt = "" if net.layout == "cross" else " · боковины на заднике"
        subtitle = (f"задник + 2 боковины + пол" + (" + потолок" if net.C else "")
                    + f" · стенки {net.H:.0f} мм{layout_txt}")

    sheet = render_sheet(net, art, args.dpi, args.margin, args.bleed,
                         marks=not args.no_marks, labels=args.labels,
                         title=title, subtitle=subtitle, box_mm=(bw, bd, bh),
                         blank=args.blank)

    png_path = f"{out}_sheet.png"
    pdf_path = f"{out}_sheet.pdf"
    prev_path = f"{out}_assembled.png"

    sheet.image.save(png_path, dpi=(args.dpi, args.dpi))
    info = save_pdf(sheet.image, pdf_path, sheet.width_mm, sheet.height_mm,
                    args.dpi, paper=args.paper, margin_mm=args.tile_margin,
                    overlap_mm=args.overlap)

    if not args.no_preview and src is not None and not args.blank:
        art_pv = ArtBuilder(src, 300.0 / MM_INCH, side_mode=args.side,
                            floor_mode=args.floor_mode, focus=(fx, fy),
                            art_mode=args.art_mode, fill=args.fill,
                            depth_k=args.depth_k)
        render_preview(net, art_pv, prev_path)

    # --- отчёт ---
    print(f"коробка      : {bw:.0f} x {bd:.0f} x {bh:.0f} мм (внутри)")
    print(f"вкладыш      : {net.W:.0f} x {net.D:.0f} мм, стенки {net.H:.0f} мм")
    print(f"лист         : {sheet.width_mm:.0f} x {sheet.height_mm:.0f} мм @ {args.dpi:.0f} dpi")
    print(f"PNG          : {png_path}")
    pages = info["pages"]
    paper = (info["paper"] or "").upper()
    tail = f", {paper}" if paper else ""
    if pages > 1:
        tail += f", тайлы {info['tiles'][0]}x{info['tiles'][1]}, наложение {args.overlap:.0f} мм"
    print(f"PDF          : {pdf_path}  ({pages} стр.{tail})")
    if not info.get("fits", True) and args.paper == "auto":
        print(f"               выкройка больше A3 — PDF разложен на листы; "
              f"для одного листа: --paper a2 (или печать PNG в типографии)")
    if os.path.exists(prev_path):
        print(f"превью       : {prev_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
