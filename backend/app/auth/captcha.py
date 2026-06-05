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
    """校验图形验证码，成功后立即删除（一次性）。"""
    if not captcha_id or not code:
        return False
    try:
        client = get_redis()
        key = _redis_key(captcha_id)
        answer = client.get(key)
        if answer is None:
            return False
        client.delete(key)
        return str(answer).strip().upper() == code.strip().upper()
    except Exception:
        return False


def _render_image(code: str) -> str:
    """用 Pillow 渲染带干扰的验证码图片，返回 base64（不含前缀）。"""
    from PIL import Image, ImageDraw, ImageFont, ImageFilter

    width, height = 120, 44
    image = Image.new("RGB", (width, height), color=(245, 247, 252))
    draw = ImageDraw.Draw(image)

    font = _load_font(28)

    # 背景干扰线
    for _ in range(6):
        x1, y1 = random.randint(0, width), random.randint(0, height)
        x2, y2 = random.randint(0, width), random.randint(0, height)
        draw.line([(x1, y1), (x2, y2)], fill=_soft_color(), width=1)

    # 干扰点
    for _ in range(120):
        draw.point((random.randint(0, width), random.randint(0, height)), fill=_soft_color())

    # 逐字符绘制，带随机偏移和颜色
    char_w = width // (len(code) + 1)
    for index, char in enumerate(code):
        color = (random.randint(20, 110), random.randint(20, 110), random.randint(80, 180))
        x = char_w * (index + 1) - char_w // 2 + random.randint(-3, 3)
        y = random.randint(2, 10)
        draw.text((x, y), char, font=font, fill=color)

    image = image.filter(ImageFilter.SMOOTH)

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return base64.b64encode(buffer.getvalue()).decode("ascii")


def _soft_color() -> tuple[int, int, int]:
    return (random.randint(150, 220), random.randint(150, 220), random.randint(170, 230))


def _load_font(size: int):
    from PIL import ImageFont

    candidates = [
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
