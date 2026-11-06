"""Render the Planner app icon at every taskbar/Explorer size and pack it into assets/planner.ico.

Small sizes (<= 48 px) are stored as classic 32-bit DIB entries for maximum compatibility,
larger ones as PNG. Each size is drawn separately with supersampling so small icons stay crisp.

Usage: python tools/make_icon.py
"""
import io
import os
import struct

from PIL import Image, ImageChops, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_ICO = os.path.join(ROOT, "assets", "planner.ico")
OUT_PNG = os.path.join(ROOT, "assets", "planner-256.png")
SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]

TOP = (99, 102, 241)      # indigo
BOTTOM = (124, 58, 237)   # violet
BAND = (255, 99, 86)      # tomato header band
INK = (79, 70, 229)       # check mark
RING_LINE = (55, 48, 163)


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def render(size):
    ss = 8 if size <= 48 else 4
    S = size * ss
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))

    # Background: rounded square with a diagonal indigo -> violet gradient.
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        gd.line([(0, y), (S, y)], fill=lerp(TOP, BOTTOM, y / (S - 1)) + (255,))
    mask = Image.new("L", (S, S), 0)
    pad = S * (0.02 if size <= 24 else 0.04)
    ImageDraw.Draw(mask).rounded_rectangle([pad, pad, S - 1 - pad, S - 1 - pad], radius=S * 0.23, fill=255)
    img.paste(grad, (0, 0), mask)

    d = ImageDraw.Draw(img)
    small = size <= 20
    # Calendar page.
    x0, y0, x1, y1 = (S * 0.17, S * 0.25, S * 0.83, S * 0.83) if small else (S * 0.2, S * 0.27, S * 0.8, S * 0.8)
    r = S * 0.09
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, fill=(255, 255, 255, 255))

    # Tomato header band clipped to the page's rounded top.
    band_h = (y1 - y0) * 0.27
    page = Image.new("L", (S, S), 0)
    ImageDraw.Draw(page).rounded_rectangle([x0, y0, x1, y1], radius=r, fill=255)
    clip = Image.new("L", (S, S), 0)
    ImageDraw.Draw(clip).rectangle([x0, y0, x1, y0 + band_h], fill=255)
    img.paste(Image.new("RGBA", (S, S), BAND + (255,)), (0, 0), ImageChops.multiply(page, clip))

    # Binder rings (skipped at tiny sizes where they turn to mush).
    if size >= 24:
        rw, rh = S * 0.065, S * 0.14
        for cx in (S * 0.37, S * 0.63):
            d.rounded_rectangle(
                [cx - rw / 2, y0 - rh * 0.5, cx + rw / 2, y0 + rh * 0.5],
                radius=rw / 2,
                fill=(255, 255, 255, 255),
                outline=RING_LINE + (255,),
                width=max(ss, round(S * 0.014)),
            )

    # Check mark.
    cw = max(ss * 1.7, S * (0.1 if small else 0.08))
    if small:
        pts = [(S * 0.34, S * 0.6), (S * 0.46, S * 0.71), (S * 0.67, S * 0.5)]
    else:
        pts = [(S * 0.36, S * 0.6), (S * 0.465, S * 0.7), (S * 0.65, S * 0.51)]
    d.line(pts, fill=INK + (255,), width=round(cw), joint="curve")
    for px, py in (pts[0], pts[-1]):
        d.ellipse([px - cw / 2, py - cw / 2, px + cw / 2, py + cw / 2], fill=INK + (255,))

    return img.resize((size, size), Image.LANCZOS)


def dib_entry(im):
    w, h = im.size
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, 0, 0, 0, 0, 0)
    px = im.tobytes("raw", "BGRA")
    rows = [px[y * w * 4:(y + 1) * w * 4] for y in range(h)]
    xor = b"".join(reversed(rows))
    row_bytes = ((w + 31) // 32) * 4
    alpha = im.split()[3].tobytes()
    and_rows = []
    for y in range(h - 1, -1, -1):
        bits = bytearray(row_bytes)
        for x in range(w):
            if alpha[y * w + x] == 0:
                bits[x // 8] |= 0x80 >> (x % 8)
        and_rows.append(bytes(bits))
    return header + xor + b"".join(and_rows)


def png_entry(im):
    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


def main():
    os.makedirs(os.path.dirname(OUT_ICO), exist_ok=True)
    images = [render(s) for s in SIZES]
    blobs = [dib_entry(im) if im.size[0] <= 48 else png_entry(im) for im in images]
    offset = 6 + 16 * len(images)
    with open(OUT_ICO, "wb") as f:
        f.write(struct.pack("<HHH", 0, 1, len(images)))
        for im, blob in zip(images, blobs):
            w, h = im.size
            f.write(struct.pack("<BBBBHHII", w % 256, h % 256, 0, 0, 1, 32, len(blob), offset))
            offset += len(blob)
        for blob in blobs:
            f.write(blob)
    images[-1].save(OUT_PNG)
    # Contact sheet of every size for eyeballing.
    sheet = Image.new("RGBA", (sum(SIZES) + 10 * len(SIZES) + 10, 276), (40, 40, 46, 255))
    x = 10
    for im in images:
        sheet.paste(im, (x, 10), im)
        x += im.size[0] + 10
    sheet.save(os.path.join(ROOT, "assets", "icon-sheet.png"))
    print("wrote", OUT_ICO, os.path.getsize(OUT_ICO), "bytes")


if __name__ == "__main__":
    main()
