#!/usr/bin/env python3
"""qq-bridge 图渲染器。

读 docs/arch/qq-bridge/diagrams/<view>.json，产出同目录的 <view>.png 与 <view>.html。
只读这一份源，不复制数据。换成 archify finalize 时删掉本文件。

用法：python docs/arch/qq-bridge/diagrams/render.py
"""
from __future__ import annotations

import base64
import io
import json
import math
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
FONTS = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
]
BG = (15, 23, 42)
FG = (226, 232, 240)
MUTED = (148, 163, 184)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for path in ([FONTS[1]] if bold else []) + [FONTS[0], FONTS[2]]:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def wrap(draw: ImageDraw.ImageDraw, text: str, f: ImageFont.FreeTypeFont, width: int) -> list[str]:
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur)
            cur = ""
            continue
        if draw.textlength(cur + ch, font=f) > width:
            lines.append(cur)
            cur = ch
        else:
            cur += ch
    if cur:
        lines.append(cur)
    return lines


def anchor(node: dict, dx: float, dy: float) -> tuple[float, float]:
    return (node["x"] + node["w"] / 2 + dx, node["y"] + node["h"] / 2 + dy)


def clip(node: dict, toward: tuple[float, float]) -> tuple[float, float]:
    """从节点中心朝 toward 方向射出，落在矩形边界上的点。"""
    cx, cy = node["x"] + node["w"] / 2, node["y"] + node["h"] / 2
    dx, dy = toward[0] - cx, toward[1] - cy
    if dx == 0 and dy == 0:
        return cx, cy
    sx = (node["w"] / 2) / abs(dx) if dx else math.inf
    sy = (node["h"] / 2) / abs(dy) if dy else math.inf
    s = min(sx, sy)
    return cx + dx * s, cy + dy * s


def arrow(draw, start, end, color, style: str) -> None:
    total = math.dist(start, end)
    if total == 0:
        return
    ux, uy = (end[0] - start[0]) / total, (end[1] - start[1]) / total
    dash = {"solid": None, "dashed": 10, "dotted": 4}[style]
    if dash is None:
        draw.line([start, end], fill=color, width=2)
    else:
        step = dash + (4 if dash == 10 else 3)
        pos = 0.0
        while pos < total - 6:
            seg = min(dash, total - 6 - pos)
            draw.line(
                [(start[0] + ux * pos, start[1] + uy * pos),
                 (start[0] + ux * (pos + seg), start[1] + uy * (pos + seg))],
                fill=color, width=2,
            )
            pos += step
    head = 12
    left = (end[0] - head * ux + head * 0.5 * -uy, end[1] - head * uy + head * 0.5 * ux)
    right = (end[0] - head * ux - head * 0.5 * -uy, end[1] - head * uy - head * 0.5 * ux)
    draw.polygon([end, left, right], fill=color)


def render(spec: dict) -> Image.Image:
    img = Image.new("RGB", (spec["width"], spec["height"]), BG)
    draw = ImageDraw.Draw(img)
    draw.text((32, 22), spec["title"], font=font(26, True), fill=FG)

    nodes = {n["id"]: n for n in spec["nodes"]}
    edges = spec.get("edges", [])
    pairs = {(e["from"], e["to"]) for e in edges}

    geo = []
    for e in edges:
        a, b = nodes[e["from"]], nodes[e["to"]]
        start = clip(a, anchor(b, 0, 0))
        end = clip(b, anchor(a, 0, 0))
        # 双向边各偏 12px，避免两条线重合
        if (e["to"], e["from"]) in pairs:
            total = math.dist(start, end) or 1
            ux, uy = (end[0] - start[0]) / total, (end[1] - start[1]) / total
            ox, oy = -uy * 12, ux * 12
            start = (start[0] + ox, start[1] + oy)
            end = (end[0] + ox, end[1] + oy)
        color = {"solid": (129, 140, 248), "dashed": (52, 211, 153), "dotted": (245, 158, 11)}[e["style"]]
        ratio = 0.5
        if (e["to"], e["from"]) in pairs:
            ratio = 0.34 if e["from"] < e["to"] else 0.66
        geo.append((start, end, color, e["style"], e.get("label", ""), ratio))

    for start, end, color, style, _, _ in geo:
        arrow(draw, start, end, color, style)

    for n in spec["nodes"]:
        draw.rounded_rectangle(
            [n["x"], n["y"], n["x"] + n["w"], n["y"] + n["h"]],
            radius=14, fill=n.get("fill", "#1e293b"), outline=n.get("stroke", "#64748b"), width=2,
        )
        pad = 14
        draw.text((n["x"] + pad, n["y"] + pad), n["label"], font=font(19, True), fill=FG)
        fs = font(13)
        y = n["y"] + pad + 30
        for line in wrap(draw, n.get("sub", ""), fs, n["w"] - 2 * pad)[:3]:
            draw.text((n["x"] + pad, y), line, font=fs, fill=MUTED)
            y += 19

    # 标签最后画，压在节点之上，不被方块盖住
    for start, end, _, _, label, ratio in geo:
        if not label:
            continue
        mx = start[0] + (end[0] - start[0]) * ratio
        my = start[1] + (end[1] - start[1]) * ratio
        f = font(14)
        tw = draw.textlength(label, font=f)
        draw.rounded_rectangle([mx - tw / 2 - 7, my - 13, mx + tw / 2 + 7, my + 13], radius=7, fill=(15, 23, 42))
        draw.text((mx - tw / 2, my - 10), label, font=f, fill=MUTED)
    return img


def html_for(spec: dict, png: bytes) -> str:
    rows = "".join(
        f"<tr><td>{n['id']}</td><td>{n['label']}</td><td>{n.get('sub','')}</td></tr>"
        for n in spec["nodes"]
    )
    edges = "".join(
        f"<tr><td>{e['from']} → {e['to']}</td><td>{e.get('label','')}</td><td>{e['style']}</td></tr>"
        for e in spec.get("edges", [])
    )
    b64 = base64.b64encode(png).decode()
    return f"""<!doctype html><meta charset="utf-8">
<title>{spec['title']}</title>
<style>
 body{{background:#0f172a;color:#e2e8f0;font:14px/1.5 "Microsoft YaHei",system-ui;margin:0;padding:28px}}
 h1{{font-size:20px;margin:0 0 16px}}
 img{{max-width:100%;border:1px solid #334155;border-radius:12px}}
 table{{border-collapse:collapse;margin:18px 0}}
 td,th{{border:1px solid #334155;padding:6px 10px;text-align:left;vertical-align:top}}
 th{{background:#1e293b}}
 code{{color:#94a3b8}}
</style>
<h1>{spec['title']}</h1>
<img alt="{spec['title']}" src="data:image/png;base64,{b64}">
<h2>节点</h2><table><tr><th>id</th><th>label</th><th>sub</th></tr>{rows}</table>
<h2>边</h2><table><tr><th>from → to</th><th>label</th><th>style</th></tr>{edges}</table>
<p><code>源：{spec.get('_source','')}</code></p>
"""


def main(argv: list[str]) -> int:
    views = [Path(a) for a in argv[1:]] or sorted(HERE.glob("*.json"))
    for src in views:
        spec = json.loads(src.read_text(encoding="utf-8-sig"))
        spec["_source"] = src.name
        img = render(spec)
        png = src.with_suffix(".png")
        img.save(png)
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        src.with_suffix(".html").write_text(html_for(spec, buf.getvalue()), encoding="utf-8")
        print(f"{src.name} -> {png.name} + {src.with_suffix('.html').name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
