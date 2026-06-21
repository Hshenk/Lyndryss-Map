#!/usr/bin/env python3
"""
slice-map.py — cut a Wonderdraft region export into web tiles for Lyndryss-Map.

The site renders one global grid of tile_size x tile_size PNG tiles addressed by
integer (x, y) coordinates (see data/SCHEMA.md). Each regional export covers a
known rectangular block of that grid; this tool slices the export into
correctly-named tiles and tells you the coords to add to the manifest.

Usage:
    python tools/slice-map.py REGION.png OUT_DIR [options]

    REGION.png   a flat region export. Its top-left pixel is treated as the
                 top-left corner of tile (offset_x, offset_y). Author region
                 maps at an exact multiple of the tile size; any partial edge
                 tiles are padded with transparency so every tile is square.
    OUT_DIR      where to write {x}_{y}.png files. Use a staging folder, e.g.
                 resources/staging/<region>/, NOT tiles/base/ directly, so you
                 can hand-pick which tiles to actually reveal to players.

Options:
    -t, --tile-size N   world px per tile edge (default 512; must match the
                        manifest's tileSize)
    -x, --offset-x X0   global tile X of the export's top-left tile (default 0)
    -y, --offset-y Y0   global tile Y of the export's top-left tile (default 0)
                        Negatives are fine; use the = form, e.g. --offset-x=-2

How the math works:
    Local tile (i, j) of the export becomes global tile (X0 + i, Y0 + j) and is
    cropped from pixel box (i*T, j*T, i*T+T, j*T+T). Fully transparent tiles
    (nothing revealed there) are skipped.

Publish loop (see data/SCHEMA.md):
    1. Export the finished region from Wonderdraft at 1:1 (no rescale).
    2. Run this tool into a staging folder.
    3. Copy the revealed tiles into tiles/base/ (or tiles/<overlay>/).
    4. Add their coords to manifest.json, bump version, push.

Requires Pillow:  pip install pillow
"""

import argparse
import json
import math
import os
import sys

try:
    from PIL import Image
except ImportError:
    sys.exit("This tool needs Pillow. Install it with:  pip install pillow")


def slice_map(region_path, out_dir, tile_size=512, offset_x=0, offset_y=0):
    """Slice region_path into {x}_{y}.png tiles under out_dir. Returns the list
    of [global_x, global_y] coords written (paste into manifest.json)."""
    # Convert to RGBA so partial edge tiles can be padded transparently.
    image = Image.open(region_path).convert("RGBA")
    width, height = image.size

    if width % tile_size or height % tile_size:
        print(
            f"warning: {width}x{height}px is not an exact multiple of "
            f"{tile_size}px — edge tiles will be padded with transparency."
        )

    cols = math.ceil(width / tile_size)
    rows = math.ceil(height / tile_size)
    os.makedirs(out_dir, exist_ok=True)

    written = []
    skipped = 0
    for j in range(rows):
        for i in range(cols):
            # Crop the source region for this tile, clamped to the image edge.
            box = (
                i * tile_size,
                j * tile_size,
                min((i + 1) * tile_size, width),
                min((j + 1) * tile_size, height),
            )
            piece = image.crop(box)

            # Paste onto a fully transparent square so every tile is exactly
            # tile_size x tile_size, with transparent padding on the edges.
            tile = Image.new("RGBA", (tile_size, tile_size), (0, 0, 0, 0))
            tile.paste(piece, (0, 0))

            # Nothing to reveal here (e.g. an all-padding corner)? Skip it,
            # so the manifest only ever lists tiles with real content.
            if tile.getchannel("A").getbbox() is None:
                skipped += 1
                continue

            gx, gy = offset_x + i, offset_y + j
            tile.save(os.path.join(out_dir, f"{gx}_{gy}.png"))
            written.append([gx, gy])

    print(f"wrote {len(written)} tiles to {out_dir}  ({skipped} empty skipped)")
    print("manifest coords (paste into manifest.json -> tiles.<layer>):")
    print(json.dumps(written))
    return written


def main():
    parser = argparse.ArgumentParser(
        description="Slice a region export into Lyndryss map tiles."
    )
    parser.add_argument("region", help="path to the region export PNG")
    parser.add_argument("out_dir", help="output directory for {x}_{y}.png tiles")
    parser.add_argument(
        "-t", "--tile-size", type=int, default=512,
        help="world px per tile edge (default 512; must match the manifest)",
    )
    parser.add_argument(
        "-x", "--offset-x", type=int, default=0,
        help="global tile X of the export's top-left tile (default 0)",
    )
    parser.add_argument(
        "-y", "--offset-y", type=int, default=0,
        help="global tile Y of the export's top-left tile (default 0)",
    )
    args = parser.parse_args()
    slice_map(args.region, args.out_dir, args.tile_size, args.offset_x, args.offset_y)


if __name__ == "__main__":
    main()
