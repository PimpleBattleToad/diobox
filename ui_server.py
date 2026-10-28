# -*- coding: utf-8 -*-
"""Локальная страница выбора: размеры коробки + своя картинка.

Запуск (обычно через gen.cmd без параметров):

    python ui_server.py            открыть страницу в браузере
    python ui_server.py --no-open  просто поднять сервер
    python ui_server.py --host 0.0.0.0 --port 8765   доступ с телефона в Wi-Fi

Всё считается тем же кодом, что и в командной строке (insert_generator.py):
страница только собирает параметры и показывает результат.
"""
from __future__ import annotations

import base64
import io
import json
import math
import os
import re
import socket
import sys
import threading
import time
import traceback
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import numpy as np
from PIL import Image, ImageOps

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)

import insert_generator as gen  # noqa: E402

OUT_ROOT = os.path.join(HERE, "out", "web")
HTML_PATH = os.path.join(HERE, "ui.html")
MAX_BODY = 64 * 1024 * 1024

JOB_RE = re.compile(r"^\d{8}-\d{6}-[0-9a-z]{4}$")
FILE_RE = re.compile(r"^(sheet\.png|sheet\.pdf|assembled\.png|sheet_preview\.png|art\.(?:jpg|png))$")

SIDES = ("wrap", "blur", "solid", "none")
FLOORS = ("blur", "solid", "none")
ART_MODES = ("cover", "contain")
FILLS = ("box", "flat")
PAPERS = ("auto", "none", "a1", "a2", "a3", "a4", "letter", "legal")
DPIS = (150, 200, 300, 400, 600)

GEN_LOCK = threading.Lock()
DEMO_CACHE: dict = {}
DEMO_LOCK = threading.RLock()

# демо-пейзаж рисуется ~12 с, поэтому держим его на диске между запусками
DEMO_DIR = os.path.join(OUT_ROOT, "_demo")
DEMO_ART_PATH = os.path.join(DEMO_DIR, "art.png")
DEMO_THUMB_PATH = os.path.join(DEMO_DIR, "thumb.jpg")


# ---------------------------------------------------------------------------
# параметры
# ---------------------------------------------------------------------------

class ParamError(ValueError):
    pass


def _plural(n: int, one: str, few: str, many: str) -> str:
    n = abs(int(n))
    if n % 10 == 1 and n % 100 != 11:
        return one
    if 2 <= n % 10 <= 4 and not 12 <= n % 100 <= 14:
        return few
    return many


def _num(data, key, default, lo, hi, name):
    try:
        v = float(data.get(key, default))
    except (TypeError, ValueError):
        raise ParamError(f"{name}: нужно число")
    if not np.isfinite(v):
        raise ParamError(f"{name}: нужно число")
    if v < lo or v > hi:
        raise ParamError(f"{name}: допустимо от {lo:g} до {hi:g}")
    return v


def _flag(data, key, default=False):
    """Флаг приходит либо настоящим bool (JSON), либо строкой из query-строки."""
    v = data.get(key, default)
    if isinstance(v, str):
        return v.strip().lower() not in ("", "0", "false", "no", "off")
    return bool(v)


def parse_params(data: dict) -> dict:
    p = {
        "bw": _num(data, "w", 200, 30, 2000, "Ширина"),
        "bd": _num(data, "d", 150, 30, 2000, "Глубина"),
        "bh": _num(data, "h", 100, 20, 2000, "Высота"),
        "fit": _num(data, "fit", 0.5, 0.0, 10.0, "Зазор"),
        "tab": _num(data, "tab", 12, 0.0, 60.0, "Клапаны"),
        "bleed": _num(data, "bleed", 3, 0.0, 20.0, "Вылет"),
        "margin": _num(data, "margin", 12, 0.0, 40.0, "Поле листа"),
        "dpi": _num(data, "dpi", 300, 72, 900, "Разрешение"),
        "focus": data.get("focus") or [0.5, 0.5],
        "side": str(data.get("side", "wrap")),
        "floor": str(data.get("floor", "blur")),
        "art_mode": str(data.get("art_mode", "cover")),
        "paper": str(data.get("paper", "auto")),
        "labels": _flag(data, "labels"),
        "marks": not _flag(data, "no_marks"),
        "ceiling": not _flag(data, "no_ceiling"),
        "fill": str(data.get("fill", "box")),
        "layout": str(data.get("layout", "auto")),
        "blank": _flag(data, "blank"),
        "demo": _flag(data, "demo"),
    }
    try:
        fx, fy = (float(p["focus"][0]), float(p["focus"][1]))
    except (TypeError, ValueError, IndexError):
        raise ParamError("Кадрирование: нужно два числа")
    p["focus"] = (min(1.0, max(0.0, fx)), min(1.0, max(0.0, fy)))

    if p["side"] not in SIDES:
        raise ParamError("Боковины: недопустимый вариант")
    if p["floor"] not in FLOORS:
        raise ParamError("Пол: недопустимый вариант")
    if p["art_mode"] not in ART_MODES:
        raise ParamError("Вписывание: недопустимый вариант")
    if p["fill"] not in FILLS:
        raise ParamError("Раскладка: недопустимый вариант")
    if p["layout"] not in ("auto", "cross", "back"):
        raise ParamError("Раскладка листа: недопустимый вариант")
    if p["paper"] not in PAPERS:
        raise ParamError("Бумага: недопустимый формат")
    if p["bw"] - 2 * p["fit"] < 20 or p["bd"] - 2 * p["fit"] < 20:
        raise ParamError("Коробка слишком мала для такого зазора")
    return p


