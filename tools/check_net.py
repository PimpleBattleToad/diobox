"""Проверка геометрии развёртки: площадь контура == сумма площадей панелей."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import insert_generator as g


def shoelace(pts):
    a = 0.0
    for i in range(len(pts)):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % len(pts)]
        a += x1 * y2 - x2 * y1
    return abs(a) / 2.0


def main():
    ok_all = True
    for (W, D, H) in [(79, 39, 98), (199, 149, 98), (149, 129, 218), (139, 259, 118)]:
        for C in (True, False):
            for lay in ("cross", "back"):
                n = g.Net(W=W, D=D, H=H, T=12, C=C, layout=lay)
                pans = n.panels()
                area_sum = sum((x1 - x0) * (y1 - y0) for (x0, y0, x1, y1) in pans.values())
                area_out = shoelace(n.outline())
                x0, y0, x1, y1 = n.bbox()
                ok = abs(area_sum - area_out) < 1e-6
                ok_all = ok_all and ok
                print(
                    f"{W:.0f}x{D:.0f}x{H:.0f} C={int(C)} {lay:5s} "
                    f"площадь {area_sum:8.0f} vs {area_out:8.0f} "
                    f"{'ok' if ok else 'MISMATCH'}  лист {x1 - x0:.0f}x{y1 - y0:.0f}"
                )
    # клапаны не должны вылезать за bbox
    for (W, D, H) in [(79, 39, 98), (199, 149, 98)]:
        for lay in ("cross", "back"):
            n = g.Net(W=W, D=D, H=H, T=12, C=True, layout=lay)
            bx0, by0, bx1, by1 = n.bbox()
            for name, (x0, y0, x1, y1) in n.panels().items():
                assert x0 >= bx0 - 1e-6 and x1 <= bx1 + 1e-6, (name, "по X")
                assert y0 >= by0 - 1e-6 and y1 <= by1 + 1e-6, (name, "по Y")
    print("клапаны внутри bbox: ok")
    print("ИТОГ:", "ok" if ok_all else "есть расхождения")


if __name__ == "__main__":
    main()
