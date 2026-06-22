"""导入简历时从原文件里抽取头像图片。

策略（统一为「先渲染首页，再在渲染图上扫描头像区域」）：

- **DOCX**:  读 `word/media/` 下的图片资源，取首张。中文简历常用 jpg/png，少数是 gif。
- **PDF（有/无文字层都按此走）**:
    1. 用 pdfium 把首页渲染成 PNG（复用 `file_text.render_pdf_pages_to_png` 的同一套方案）。
    2. 在渲染图上半部按多个候选框采样（top-left / top-center / top-right × 两种尺寸），
       按 `_color_richness` 评分，挑色相最丰富（最像真人照片）的那一框作为头像。

为什么不再依赖 pypdf `page.images`：
- 很多简历的真人照片是绘制在页面上的（不是嵌入图）。pypdf 在这种情况下会把整张
  首页栅格化后整张返回，被尺寸打分误判为「最大且 1:1 的图」，最终保存的其实是页面缩略图。
- 不管 PDF 内部是否嵌入图片，「渲染首页 → 在栅格图上找头像」的路径都成立，跟文字层
  是否存在无关。

任意一步失败都不抛异常，返回 None 让调用方回退到 `user.resume_avatar_url`。
"""
from __future__ import annotations

import io
import logging
import tempfile
from pathlib import Path
from typing import Optional, Tuple

from PIL import Image

from app.student.avatar_storage import (
    ALLOWED_EXTENSIONS,
    MAX_AVATAR_DIMENSION,
    save_extracted_avatar,
)
from app.student.file_text import render_pdf_pages_to_png

logger = logging.getLogger(__name__)

# pypdf 取出的图片常见后缀到 PIL 格式的映射
_PIL_FORMAT_BY_EXT = {
    ".jpg": "JPEG",
    ".jpeg": "JPEG",
    ".png": "PNG",
    ".gif": "GIF",
    ".webp": "WEBP",
    ".bmp": "BMP",
    ".tif": "TIFF",
    ".tiff": "TIFF",
    ".jp2": "JPEG2000",
}

# 旧版 pypdf 启发式：尺寸 + 长宽比
_AVATAR_MIN_SIDE = 80
_AVATAR_MAX_SIDE = 1500
_ASPECT_MIN = 0.5
_ASPECT_MAX = 2.0


def _resize_if_needed(image: Image.Image) -> Image.Image:
    """把图片等比缩放到不超过 MAX_AVATAR_DIMENSION。"""
    width, height = image.size
    longest = max(width, height)
    if longest <= MAX_AVATAR_DIMENSION:
        return image
    scale = MAX_AVATAR_DIMENSION / float(longest)
    new_size = (max(1, int(width * scale)), max(1, int(height * scale)))
    return image.resize(new_size, Image.LANCZOS)


def _pil_to_bytes(image: Image.Image, target_format: str = "PNG") -> Tuple[bytes, str]:
    """统一转 RGBA 再按目标格式编码，返回 (bytes, ext)。"""
    if image.mode in ("RGBA", "LA", "P") and target_format == "JPEG":
        background = Image.new("RGB", image.size, (255, 255, 255))
        if image.mode == "P":
            image = image.convert("RGBA")
        background.paste(image, mask=image.split()[-1] if image.mode in ("RGBA", "LA") else None)
        image = background
    elif image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA" if target_format == "PNG" else "RGB")
    buf = io.BytesIO()
    image.save(buf, format=target_format, optimize=True)
    return buf.getvalue(), f".{target_format.lower()}"


def _normalize_extracted_bytes(data: bytes, original_ext: str) -> Optional[Tuple[bytes, str]]:
    """统一处理提取出的图片字节：解码 -> 缩放 -> 重新编码。"""
    try:
        with Image.open(io.BytesIO(data)) as image:
            image.load()
    except Exception as exc:
        logger.warning("avatar extractor: cannot open image (ext=%s): %s", original_ext, exc)
        return None
    ext = original_ext.lower() if original_ext.lower() in ALLOWED_EXTENSIONS else ".png"
    pil_format = _PIL_FORMAT_BY_EXT.get(ext, "PNG")
    resized = _resize_if_needed(image)
    target_format = "PNG" if ext == ".png" else "JPEG"
    if ext not in {".png", ".jpg", ".jpeg"}:
        target_format = "PNG"
        ext = ".png"
    elif ext in {".jpg", ".jpeg"}:
        target_format = "JPEG"
    try:
        encoded_bytes, final_ext = _pil_to_bytes(resized, target_format)
    except Exception as exc:
        logger.warning("avatar extractor: re-encode failed: %s", exc)
        return None
    return encoded_bytes, final_ext


