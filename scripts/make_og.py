#!/usr/bin/env python3
# 產出社群分享預覽圖 og-image.png（1200×630，Open Graph 標準尺寸）
# 品牌：米白底 #FAF6F0、陶土橘 #C96F4A、Songti 襯線標題
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
CREAM = (250, 246, 240)   # #FAF6F0
INK = (43, 35, 32)        # #2B2320
CLAY = (201, 111, 74)     # #C96F4A
CLAY_SOFT = (238, 221, 209)

img = Image.new("RGB", (W, H), CREAM)
d = ImageDraw.Draw(img)

# 左側陶土橘直條當視覺重點
d.rectangle([0, 0, 18, H], fill=CLAY)

SONGTI = "/System/Library/Fonts/Songti.ttc"
TC_BOLD, TC_REG = 2, 7  # Songti TC Bold / Regular（繁體完整）

def font(size, idx=TC_REG):
    return ImageFont.truetype(SONGTI, size, index=idx)

def center_x(text, f):
    l, t, r, b = d.textbbox((0, 0), text, font=f)
    return (W - (r - l)) / 2 - l

# 上方小標籤（膠囊）
tag = "出國必買 ｜ 好物指南"
tag_f = font(36, TC_REG)
tl, tt, tr, tb = d.textbbox((0, 0), tag, font=tag_f)
tw, th = tr - tl, tb - tt
pad_x, pad_y = 30, 16
tag_x = (W - tw) / 2
tag_y = 96
d.rounded_rectangle(
    [tag_x - pad_x, tag_y - pad_y, tag_x + tw + pad_x, tag_y + th + pad_y + 8],
    radius=40, fill=CLAY_SOFT,
)
d.text((tag_x, tag_y), tag, font=tag_f, fill=CLAY)

# 主標題「出國購物趣」— 趣字用陶土橘
title = "出國購物趣"
title_f = font(150, TC_BOLD)
tx = center_x(title, title_f)
ty = 210
# 先算「出國購物」與「趣」的分界，讓「趣」上橘色
head, last = title[:-1], title[-1]
d.text((tx, ty), head, font=title_f, fill=INK)
hl, ht, hr, hb = d.textbbox((0, 0), head, font=title_f)
d.text((tx + (hr - hl), ty), last, font=title_f, fill=CLAY)

# 副標
sub = "日本、韓國、泰國　省錢星級評比　一鍵導航到店"
sub_f = font(44)
sx = center_x(sub, sub_f)
d.text((sx, 448), sub, font=sub_f, fill=INK)

# 底部網址
url = "nicolas5288-commits.github.io/shopfun"
url_f = font(30)
ux = center_x(url, url_f)
d.text((ux, 540), url, font=url_f, fill=CLAY)

img.save("og-image.png", "PNG")
print("✅ og-image.png 產出完成", img.size)