def net_of(p: dict) -> "gen.Net":
    # 2 мм на толщину картона и на то, чтобы потолок ушёл под клапаны коробки
    wall_h = max(20.0, p["bh"] - 2.0)
    nw, nd = p["bw"] - 2 * p["fit"], p["bd"] - 2 * p["fit"]
    layout = p["layout"]
    if layout == "auto":
        layout = gen.pick_layout(nw, nd, wall_h, p["tab"], p["ceiling"])
    return gen.Net(W=nw, D=nd, H=wall_h, T=p["tab"], C=p["ceiling"],
                   layout=layout)


def geometry(p: dict) -> dict:
    net = net_of(p)
    bx0, by0, bx1, by1 = net.bbox()
    width_mm = (bx1 - bx0) + 2 * p["margin"]
    height_mm = (by1 - by0) + 2 * p["margin"] + (18.0 if p["marks"] else 0.0)
    ppm = p["dpi"] / gen.MM_INCH
    if p["paper"] == "none":
        pname, pw, ph, fits = None, width_mm, height_mm, True
    else:
        pname, pw, ph, fits = gen._choose_paper(width_mm, height_mm, 10.0, p["paper"])

    pages = 1
    tiles = [1, 1]
    if pname and not fits:
        tw = pw - 2 * 10.0
        th = ph - 2 * 10.0
        ncols = max(1, math.ceil((width_mm - 10.0) / max(1.0, tw - 10.0)))
        nrows = max(1, math.ceil((height_mm - 10.0) / max(1.0, th - 10.0)))
        tiles = [ncols, nrows]
        pages = ncols * nrows

    alt_paper = None
    if p["paper"] == "auto" and not fits:
        for cand in ("a3", "a2", "a1"):
            cw, ch = gen.PAPERS[cand]
            if (width_mm <= cw and height_mm <= ch) or (width_mm <= ch and height_mm <= cw):
                alt_paper = cand
                break

    return {
        "net": {"W": round(net.W, 1), "D": round(net.D, 1), "H": round(net.H, 1)},
        "layout": net.layout,
        "sheet": {"w": round(width_mm, 1), "h": round(height_mm, 1),
                  "px": [int(round(width_mm * ppm)), int(round(height_mm * ppm))]},
        "paper": pname,
        "paper_mm": [pw, ph] if pname else None,
        "fits": fits,
        "pages": pages,
        "tiles": tiles,
        "alt_paper": alt_paper,
        "a4_fits": width_mm <= 210 and height_mm <= 297,
    }


# ---------------------------------------------------------------------------
# картинки
# ---------------------------------------------------------------------------

def decode_image(data_url: str) -> Image.Image:
    if not isinstance(data_url, str) or "," not in data_url:
        raise ParamError("Картинка не распознана")
    head, b64 = data_url.split(",", 1)
    if "base64" not in head:
        raise ParamError("Картинка не распознана")
    try:
        raw = base64.b64decode(b64, validate=False)
    except Exception:
        raise ParamError("Картинка повреждена")
    if not raw:
        raise ParamError("Пустой файл картинки")
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception:
        raise ParamError("Это не картинка (нужен JPG, PNG или WEBP)")
    im = ImageOps.exif_transpose(im)
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    # страховка от гигантских файлов: 12000 px по длинной стороне
    if max(im.size) > 12000:
        k = 12000 / max(im.size)
        im = im.resize((max(1, int(im.width * k)), max(1, int(im.height * k))),
                       Image.LANCZOS)
    return im


