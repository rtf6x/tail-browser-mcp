#!/usr/bin/env python3
"""Generate toolbar icons for the Chrome extension."""
import os
import struct
import zlib

ROOT = os.path.join(os.path.dirname(__file__), "assets", "icons")

COLORS = {
    "connected": (66, 133, 244),
    "connecting": (251, 188, 4),
    "disconnected": (158, 158, 158),
}


def png_chunk(tag: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(tag + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)


def write_circle_png(path: str, size: int, rgb: tuple[int, int, int]) -> None:
    r, g, b = rgb
    cx = cy = size / 2
    radius = size / 2 - 1
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            dist = ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2) ** 0.5
            if dist <= radius:
                row.extend([r, g, b, 255])
            else:
                row.extend([0, 0, 0, 0])
        rows.append(bytes(row))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n"
    png += png_chunk(b"IHDR", ihdr)
    png += png_chunk(b"IDAT", zlib.compress(b"".join(rows), 9))
    png += png_chunk(b"IEND", b"")

    with open(path, "wb") as handle:
        handle.write(png)


def main() -> None:
    os.makedirs(ROOT, exist_ok=True)
    for name, rgb in COLORS.items():
        for size in (16, 32, 48, 128):
            write_circle_png(os.path.join(ROOT, f"{name}-{size}.png"), size, rgb)
    print(f"Wrote icons to {ROOT}")


if __name__ == "__main__":
    main()
