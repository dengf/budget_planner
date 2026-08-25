"""Generate the app's icons from the meifio brand mark.

Run from the repository root:

    python3 assets/icon/generate.py

Requires only Pillow. Everything it writes is committed, so this only needs
re-running when the artwork itself changes.

It used to emit an iOS asset catalogue, an Android launcher PNG, a Windows
.ico and a macOS .icns as well. Those went with the native apps; what is
left is the set a web app actually serves -- favicons and the PWA
manifest icons. The header carries the meifio logotype as inline SVG
(www/src/components/MeifioMark.jsx), not a raster from here.

The mark is meifio's plum blossom, so every tool in the family shares one
icon. Its outline is sampled from the same path the brand SVG uses
(meifio-brand/build.py, PETAL) rather than redrawn here, so the icon in the
tab cannot drift from the logo on the page.

The ground stays the app's own navy: the mark carries the brand, the tile
carries the app, and a light tile would flash white before a dark app.
"""

import math
import os
import sys

from PIL import Image, ImageChops, ImageDraw

SS = 4  # supersample factor; artwork is drawn at SS x and LANCZOS-downsampled

# Brand palette. The blossom is meifio's plum; the ground is this app's, taken
# from its own stylesheet so the icon matches what opens.
NAVY_DEEP = (11, 17, 25)     # #0b1119  darkest ground
NAVY_PANEL = (22, 30, 43)    # #161e2b  panel background
PLUM = (176, 18, 67)         # #B01243  meifio


# --- the mark ---------------------------------------------------------------
# One petal, in the brand's 0..100 coordinate space, y pointing down:
#
#   M50 50  C41 46 34 38 34 27  A16 16 0 1 1 66 27  C66 38 59 46 50 50  Z
#
# Sampled to a polygon rather than approximated with ellipses, so the petal's
# tapered flanks survive -- five plain circles read as a generic flower and
# lose what makes this a plum blossom.

def _cubic(p0, c0, c1, p1, steps=24):
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        yield (u*u*u*p0[0] + 3*u*u*t*c0[0] + 3*u*t*t*c1[0] + t*t*t*p1[0],
               u*u*u*p0[1] + 3*u*u*t*c0[1] + 3*u*t*t*c1[1] + t*t*t*p1[1])


def _arc(cx, cy, r, a0, a1, steps=36):
    """Angles in degrees, y pointing down."""
    for i in range(steps + 1):
        a = math.radians(a0 + (a1 - a0) * i / steps)
        yield (cx + r * math.cos(a), cy + r * math.sin(a))


def _petal():
    pts = list(_cubic((50, 50), (41, 46), (34, 38), (34, 27)))
    pts += list(_arc(50, 27, 16, 180, 360))     # over the top, left to right
    pts += list(_cubic((66, 27), (66, 38), (59, 46), (50, 50)))
    return pts


def _rotate(pts, deg, ox=50, oy=50):
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    return [((x - ox) * ca - (y - oy) * sa + ox,
             (x - ox) * sa + (y - oy) * ca + oy) for x, y in pts]


def draw_mark(img, s, inset=0.0, punch_through=False):
    """Draw the blossom onto a transparent RGBA image of side s."""
    span = s * (1 - 2 * inset)
    off = s * inset
    scale = span / 100.0
    colour = (255, 255, 255, 255) if punch_through else PLUM + (255,)
    layer = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for k in range(5):
        poly = [(off + x * scale, off + y * scale) for x, y in _rotate(_petal(), 72 * k)]
        d.polygon(poly, fill=colour)
    if punch_through:
        # recolour the union in one pass; overlapping petals must not compound
        solid = Image.new("RGBA", (s, s), PLUM + (255,))
        solid.putalpha(layer.split()[3])
        layer = solid
    img.alpha_composite(layer)


def vertical_gradient(s, top, bottom):
    base = Image.new("RGB", (1, s))
    for y in range(s):
        t = y / max(1, s - 1)
        base.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return base.resize((s, s), Image.NEAREST)


def render(size, inset=0.0, radius=None, opaque=False):
    """Render the icon.

    inset   safe-zone padding for launchers that mask the icon (Android).
    radius  corner radius as a fraction of size; None leaves it square, which
            is what iOS and Android want since they apply their own mask.
    opaque  drop the alpha channel -- required for App Store submission.
    """
    s = size * SS
    base = vertical_gradient(s, NAVY_PANEL, NAVY_DEEP).convert("RGBA")

    if radius is not None:
        mask = Image.new("L", (s, s), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, s - 1, s - 1], radius=int(radius * s), fill=255)
        base.putalpha(mask)

    art = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    draw_mark(art, s, inset)
    base.alpha_composite(art)

    out = base.resize((size, size), Image.LANCZOS)
    return out.convert("RGB") if opaque else out


def write(img, *parts):
    path = os.path.join(*parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print(f"  {path}  ({img.size[0]}x{img.size[1]})")
    return path


# --- iOS -------------------------------------------------------------------


# --- Android ---------------------------------------------------------------
# xbuild scales this single PNG into legacy mipmap densities; it does not
# generate adaptive (foreground/background) layers, so launchers apply their
# own mask to the square. The inset keeps the house corners inside the
# inscribed circle -- without it a round mask clips the eaves.


# --- Desktop ---------------------------------------------------------------


# --- Web -------------------------------------------------------------------
# One front end ships from this repo: the React app in www/. The favicons and
# the PWA manifest icons come from the same artwork, so the tab and the home
# screen cannot drift apart.

def build_web(root):
    print("Web")
    static = os.path.join(root, "www/static")
    os.makedirs(static, exist_ok=True)

    render(64, radius=0.22).save(
        os.path.join(static, "favicon.ico"),
        sizes=[(16, 16), (32, 32), (48, 48)])
    print(f"  {os.path.join(static, 'favicon.ico')}")

    write(render(32, radius=0.22), static, "favicon-32.png")
    # iOS masks the home-screen icon itself, so this one is full-bleed square.
    write(render(180, opaque=True), static, "apple-touch-icon.png")
    write(render(192, radius=0.22), static, "icon-192.png")
    write(render(512, radius=0.22), static, "icon-512.png")
    # "maskable" promises the platform it may crop to any shape it likes.
    write(render(512, inset=0.10), static, "icon-maskable-512.png")


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, "..", ".."))
    if not os.path.isdir(os.path.join(root, "crates")):
        sys.exit(f"expected a crates/ directory under {root}")

    print("Master")
    write(render(1024, opaque=True), here, "icon-master.png")
    build_web(root)
    print("\ndone")


if __name__ == "__main__":
    main()