def demo_image() -> Image.Image:
    if "demo" in DEMO_CACHE:
        return DEMO_CACHE["demo"]
    with DEMO_LOCK:
        if "demo" in DEMO_CACHE:
            return DEMO_CACHE["demo"]
        im = None
        if os.path.isfile(DEMO_ART_PATH):
            try:
                im = Image.open(DEMO_ART_PATH)
                im.load()
                im = im.convert("RGB")
            except Exception:
                im = None
        if im is None:
            im = gen.make_demo_art()
            try:
                os.makedirs(DEMO_DIR, exist_ok=True)
                im.save(DEMO_ART_PATH)
            except OSError:
                pass
        DEMO_CACHE["demo"] = im
        return im


def demo_thumb() -> bytes:
    data = DEMO_CACHE.get("thumb")
    if data is not None:
        return data
    with DEMO_LOCK:
        data = DEMO_CACHE.get("thumb")
        if data is not None:
            return data
        if os.path.isfile(DEMO_THUMB_PATH):
            try:
                with open(DEMO_THUMB_PATH, "rb") as f:
                    data = f.read()
            except OSError:
                data = None
        if data is None:
            im = demo_image().copy()
            im.thumbnail((1400, 1400), Image.LANCZOS)
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=88)
            data = buf.getvalue()
            try:
                os.makedirs(DEMO_DIR, exist_ok=True)
                with open(DEMO_THUMB_PATH, "wb") as f:
                    f.write(data)
            except OSError:
                pass
        DEMO_CACHE["thumb"] = data
        return data


# ---------------------------------------------------------------------------
# сборка выкройки
# ---------------------------------------------------------------------------

def build(p: dict, src, job_dir: str) -> dict:
    t0 = time.time()
    net = net_of(p)
    dpi = p["dpi"]

    art = gen.ArtBuilder(src, dpi / gen.MM_INCH, side_mode=p["side"],
                         floor_mode=p["floor"], focus=p["focus"],
                         art_mode=p["art_mode"], fill=p["fill"])
    title = "Вкладыш-диорама"
    if p["blank"]:
        subtitle = "пустая развёртка — только линии реза и сгиба"
    else:
        ceiling_txt = " + потолок" if net.C else ""
        layout_txt = "" if net.layout == "cross" else " · боковины на заднике"
        subtitle = (f"задник + 2 боковины + пол{ceiling_txt}"
                    f" · стенки {net.H:.0f} мм{layout_txt}")
    sheet = gen.render_sheet(net, art, dpi, p["margin"], p["bleed"],
                             marks=p["marks"], labels=p["labels"],
                             title=title, subtitle=subtitle,
                             box_mm=(p["bw"], p["bd"], p["bh"]),
                             blank=p["blank"])

    png_path = os.path.join(job_dir, "sheet.png")
    pdf_path = os.path.join(job_dir, "sheet.pdf")
    prev_path = os.path.join(job_dir, "assembled.png")
    thumb_path = os.path.join(job_dir, "sheet_preview.png")

    sheet.image.save(png_path, dpi=(dpi, dpi))
    info = gen.save_pdf(sheet.image, pdf_path, sheet.width_mm, sheet.height_mm,
                        dpi, paper=p["paper"], margin_mm=10.0, overlap_mm=10.0)

    # превью листа поменьше — чтобы страница не жевала 7000 px
    th = sheet.image.copy()
    th.thumbnail((1500, 1500), Image.LANCZOS)
    th.save(thumb_path, quality=90)

    if src is not None and not p["blank"]:
        art_pv = gen.ArtBuilder(src, 300.0 / gen.MM_INCH, side_mode=p["side"],
                                floor_mode=p["floor"], focus=p["focus"],
                                art_mode=p["art_mode"], fill=p["fill"])
        gen.render_preview(net, art_pv, prev_path)

    report = [
        f"коробка: {p['bw']:.0f} × {p['bd']:.0f} × {p['bh']:.0f} мм (внутри)",
        f"вкладыш: {net.W:.0f} × {net.D:.0f} мм, стенки {net.H:.0f} мм",
        f"лист: {sheet.width_mm:.0f} × {sheet.height_mm:.0f} мм @ {dpi:.0f} dpi",
    ]
    if p["layout"] == "auto":
        report.append("раскладка: боковины на заднике (компактнее)" if net.layout == "back"
                      else "раскладка: боковины на полу")
    if p["blank"]:
        report.append("пустая развёртка — только контур, сгибы и клапаны")
    if p["paper"] != "none":
        paper = (info.get("paper") or "").upper()
        pages = info.get("pages", 1)
        tail = f" · {paper}" if paper else ""
        if pages > 1:
            tail += f" · {pages} {_plural(pages, 'лист', 'листа', 'листов')}, наложение 10 мм"
        report.append(f"PDF: {pages} стр.{tail}")
    report.append(f"готово за {time.time() - t0:.1f} с")

    return {
        "sheet_png": "sheet.png",
        "sheet_pdf": "sheet.pdf",
        "sheet_preview": "sheet_preview.png",
        "assembled": "assembled.png" if os.path.exists(prev_path) else None,
        "sheet_mm": [round(sheet.width_mm, 1), round(sheet.height_mm, 1)],
        "sheet_px": list(sheet.image.size),
        "dpi": dpi,
        "paper": info.get("paper"),
        "pages": info.get("pages", 1),
        "report": report,
    }


