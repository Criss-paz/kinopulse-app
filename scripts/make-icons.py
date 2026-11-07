"""Generate PWA icons and the Android TV launcher banner from code (no binary design assets needed)."""
import os, sys
from PIL import Image, ImageDraw, ImageFilter

BG, RED, CYAN = (9, 10, 15), (229, 9, 20), (0, 240, 255)
root = sys.argv[1] if len(sys.argv) > 1 else '.'

def mark(size, pad=0.0):
    img = Image.new('RGB', (size, size), BG)
    glow = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(glow)
    s = size * (1 - 2 * pad)
    o = size * pad
    tri = [(o + s * 0.34, o + s * 0.24), (o + s * 0.34, o + s * 0.76), (o + s * 0.78, o + s * 0.5)]
    d.polygon(tri, fill=RED + (255,))
    glow_b = glow.filter(ImageFilter.GaussianBlur(size * 0.04))
    img.paste(glow_b, (0, 0), glow_b)
    img.paste(glow, (0, 0), glow)
    ImageDraw.Draw(img).line([(o + s * 0.18, o + s * 0.84), (o + s * 0.82, o + s * 0.84)], fill=CYAN, width=max(2, int(size * 0.03)))
    return img

def save(img, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)

pub = os.path.join(root, 'public', 'icons')
save(mark(192), os.path.join(pub, 'icon-192.png'))
save(mark(512), os.path.join(pub, 'icon-512.png'))
save(mark(512, pad=0.12), os.path.join(pub, 'icon-512-maskable.png'))

res = os.path.join(root, 'android', 'app', 'src', 'main', 'res')
if os.path.isdir(res):
    banner = Image.new('RGB', (320, 180), BG)
    banner.paste(mark(140).resize((120, 120)), (16, 30))
    d = ImageDraw.Draw(banner)
    try:
        from PIL import ImageFont
        font = ImageFont.truetype('arialbd.ttf', 40)
    except Exception:
        font = None
    d.text((142, 66), 'Kino', fill=(255, 255, 255), font=font)
    d.text((142 + (88 if font else 26), 66), 'Pulse', fill=RED, font=font)
    save(banner, os.path.join(res, 'drawable-xhdpi', 'banner.png'))
    for dens, px in {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}.items():
        icon = mark(px)
        save(icon, os.path.join(res, f'mipmap-{dens}', 'ic_launcher.png'))
        save(icon, os.path.join(res, f'mipmap-{dens}', 'ic_launcher_round.png'))
        fg = mark(int(px * 2.25), pad=0.2)
        save(fg, os.path.join(res, f'mipmap-{dens}', 'ic_launcher_foreground.png'))
print('icons ok')
