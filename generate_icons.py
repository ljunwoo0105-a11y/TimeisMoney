#!/usr/bin/env python3
"""Generate app icons for Time is Money (dark teal background + gold $ + clock ring).

Run:  python generate_icons.py
Outputs PNGs into ./icons/
"""
import math
import os
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
os.makedirs(OUT, exist_ok=True)

S = 1024  # master render size, downscaled for crispness
SIZES = [512, 192, 180, 32]

TOP = (12, 46, 41)      # teal
BOT = (5, 16, 14)       # near-black
RING = (255, 255, 255, 40)
GOLD = (251, 191, 36)   # #fbbf24
GLOW = (52, 211, 153)   # emerald glow


def find_font(size):
    candidates = [
        r"C:\Windows\Fonts\segoeuib.ttf",   # Segoe UI Bold
        r"C:\Windows\Fonts\arialbd.ttf",    # Arial Bold
        r"C:\Windows\Fonts\seguisb.ttf",    # Segoe UI Semibold
        r"C:\Windows\Fonts\Arial.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                pass
    return ImageFont.load_default()


def render_master():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img, "RGBA")

    # vertical gradient background (full-bleed -> works as maskable too)
    for y in range(S):
        t = y / (S - 1)
        r = int(TOP[0] + (BOT[0] - TOP[0]) * t)
        g = int(TOP[1] + (BOT[1] - TOP[1]) * t)
        b = int(TOP[2] + (BOT[2] - TOP[2]) * t)
        d.line([(0, y), (S, y)], fill=(r, g, b, 255))

    cx = cy = S / 2

    # soft emerald glow behind the glyph
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow, "RGBA")
    for i, rad in enumerate(range(int(S * 0.42), int(S * 0.18), -14)):
        a = int(6 + i * 1.4)
        gd.ellipse([cx - rad, cy - rad, cx + rad, cy + rad],
                   fill=(GLOW[0], GLOW[1], GLOW[2], min(a, 60)))
    img = Image.alpha_composite(img, glow)
    d = ImageDraw.Draw(img, "RGBA")

    # clock ring
    ring_r = S * 0.355
    d.ellipse([cx - ring_r, cy - ring_r, cx + ring_r, cy + ring_r],
              outline=RING, width=max(3, int(S * 0.008)))
    # 12 tick marks around the ring
    for k in range(12):
        ang = math.radians(k * 30 - 90)
        r1 = ring_r * 0.92
        r2 = ring_r * (0.80 if k % 3 else 0.72)
        x1, y1 = cx + r1 * math.cos(ang), cy + r1 * math.sin(ang)
        x2, y2 = cx + r2 * math.cos(ang), cy + r2 * math.sin(ang)
        w = int(S * (0.012 if k % 3 == 0 else 0.006))
        d.line([(x1, y1), (x2, y2)], fill=(255, 255, 255, 70), width=max(2, w))

    # the "$" glyph, centered
    font = find_font(int(S * 0.5))
    glyph = "$"
    bbox = d.textbbox((0, 0), glyph, font=font)
    gw, gh = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = cx - gw / 2 - bbox[0]
    ty = cy - gh / 2 - bbox[1]
    # subtle drop shadow
    d.text((tx + S * 0.006, ty + S * 0.008), glyph, font=font, fill=(0, 0, 0, 90))
    d.text((tx, ty), glyph, font=font, fill=GOLD + (255,))

    return img


def main():
    master = render_master()
    for sz in SIZES:
        out = master.resize((sz, sz), Image.LANCZOS)
        # flatten onto opaque background (iOS ignores alpha & rounds corners itself)
        flat = Image.new("RGB", (sz, sz), BOT)
        flat.paste(out, (0, 0), out)
        path = os.path.join(OUT, f"icon-{sz}.png")
        flat.save(path, "PNG")
        print("wrote", path)


if __name__ == "__main__":
    main()
