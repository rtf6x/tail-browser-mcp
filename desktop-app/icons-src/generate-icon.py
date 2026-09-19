#!/usr/bin/env python3
"""Render the Tail MCP desktop app source icon (1024x1024) from icon.svg.

Needs `rsvg-convert` (brew install librsvg). Afterwards run
`cargo tauri icon icons-src/icon-source.png` from desktop-app/ to produce the
full platform icon set under src-tauri/icons/.
"""
import os
import subprocess

HERE = os.path.dirname(__file__)
SRC = os.path.join(HERE, "icon.svg")
OUT = os.path.join(HERE, "icon-source.png")

if __name__ == "__main__":
    subprocess.run(["rsvg-convert", "-w", "1024", "-h", "1024", SRC, "-o", OUT], check=True)
    print(f"Wrote {OUT}")
