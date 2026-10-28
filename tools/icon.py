# Anki Everything 图标 v2：取景框里一个被荧光笔划过的 ä（和 App 里划重点的样子一样：黄底黑字）
# 用法：python3 tools/icon.py assets <Archivo 800/82 静态字体 ttf>（字体用 fontTools 从 @fontsource-variable/archivo 冻结得到）
import math, sys
from PIL import Image, ImageDraw, ImageFont
out, fontfile = sys.argv[1], sys.argv[2]
BG, FRAME, MARK, INK = "#141414", "#F2F2F0", "#E9FF3B", "#141414"
K = 4

def draw_icon(size, scale=1.0, transparent=False, frame=True):
    big = size * K
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0) if transparent else BG)
    d = ImageDraw.Draw(img)
    s = big / 1024 * scale
    o = (big - 1024 * s) / 2
    P = lambda x, y: (o + x * s, o + y * s)
    if frame:
        w = 34 * s
        L, T, R, B, arm = 206, 206, 818, 818, 132
        for (x, y, dx, dy) in [(L, T, 1, 1), (R, T, -1, 1), (L, B, 1, -1), (R, B, -1, -1)]:
            for (x2, y2) in [(x + dx * arm, y), (x, y + dy * arm)]:
                d.line([P(x, y), P(x2, y2)], fill=FRAME, width=round(w))
                for (cx, cy) in [(x, y), (x2, y2)]:
                    px, py = P(cx, cy); r = w / 2
                    d.ellipse([px - r, py - r, px + r, py + r], fill=FRAME)
    # 荧光笔：盖住字母下半截，两端斜切，略微倾斜
    cx, cy, hw, hh, skew, tilt = 512, 590, 210, 92, 26, math.radians(-4)
    pts = [(-hw + skew, -hh), (hw + skew, -hh), (hw - skew, hh), (-hw - skew, hh)]
    rot = [(cx + x * math.cos(tilt) - y * math.sin(tilt), cy + x * math.sin(tilt) + y * math.cos(tilt)) for x, y in pts]
    d.polygon([P(x, y) for x, y in rot], fill=MARK)
    # 字母 ä：Archivo 800，宽度 82%
    font = ImageFont.truetype(fontfile, round(520 * s))
    text = "ä"
    box = d.textbbox((0, 0), text, font=font, anchor="ls")
    tw, th = box[2] - box[0], box[3] - box[1]
    x, y = P(512, 0)[0] - tw / 2 - box[0], P(0, 668)[1]
    # 字母压在荧光笔上：下半在黄底上是黑字；上半在黑底上要白字。先画白字，再用荧光笔形状做遮罩画黑字
    d.text((x, y), text, font=font, fill=FRAME, anchor="ls")
    mark_mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mark_mask).polygon([P(px, py) for px, py in rot], fill=255)
    ink_layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    ImageDraw.Draw(ink_layer).text((x, y), text, font=font, fill=INK, anchor="ls")
    img.paste(ink_layer, (0, 0), Image.composite(ink_layer.getchannel("A"), Image.new("L", img.size, 0), mark_mask))
    return img.resize((size, size), Image.LANCZOS)

draw_icon(1024).convert("RGB").save(f"{out}/icon-only.png")
draw_icon(1024, scale=0.8, transparent=True).save(f"{out}/icon-foreground.png")
Image.new("RGB", (1024, 1024), BG).save(f"{out}/icon-background.png")
prev = Image.new("RGB", (1000, 320), "#8a8f97")
for i, (size, shape) in enumerate([(220, "square"), (220, "circle"), (220, "squircle"), (96, "circle")]):
    icon = draw_icon(size, scale=0.86 if shape != "square" else 1.0)
    mask = Image.new("L", (size, size), 0); md = ImageDraw.Draw(mask)
    if shape == "circle": md.ellipse([0, 0, size, size], fill=255)
    elif shape == "squircle": md.rounded_rectangle([0, 0, size, size], radius=size * 0.28, fill=255)
    else: md.rectangle([0, 0, size, size], fill=255)
    icon.putalpha(mask)
    prev.paste(icon, (20 + i * 245, (320 - size) // 2), icon)
prev.save(f"{out}/preview2.png")
print("ok")
