#!/usr/bin/env python3
"""Generate the Tail MCP desktop app source icon (1024x1024).

Run `cargo tauri icon icons-src/icon-source.png` from desktop-app/ after
regenerating this to produce the full platform icon set under src-tauri/icons/.
"""
import math
import os

from PIL import Image, ImageDraw

SIZE = 1024
BLUE = (66, 133, 244, 255)  # same brand blue as the browser extension icons
OUT = os.path.join(os.path.dirname(__file__), "icon-source.png")


def make_icon() -> Image.Image:
    img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    radius = int(SIZE * 0.22)
    draw.rounded_rectangle([0, 0, SIZE - 1, SIZE - 1], radius=radius, fill=BLUE)

    # White "tail" glyph: a circular head plus a tapering comet-tail sweep.
    cx, cy = SIZE * 0.60, SIZE * 0.40
    head_r = SIZE * 0.16
    draw.ellipse([cx - head_r, cy - head_r, cx + head_r, cy + head_r], fill=(255, 255, 255, 255))

    steps = 40
    start_angle = math.radians(200)
    end_angle = math.radians(70)
    path_r = SIZE * 0.30
    for i in range(steps):
        t = i / (steps - 1)
        angle = start_angle + (end_angle - start_angle) * t
        px = cx + math.cos(angle) * path_r * (0.4 + 0.9 * t)
        py = cy + math.sin(angle) * path_r * (0.4 + 0.9 * t) + SIZE * 0.05
        r = head_r * (1.0 - 0.88 * t)
        if r <= 1:
            continue
        draw.ellipse([px - r, py - r, px + r, py + r], fill=(255, 255, 255, 255))

    return img


if __name__ == "__main__":
    make_icon().save(OUT)
    print(f"Wrote {OUT}")