# ---------------------------------------------------------------------------
# сервер
# ---------------------------------------------------------------------------

class Handler(BaseHTTPRequestHandler):
    server_version = "DioboxUI/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # тише в консоли
        if os.environ.get("DIOBOX_DEBUG"):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    # -- helpers ------------------------------------------------------------
    def _send(self, code: int, body: bytes, ctype: str, extra=None):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _err(self, msg, code=400):
        self._json({"ok": False, "error": msg}, code)

    def _read_json(self):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise ParamError("Плохой запрос")
        if n <= 0:
            raise ParamError("Пустой запрос")
        if n > MAX_BODY:
            raise ParamError(f"Картинка слишком большая (больше {MAX_BODY // (1024 * 1024)} МБ)")
        raw = self.rfile.read(n)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            raise ParamError("Плохой запрос")

    # -- GET ----------------------------------------------------------------
    def do_GET(self):
        try:
            u = urlparse(self.path)
            path = u.path
            if path in ("/", "/index.html"):
                return self._serve_html()
            if path == "/demo.png":
                return self._serve_demo()
            if path == "/api/geometry":
                return self._geometry(u.query)
            if path.startswith("/files/"):
                return self._serve_file(path[len("/files/"):])
            if path == "/favicon.ico":
                return self._send(204, b"", "image/x-icon")
            return self._err("Не найдено", 404)
        except Exception:
            traceback.print_exc()
            return self._err("Внутренняя ошибка", 500)

    def _serve_html(self):
        try:
            with open(HTML_PATH, "rb") as f:
                body = f.read()
        except OSError:
            return self._err("Не найден ui.html рядом с ui_server.py", 500)
        self._send(200, body, "text/html; charset=utf-8")

    def _serve_demo(self):
        self._send(200, demo_thumb(), "image/jpeg")

    def _geometry(self, query: str):
        q = {k: v[0] for k, v in parse_qs(query).items()}
        try:
            p = parse_params(q)
            return self._json({"ok": True, **geometry(p)})
        except ParamError as e:
            return self._json({"ok": False, "error": str(e)}, 400)

    def _serve_file(self, rest: str):
        parts = rest.split("/")
        if len(parts) != 2:
            return self._err("Не найдено", 404)
        job, name = parts
        if not JOB_RE.match(job) or not FILE_RE.match(name):
            return self._err("Не найдено", 404)
        full = os.path.join(OUT_ROOT, job, name)
        if not os.path.isfile(full):
            return self._err("Не найдено", 404)
        ctype = {"png": "image/png", "pdf": "application/pdf",
                 "jpg": "image/jpeg"}.get(name.rsplit(".", 1)[-1], "application/octet-stream")
        with open(full, "rb") as f:
            body = f.read()
        self._send(200, body, ctype)

    # -- POST ---------------------------------------------------------------
    def do_POST(self):
        try:
            path = urlparse(self.path).path
            if path == "/api/generate":
                return self._generate()
            if path == "/api/open-folder":
                return self._open_folder()
            return self._err("Не найдено", 404)
        except ParamError as e:
            return self._err(str(e), 400)
        except Exception:
            traceback.print_exc()
            return self._err("Не получилось собрать выкройку — подробности в консоли", 500)

    def _generate(self):
        data = self._read_json()
        p = parse_params(data)
        src = None
        if p["demo"]:
            src = demo_image()
        elif data.get("image"):
            src = decode_image(data["image"])

        job = time.strftime("%Y%m%d-%H%M%S") + "-" + os.urandom(2).hex()
        job_dir = os.path.join(OUT_ROOT, job)
        os.makedirs(job_dir, exist_ok=True)

        if src is not None:
            small = src.copy()
            small.thumbnail((1800, 1800), Image.LANCZOS)
            small.save(os.path.join(job_dir, "art.jpg"), quality=88)

        with GEN_LOCK:
            info = build(p, src, job_dir)
        base = f"/files/{job}/"
        info.update({
            "ok": True,
            "job": job,
            "urls": {
                "png": base + info["sheet_png"],
                "pdf": base + info["sheet_pdf"],
                "preview": base + info["sheet_preview"],
                "assembled": base + info["assembled"] if info["assembled"] else None,
            },
            "geo": geometry(p),
        })
        print(f"[{time.strftime('%H:%M:%S')}] {p['bw']:.0f}x{p['bd']:.0f}x{p['bh']:.0f} mm -> {job}")
        self._json(info)

    def _open_folder(self):
        data = self._read_json()
        job = str(data.get("job", ""))
        if not JOB_RE.match(job):
            raise ParamError("Неизвестная папка")
        d = os.path.join(OUT_ROOT, job)
        if not os.path.isdir(d):
            raise ParamError("Папка не найдена")
        try:
            os.startfile(d)  # type: ignore[attr-defined]
        except Exception as e:
            raise ParamError(f"Проводник не открылся: {e}")
        self._json({"ok": True})


