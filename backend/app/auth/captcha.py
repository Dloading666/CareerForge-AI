from __future__ import annotations

import base64
import io
import random
import secrets
import string

from app.infra.redis_client import get_redis

# 图形验证码：4 位字母数字（去掉易混淆字符），存 Redis 5 分钟，一次性使用
_CAPTCHA_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
_CAPTCHA_TTL_SECONDS = 300
_CAPTCHA_LENGTH = 4


def _redis_key(captcha_id: str) -> str:
    return f"captcha:{captcha_id}"


def generate_captcha() -> dict:
    """生成图形验证码，返回 {captcha_id, image(base64 data url)}，答案存 Redis。"""
    code = "".join(secrets.choice(_CAPTCHA_CHARS) for _ in range(_CAPTCHA_LENGTH))
    captcha_id = secrets.token_urlsafe(16)

    image_b64 = _render_image(code)

    try:
        client = get_redis()
        client.setex(_redis_key(captcha_id), _CAPTCHA_TTL_SECONDS, code.upper())
    except Exception:
        # Redis 不可用时退化为不可校验（前端仍会显示），但生产环境 redis 必须在线
        pass

    return {"captcha_id": captcha_id, "image": f"data:image/png;base64,{image_b64}"}


def verify_captcha(captcha_id: str, code: str) -> bool:
    """校验图形验证码，原子删除（一次性）。使用 GETDEL 防止并发复用。"""
    if not captcha_id or not code:
        return False
    try:
        client = get_redis()
        key = _redis_key(captcha_id)
        answer = client.getdel(key)  # 原子：GET + DELETE
        if answer is None:
            return False
        return str(answer).strip().upper() == code.strip().upper()
    except Exception:
        return False


def _render_image(code: str) -> str:
    """用 Pillow 渲染带干扰的验证码图片，返回 base64（不含前缀）。"""
    from PIL import Image, ImageDraw, ImageFont, ImageFilter

    width, height = 280, 90
    bg = random.choice([(245, 248, 255), (255, 248, 245), (248, 255, 248), (255, 252, 240)])
    image = Image.new("RGB", (width, height), color=bg)
    draw = ImageDraw.Draw(image)

    font = _load_font(72)

    # 背景干扰弧线
    for _ in range(4):
        x1, y1 = random.randint(-20, width), random.randint(-10, height + 10)
        x2, y2 = random.randint(-20, width), random.randint(-10, height + 10)
        mid_x = (x1 + x2) // 2 + random.randint(-40, 40)
        mid_y = random.randint(-10, height + 10)
        points = []
        for t_i in range(20):
            t = t_i / 19.0
            px = int((1 - t) ** 2 * x1 + 2 * (1 - t) * t * mid_x + t ** 2 * x2)
            py = int((1 - t) ** 2 * y1 + 2 * (1 - t) * t * mid_y + t ** 2 * y2)
            points.append((px, py))
        line_color = random.choice([
            (180, 200, 230), (210, 180, 180), (180, 210, 180),
            (200, 190, 170), (190, 180, 210),
        ])
        if len(points) >= 2:
            draw.line(points, fill=line_color, width=2)

    # 干扰点
    for _ in range(80):
        draw.point(
            (random.randint(0, width), random.randint(0, height)),
            fill=(random.randint(160, 220), random.randint(160, 220), random.randint(160, 230)),
        )

    # 逐字符绘制：随机颜色 + 随机旋转 + 随机位置
    colors = [
        (30, 80, 180),   # 蓝
        (180, 50, 30),   # 红
        (30, 140, 60),   # 绿
        (160, 80, 20),   # 棕
        (100, 40, 160),  # 紫
        (20, 130, 150),  # 青
    ]
    start_x = 20
    spacing = (width - 40) // len(code)
    for index, char in enumerate(code):
        color = random.choice(colors)
        x = start_x + spacing * index + random.randint(-4, 4)
        y = random.randint(2, 12)
        char_img = Image.new("RGBA", (80, 84), (0, 0, 0, 0))
        char_draw = ImageDraw.Draw(char_img)
        char_draw.text((4, 2), char, font=font, fill=(*color, 255))
        angle = random.randint(-25, 25)
        char_img = char_img.rotate(angle, expand=True, resample=Image.BICUBIC)
        image.paste(char_img, (x, y), char_img)

    image = image.filter(ImageFilter.SMOOTH)

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _load_font(size: int):
    from PIL import ImageFont
    import os

    # 使用同目录下的 VeraBd.ttf（粗体，清晰可读）
    local_font = os.path.join(os.path.dirname(os.path.abspath(__file__)), "VeraBd.ttf")
    candidates = [
        local_font,
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "DejaVuSans-Bold.ttf",
        "DejaVuSans.ttf",
        "arial.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except Exception:
            continue
    return ImageFont.load_default()


# 供前端/字符集校验复用
ALPHABET = string.ascii_uppercase + string.digits