def _pil_dump_png(image: Image.Image) -> bytes:
    """把 PIL 图序列化为 PNG 字节（不做缩放/格式转换）。"""
    buf = io.BytesIO()
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA")
    image.save(buf, format="PNG", optimize=True)
    return buf.getvalue()


def _render_first_page_png(file_bytes: bytes) -> Optional[bytes]:
    """把 PDF 首页渲染成 PNG 字节。复用 file_text.render_pdf_pages_to_png 走 pdfium。

    失败返回 None（依赖缺失、PDF 损坏、无页面等都属此类）。"""
    if not file_bytes:
        return None
    tmp_path: Optional[Path] = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(file_bytes)
            tmp_path = Path(tmp.name)
    except Exception as exc:
        logger.info("avatar extractor: write temp pdf failed: %s", exc)
        return None
    try:
        try:
            pages = render_pdf_pages_to_png(tmp_path, max_pages=1, scale=2.5)
        except Exception as exc:
            logger.info("avatar extractor: render first page failed: %s", exc)
            return None
        if not pages:
            return None
        return pages[0]
    finally:
        if tmp_path is not None:
            try:
                tmp_path.unlink(missing_ok=True)
            except Exception:
                pass


def _color_richness(image: Image.Image) -> float:
    """估计一张图"含多少照片信息"：饱和度均值 + 亮度方差。

    纯白底+黑文字几乎是 0；真人头像饱和度低但色相分布广，分数高。
    """
    try:
        rgb = image.convert("RGB")
        small = rgb.resize((64, 64), Image.LANCZOS)
        pixels = list(small.getdata())
        if not pixels:
            return 0.0
        s_vals: list[float] = []
        v_vals: list[float] = []
        for r, g, b in pixels:
            mx, mn = max(r, g, b), min(r, g, b)
            v = mx / 255.0
            s = (mx - mn) / mx if mx else 0.0
            s_vals.append(s)
            v_vals.append(v)
        import statistics
        s_mean = statistics.mean(s_vals)
        v_var = statistics.pvariance(v_vals) if len(v_vals) > 1 else 0.0
        return s_mean * 2.0 + min(1.0, v_var * 4.0)
    except Exception:
        return 0.0


