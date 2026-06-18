"""简历/账号头像的文件落盘工具。

复用现有 `data/avatars/` 目录与 `/static/avatars/` 静态挂载，
保证历史头像 URL 不失效。所有写盘操作都走这一层，方便测试时
通过 monkeypatch 重定向到临时目录。
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from typing import Optional

# 与 app/main.py 中的 StaticFiles 挂载保持一致。
AVATAR_DIR: Path = Path(os.environ.get("CAREERFORGE_AVATAR_DIR", "/app/data/avatars"))
ALLOWED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
MAX_AVATAR_SIZE = 2 * 1024 * 1024

# 抽取出的图片统一压到不超过 600x600，避免大文件拖慢前端渲染。
MAX_AVATAR_DIMENSION = 600


def ensure_dir() -> None:
    AVATAR_DIR.mkdir(parents=True, exist_ok=True)


def _normalize_ext(filename: str, default: str = ".png") -> str:
    ext = Path(filename or "").suffix.lower()
    if ext in ALLOWED_EXTENSIONS:
        return ext
    return default


def save_uploaded_avatar(content: bytes, original_filename: str) -> str:
    """把上传的头像字节写到磁盘，返回形如 /static/avatars/xxx.png 的 URL。"""
    ext = _normalize_ext(original_filename)
    ensure_dir()
    filename = f"resume-{uuid.uuid4().hex}{ext}"
    (AVATAR_DIR / filename).write_bytes(content)
    return f"/static/avatars/{filename}"


def save_extracted_avatar(content: bytes, suffix: str) -> str:
    """导入简历时抽取出的图片保存。suffix 形如 .png / .jpg。"""
    ext = suffix.lower() if suffix.startswith(".") else f".{suffix.lower()}"
    if ext not in ALLOWED_EXTENSIONS:
        ext = ".png"
    ensure_dir()
    filename = f"imported-{uuid.uuid4().hex}{ext}"
    (AVATAR_DIR / filename).write_bytes(content)
    return f"/static/avatars/{filename}"


def delete_avatar_file(url: Optional[str]) -> None:
    if not url:
        return
    name = Path(url).name
    if not name:
        return
    try:
        (AVATAR_DIR / name).unlink(missing_ok=True)
    except OSError:
        # 文件不存在/权限问题都不影响主流程
        pass