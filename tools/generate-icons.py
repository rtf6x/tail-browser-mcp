#!/usr/bin/env python3
"""Generate toolbar icons for the Chrome and Firefox extensions.

Draws the Tail MCP fox tail (tail-shape.svg) as a solid silhouette, one set per
connection state: body in the state colour, tip in a lighter tint of it.

Run manually (`npm run icons`); the PNGs are committed to both extension
directories, and no build step regenerates them. Needs `rsvg-convert`
(brew install librsvg) and Pillow.
"""
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
ROOTS = (
    os.path.join(REPO, "chrome-extension", "assets", "icons"),
    os.path.join(REPO, "firefox-extension", "assets", "icons"),
)
SHAPE = os.path.join(HERE, "tail-shape.svg")

# (body, tip)
COLORS = {
    "connected": ((255, 94, 0), (255, 196, 150)),
    "connecting": ((251, 188, 4), (255, 234, 158)),
    "disconnected": ((138, 138, 138), (206, 206, 206)),
}

BIG = 1024
TIP_Y = 270 / 512  # fraction of the shape where the lighter tip starts
SIZES = (16, 32, 48, 128)


def silhouette() -> Image.Image:
    """Filled tail mask: the SVG is an outline, so flood-fill the outside and invert."""
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        path = tmp.name
    subprocess.run(["rsvg-convert", "-w", str(BIG), "-h", str(BIG), SHAPE, "-o", path], check=True)
    img = Image.open(path).convert("RGB")
    os.unlink(path)
    marker = (255, 0, 255)
    ImageDraw.floodfill(img, (0, 0), marker, thresh=40)
    mask = Image.new("L", img.size, 0)
    px, mp = img.load(), mask.load()
    for y in range(img.height):
        for x in range(img.width):
            if px[x, y] != marker:
                mp[x, y] = 255
    # trim the light anti-aliased fringe the flood fill leaves at the edge
    return mask.filter(ImageFilter.MinFilter(5))


def render(mask: Image.Image, size: int, body, tip) -> Image.Image:
    bbox = mask.getbbox()
    crop = mask.crop(bbox)
    tip_start = int(BIG * TIP_Y) - bbox[1]

    layer = Image.new("RGBA", crop.size, body + (0,))
    body_img = Image.new("RGBA", crop.size, body + (255,))
    tip_img = Image.new("RGBA", crop.size, tip + (255,))
    fill = body_img.copy()
    fill.paste(tip_img.crop((0, tip_start, crop.width, crop.height)), (0, tip_start))
    layer = Image.composite(fill, layer, crop)

    pad = max(1, round(size * 0.06))
    inner = size - 2 * pad
    scale = min(inner / layer.width, inner / layer.height)
    w, h = max(1, round(layer.width * scale)), max(1, round(layer.height * scale))
    small = layer.resize((w, h), Image.LANCZOS)
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    out.paste(small, ((size - w) // 2, (size - h) // 2))  # no mask: keep RGBA as-is
    return out


def main() -> None:
    mask = silhouette()
    for root in ROOTS:
        os.makedirs(root, exist_ok=True)
        for name, (body, tip) in COLORS.items():
            for size in SIZES:
                render(mask, size, body, tip).save(os.path.join(root, f"{name}-{size}.png"))
        print(f"Wrote icons to {os.path.relpath(root, REPO)}")


if __name__ == "__main__":
    main()
