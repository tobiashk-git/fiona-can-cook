"""Generates the app icons: a cobalt tile with a geometric white F.
Run:  python make_icons.py
"""
from PIL import Image, ImageDraw

COBALT = (35, 64, 255)
WHITE = (255, 255, 255)


def draw_f(size, pad_ratio):
    """Cobalt square with a white, geometric F drawn from rectangles."""
    S = 1024
    img = Image.new("RGB", (S, S), COBALT)
    d = ImageDraw.Draw(img)

    pad = S * pad_ratio
    h = S - pad * 2                 # cap height of the F
    w = h * 0.62                    # overall width
    x0, y0 = (S - w) / 2, pad
    stem = h * 0.20                 # stroke weight

    d.rectangle([x0, y0, x0 + stem, y0 + h], fill=WHITE)            # stem
    d.rectangle([x0, y0, x0 + w, y0 + stem], fill=WHITE)            # top arm
    mid = y0 + h * 0.44
    d.rectangle([x0, mid, x0 + w * 0.78, mid + stem], fill=WHITE)   # middle arm

    return img.resize((size, size), Image.LANCZOS)


for s in (180, 192, 512):
    draw_f(s, 0.24).save(f"icons/icon-{s}.png")
draw_f(512, 0.32).save("icons/icon-maskable-512.png")   # safe zone for maskable
print("icons written")