def prune_jobs(keep: int = 60) -> None:
    """Старые выкройки не копим бесконечно: оставляем последние keep штук."""
    try:
        jobs = [d for d in os.listdir(OUT_ROOT)
                if JOB_RE.match(d) and os.path.isdir(os.path.join(OUT_ROOT, d))]
    except OSError:
        return
    if len(jobs) <= keep:
        return
    jobs.sort(key=lambda d: os.path.getmtime(os.path.join(OUT_ROOT, d)), reverse=True)
    for d in jobs[keep:]:
        path = os.path.join(OUT_ROOT, d)
        try:
            for name in os.listdir(path):
                try:
                    os.remove(os.path.join(path, name))
                except OSError:
                    pass
            os.rmdir(path)
        except OSError:
            pass


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return  # браузер закрыл вкладку/отменил загрузку — это норма
        super().handle_error(request, client_address)


def lan_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


def serve(host="127.0.0.1", port=8765, open_browser=True):
    try:  # консоль Windows иначе падает на «×» и «→»
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    os.makedirs(OUT_ROOT, exist_ok=True)
    prune_jobs()
    httpd = None
    last = None
    for cand in range(port, port + 25):
        try:
            httpd = Server((host, cand), Handler)
            httpd.daemon_threads = True
            port = cand
            break
        except OSError as e:
            last = e
    if httpd is None:
        print(f"[!] не удалось занять порт: {last}", file=sys.stderr)
        return 2

    shown = "127.0.0.1" if host in ("0.0.0.0", "", "::") else host
    url = f"http://{shown}:{port}/"
    print("Вкладыш-диорама — страница выбора размеров и картинки")
    print(f"  {url}")
    if host in ("0.0.0.0", "", "::"):
        print(f"  с телефона в Wi-Fi: http://{lan_ip()}:{port}/")
    print("  остановить: Ctrl+C или закрыть это окно")
    sys.stdout.flush()

    if open_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()

    def _warm():
        try:
            demo_thumb()
        except Exception:
            traceback.print_exc()

    threading.Thread(target=_warm, daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nостановлено")
    finally:
        httpd.server_close()
    return 0


def main(argv=None) -> int:
    import argparse
    ap = argparse.ArgumentParser(description="Страница выбора для вкладыша-диорамы")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--no-open", action="store_true", help="не открывать браузер")
    a = ap.parse_args(argv)
    return serve(a.host, a.port, open_browser=not a.no_open)


if __name__ == "__main__":
    raise SystemExit(main())
