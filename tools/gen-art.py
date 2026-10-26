"""Generates the pixel-art textures and emblem used by the Mortal Arcade web UI.
Run: python tools/gen-art.py   (needs Pillow). Output goes to public/img/.
Everything is drawn at native 16-bit-era resolution and scaled up in CSS with
image-rendering: pixelated, so pixels stay crisp."""
import math, os, random
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(__file__), '..', 'public', 'img')
os.makedirs(OUT, exist_ok=True)

STONE = [(28, 22, 19), (38, 31, 27), (47, 39, 34), (57, 47, 41), (69, 58, 50), (84, 71, 61), (101, 86, 74)]


def stone_tile(w=96, h=96, seed=7, dark=0):
    rnd = random.Random(seed)
    im = Image.new('RGB', (w, h), STONE[0])
    px = im.load()
    # rows of irregular blocks, wrapping horizontally and vertically
    y = 0
    rows = []
    while y < h:
        rh = rnd.choice([14, 16, 18, 20])
        if y + rh > h - 10:
            rh = h - y
        rows.append((y, rh))
        y += rh
    for (ry, rh) in rows:
        x = rnd.randint(0, 20)
        start = x
        while x < start + w:
            bw = rnd.choice([18, 22, 26, 30, 34])
            if x + bw > start + w - 12:
                bw = start + w - x
            base = rnd.randint(2, 4) - dark
            for yy in range(ry + 1, ry + rh - 1):
                for xx in range(x + 1, x + bw - 1):
                    n = rnd.random()
                    shade = base + (1 if n > 0.93 else -1 if n < 0.07 else 0)
                    # bevel: light top/left edge, dark bottom/right edge
                    if yy == ry + 1 or xx == x + 1:
                        shade = base + 2
                    if yy == ry + rh - 2 or xx == x + bw - 2:
                        shade = base - 1
                    # cracks
                    px[xx % w, yy % h] = STONE[max(0, min(len(STONE) - 1, shade))]
            if rnd.random() < 0.35:  # a small crack
                cx, cy = rnd.randint(x + 4, x + bw - 5), rnd.randint(ry + 3, ry + rh - 4)
                for i in range(rnd.randint(3, 7)):
                    px[cx % w, cy % h] = STONE[0]
                    cx += rnd.choice([-1, 0, 1]); cy += rnd.choice([0, 1])
            x += bw
    return im


def emblem(size=40):
    """A cast-brass medallion with two crossed arcade sticks: the club tournament seal."""
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    px = im.load()
    c = (size - 1) / 2
    brass = [(122, 77, 16), (176, 116, 30), (227, 169, 58), (255, 224, 138)]
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - c, y - c)
            if d <= c + 0.2:
                if d > c - 1.2:
                    px[x, y] = (23, 15, 10, 255)  # outline
                elif d > c - 5.2:
                    # ring lit from the top left
                    t = ((x - c) * -0.7 + (y - c) * -0.7) / c
                    i = 3 if t > 0.45 else 2 if t > -0.05 else 1 if t > -0.5 else 0
                    px[x, y] = brass[i] + (255,)
                elif d > c - 6.2:
                    px[x, y] = (23, 15, 10, 255)
                else:
                    # blood red field, darker toward the bottom right
                    t = ((x - c) + (y - c)) / (2 * c)
                    px[x, y] = (163, 18, 15, 255) if t < 0.1 else (120, 12, 10, 255)
    d = ImageDraw.Draw(im)

    def stick(x0, y0, x1, y1):
        d.line([(x0, y0), (x1, y1)], fill=(23, 15, 10, 255), width=3)
        d.line([(x0, y0), (x1, y1)], fill=(84, 71, 61, 255), width=1)
        r = 4
        d.ellipse([x1 - r, y1 - r, x1 + r, y1 + r], fill=(23, 15, 10, 255))
        d.ellipse([x1 - r + 1, y1 - r + 1, x1 + r - 1, y1 + r - 1], fill=(239, 227, 200, 255))
        px[int(x1) - 1, int(y1) - 1] = (255, 255, 255, 255)
    m = size * 0.2
    base_y = c + size * 0.2
    # sticks cross like swords: bases low on each side, ball tops high on the other
    for sx in (-1, 1):
        bx = c + sx * m
        d.rectangle([bx - 4, base_y - 1, bx + 4, base_y + 2], fill=(23, 15, 10, 255))
        d.line([(bx - 3, base_y), (bx + 3, base_y)], fill=(227, 169, 58, 255))
    stick(c + m, base_y, c - m * 0.95, c - size * 0.2)
    stick(c - m, base_y, c + m * 0.95, c - size * 0.2)
    return im


def ember_strip(w=64, h=8):
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    rnd = random.Random(3)
    cols = [(255, 224, 138), (255, 138, 31), (224, 48, 30), (120, 12, 10)]
    for x in range(w):
        top = rnd.randint(0, 4)
        for y in range(top, h):
            i = min(3, (y - top) // 2 + (1 if rnd.random() < 0.2 else 0))
            im.putpixel((x, y), cols[i] + (255,))
    return im


stone_tile().save(os.path.join(OUT, 'stone.png'))
stone_tile(seed=19, dark=1).save(os.path.join(OUT, 'stone-dark.png'))
e = emblem(48)
e.save(os.path.join(OUT, 'emblem.png'))
e.resize((160, 160), Image.NEAREST).save(os.path.join(OUT, 'emblem-160.png'))
ember_strip().save(os.path.join(OUT, 'embers.png'))
# favicon
e.resize((32, 32), Image.NEAREST).save(os.path.join(OUT, 'favicon.png'))
print('art written to', os.path.abspath(OUT))
