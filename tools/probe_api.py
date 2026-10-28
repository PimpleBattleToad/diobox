# -*- coding: utf-8 -*-
"""Проверка API: своя картинка (не демо), paper=none, 150 dpi."""
import base64
import io
import json
import os
import re
import urllib.request

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(HERE, "out", "shots", "03-advanced.png")
BASE = "http://127.0.0.1:8765"


def post(path, obj):
    req = urllib.request.Request(BASE + path, data=json.dumps(obj).encode("utf-8"),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read().decode("utf-8"))


with open(SRC, "rb") as f:
    raw = f.read()
data_url = "data:image/png;base64," + base64.b64encode(raw).decode("ascii")
print("картинка:", len(raw), "байт")

res = post("/api/generate", {
    "w": 180, "d": 120, "h": 90, "dpi": 150, "image": data_url,
    "paper": "none", "side": "blur", "floor": "blur", "art_mode": "cover",
    "focus": [0.25, 0.8], "labels": True,
})
print("ok:", res["ok"], "job:", res["job"])
print("sheet:", res["sheet_mm"], "px:", res["sheet_px"], "paper:", res["paper"], "pages:", res["pages"])
print("urls:", res["urls"])
for line in res["report"]:
    print("  ", line)

job_dir = os.path.join(HERE, "out", "web", res["job"])
pdf = open(os.path.join(job_dir, "sheet.pdf"), "rb").read()
print("pdf bytes:", len(pdf), "header:", pdf[:8])
print("страниц /Type /Page:", len(re.findall(rb"/Type\s*/Page[^s]", pdf)))
boxes = re.findall(rb"/MediaBox\s*\[\s*([\d.\s-]+)\]", pdf)
print("MediaBox:", boxes[:4])
sizes = [tuple(round(float(v), 1) for v in b.split()) for b in boxes[:1]]
for x0, y0, x1, y1 in sizes:
    print("  размер страницы, мм: %.1f x %.1f" % ((x1 - x0) / 72 * 25.4, (y1 - y0) / 72 * 25.4))
for name in sorted(os.listdir(job_dir)):
    print("  ", name, os.path.getsize(os.path.join(job_dir, name)))