def _avatar_candidate_boxes(width: int, height: int) -> list[Tuple[str, Tuple[int, int, int, int]]]:
    """生成头像候选框：在页面上半部多位置 × 多尺寸，覆盖常见的左/中/右/上 1/3 区域。"""
    if width < 60 or height < 60:
        return []
    short_side = min(width, height)
    sizes = [max(80, short_side // 3), max(80, short_side // 4)]
    y_starts = [0, int(height * 0.10)]
    boxes: list[Tuple[str, Tuple[int, int, int, int]]] = []
    for size in sizes:
        crop_w = min(size, width)
        crop_h = min(size, height)
        for y_start in y_starts:
            y0 = min(y_start, max(0, height - crop_h))
            y1 = y0 + crop_h
            for label, x0 in (
                ("left", 0),
                ("center", max(0, (width - crop_w) // 2)),
                ("right", max(0, width - crop_w)),
            ):
                x1 = x0 + crop_w
                if x1 - x0 < 60:
                    continue
                boxes.append((f"{label}_s{size}_y{y0}", (x0, y0, x1, y1)))
    return boxes


def find_avatar_region(png_bytes: bytes) -> Optional[str]:
    """在已渲染的首页 PNG 上扫描候选框，挑色相最丰富的区域作为头像，保存后返回 URL。

    任何失败都返回 None，不抛异常。"""
    if not png_bytes:
        return None
    try:
        with Image.open(io.BytesIO(png_bytes)) as image:
            image.load()
    except Exception as exc:
        logger.info("avatar extractor: cannot open page png: %s", exc)
        return None
    width, height = image.size
    if width < 60 or height < 60:
        return None

    boxes = _avatar_candidate_boxes(width, height)
    if not boxes:
        return None

    best_score = -1.0
    best_crop: Optional[Image.Image] = None
    best_label = ""
    for label, box in boxes:
        try:
            cropped = image.crop(box)
        except Exception as exc:
            logger.info("avatar extractor: crop %s failed: %s", label, exc)
            continue
        score = _color_richness(cropped)
        if score > best_score:
            best_score = score
            best_crop = cropped
            best_label = label

    # 阈值：纯文本块/纯白底色相接近 0；正常简历照片通常 > 0.1
    if best_crop is None or best_score < 0.08:
        logger.info(
            "avatar extractor: no photo-like region (best_score=%.3f, best=%s)",
            best_score, best_label,
        )
        return None

    normalized = _normalize_extracted_bytes(_pil_dump_png(best_crop), ".png")
    if not normalized:
        return None
    encoded, _ = normalized
    try:
        return save_extracted_avatar(encoded, ".png")
    except Exception as exc:
        logger.warning("avatar extractor: save failed: %s", exc)
        return None


def _score_candidate(width: int, height: int) -> float:
    """旧版尺寸 + 长宽比打分，用于 pypdf 嵌入图候选。仅在 pdfium 渲染失败时降级使用。"""
    if width < _AVATAR_MIN_SIDE or height < _AVATAR_MIN_SIDE:
        return -1.0
    if width > _AVATAR_MAX_SIDE and height > _AVATAR_MAX_SIDE:
        return -1.0
    long_side = max(width, height)
    short_side = min(width, height)
    ideal = 450
    size_score = 1.0 - min(1.0, abs(long_side - ideal) / ideal)
    aspect = short_side / max(1, long_side)
    if aspect < _ASPECT_MIN or aspect > _ASPECT_MAX:
        aspect_score = 0.0
    else:
        aspect_score = aspect
    return 0.6 * size_score + 0.4 * aspect_score


def _has_saturation_variation(image: "Image.Image") -> bool:
    """判断一张图是否“色相有起伏”。

    真人照片的肤色、头发、背景饱和度差异明显；纯色 logo / 纯色 banner 全图一个色。
    计算饱和度方差，超过阈值才认为是“像照片”的图。
    """
    try:
        rgb = image.convert("RGB")
        small = rgb.resize((48, 48), Image.LANCZOS)
        pixels = list(small.getdata())
        if not pixels:
            return False
        import statistics
        s_vals: list[float] = []
        for r, g, b in pixels:
            mx, mn = max(r, g, b), min(r, g, b)
            s_vals.append((mx - mn) / mx if mx else 0.0)
        s_var = statistics.pvariance(s_vals) if len(s_vals) > 1 else 0.0
        return s_var >= 1e-6
    except Exception:
        return False


def _score_photo_image(image: "Image.Image") -> float:
    """给一张 PIL 图打"像真人头像"的分。DOCX 多图、PDF 嵌入图共用。

    评分要素（综合分 0~1，越高越像）：
    - 最小边 < 80 直接返回 -1（基本是 logo / 装饰小图）
    - 长宽比必须在 0.4~2.5 之间（竖版、方形照片都行；宽幅 banner 排除）
    - 色相丰富度（_color_richness）：真人照片色相多样，纯色 logo / 渐变 banner 偏低

    返回 -1 表示该图不应当作头像（供调用方跳过）。
    """
    try:
        width, height = image.size
    except Exception:
        return -1.0
    if width < 80 or height < 80:
        return -1.0
    long_side = max(width, height)
    short_side = min(width, height)
    aspect = short_side / max(1, long_side)
    if aspect < 0.4 or aspect > 2.5:
        return -1.0
    size_score = min(1.0, short_side / 300.0) * 0.6 + 0.4
    color = _color_richness(image)
    # 纯色块（纯红 logo / 纯蓝 banner）色相丰富度会被 _color_richness 误判为高分，
    # 这里额外要求“饱和度有起伏” —— 真人照片的肤色、头发、背景饱和度差异大，
    # 纯色 logo 全图一个色，饱和度方差几乎为 0。
    if not _has_saturation_variation(image):
        return -1.0
    return size_score * 0.4 + min(1.0, color) * 0.6


def _extract_avatar_from_pdf_legacy(file_bytes: bytes) -> Optional[str]:
    """旧版基于 pypdf `page.images` 的提取，作为 pdfium 渲染失败时的兜底。

    老逻辑在 pypdf 给不出图片尺寸时会直接 return 第一张图（没打分），
    容易把页眉装饰 / 校徽 / banner 错认成头像。这里统一走 _score_photo_image 评分，
    不知道尺寸时自己解一次码再打分。
    """
    try:
        from pypdf import PdfReader
    except Exception as exc:
        logger.warning("avatar extractor: pypdf not available: %s", exc)
        return None
    try:
        reader = PdfReader(io.BytesIO(file_bytes))
        if not reader.pages:
            return None
        first_page = reader.pages[0]
        images = list(getattr(first_page, "images", []) or [])
    except Exception as exc:
        logger.info("avatar extractor: pypdf failed: %s", exc)
        return None
    if not images:
        return None
    best: Optional[Tuple[float, bytes, str]] = None
    for image in images:
        try:
            data = image.data
            if not data:
                continue
            pil_img = getattr(image, "image", None)
            if pil_img is None:
                # 旧 pypdf / 包装对象不暴露 .image，自己解一次码用于打分
                try:
                    pil_img = Image.open(io.BytesIO(data))
                    pil_img.load()
                except Exception:
                    continue
            score = _score_photo_image(pil_img)
            if score < 0:
                continue
            ext = "." + (image.name.split(".")[-1].lower() if "." in image.name else "png")
            normalized = _normalize_extracted_bytes(data, ext)
            if not normalized:
                continue
            encoded, final_ext = normalized
            if best is None or score > best[0]:
                best = (score, encoded, final_ext)
        except Exception as exc:
            logger.info("avatar extractor: candidate skipped: %s", exc)
            continue
    if best is None:
        return None
    _, encoded, final_ext = best
    try:
        return save_extracted_avatar(encoded, final_ext)
    except Exception as exc:
        logger.warning("avatar extractor: save failed: %s", exc)
        return None


def extract_avatar_from_pdf(file_bytes: bytes) -> Optional[str]:
    """从 PDF 抽取头像。

    新逻辑：先把首页渲染成 PNG（pdfium），再在渲染图上按色相挑最像真人照片的候选框。
    渲染失败时回退到旧版 pypdf `page.images` 启发式（处理不常见但能跑通的嵌入图场景）。
    """
    png_bytes = _render_first_page_png(file_bytes)
    if png_bytes:
        result = find_avatar_region(png_bytes)
        if result:
            return result
    return _extract_avatar_from_pdf_legacy(file_bytes)


def extract_avatar_from_scanned(png_bytes: bytes) -> Optional[str]:
    """扫描件 / OCR 分支专用：首页 PNG 已经渲染好，直接在渲染图上找头像。"""
    return find_avatar_region(png_bytes)


def extract_avatar_from_docx(file_bytes: bytes) -> Optional[str]:
    """从 DOCX 里挑最像真人头像的图片，保存后返回 URL。

    之前版本直接取 word/media/ 下第一张图，但中文简历里第一张经常是
    学校 logo / 装饰 banner / 课程截图，会被错认成头像。这里改成对所有
    图片统一调用 _score_photo_image 打分（最小边 + 长宽比 + 色相丰富度），
    挑最高分那张；都不达标则返回 None，让调用方回退到 user.resume_avatar_url。
    """
    try:
        from docx import Document
    except Exception as exc:
        logger.warning("avatar extractor: python-docx not available: %s", exc)
        return None
    try:
        doc = Document(io.BytesIO(file_bytes))
    except Exception as exc:
        logger.info("avatar extractor: failed to open docx: %s", exc)
        return None

    ext_map = {
        "image/jpeg": ".jpg",
        "image/jpg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/bmp": ".bmp",
        "image/tiff": ".tiff",
    }
    candidates: list[Tuple[float, bytes, str]] = []
    for rel in doc.part.rels.values():
        target = getattr(rel, "target_part", None)
        if target is None:
            continue
        content_type = (getattr(target, "content_type", "") or "")
        if not content_type.startswith("image/"):
            continue
        raw = target.blob
        if not raw:
            continue
        ext = ext_map.get(content_type.split(";")[0].strip().lower(), ".png")
        try:
            with Image.open(io.BytesIO(raw)) as pil_img:
                pil_img.load()
                score = _score_photo_image(pil_img)
        except Exception as exc:
            logger.info("avatar extractor: docx image decode failed: %s", exc)
            continue
        if score < 0:
            continue
        normalized = _normalize_extracted_bytes(raw, ext)
        if not normalized:
            continue
        encoded, final_ext = normalized
        candidates.append((score, encoded, final_ext))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    _, encoded, final_ext = candidates[0]
    try:
        return save_extracted_avatar(encoded, final_ext)
    except Exception as exc:
        logger.warning("avatar extractor: save failed: %s", exc)
        return None
