from __future__ import annotations

import json
import re
import unicodedata
from hashlib import sha256
from pathlib import Path
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.skills.models import SkillAsset
from app.skills.schemas import SkillCreateRequest, SkillResponse, SkillStatus, SkillUpdateRequest


FRONTMATTER_BOUNDARY = "---"
SUPPORTED_FILE_SUFFIXES = {".md", ".txt"}


def list_skills(db: Session, *, include_disabled: bool = True) -> list[SkillAsset]:
    statement = select(SkillAsset).where(SkillAsset.is_deleted.is_(False)).order_by(SkillAsset.updated_at.desc())
    if not include_disabled:
        statement = statement.where(SkillAsset.status == "enabled")
    return list(db.scalars(statement).all())


def get_skill_or_404(db: Session, skill_id: int) -> SkillAsset:
    skill = db.get(SkillAsset, skill_id)
    if not skill or skill.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Skill 不存在")
    return skill


def create_skill(db: Session, payload: SkillCreateRequest, *, admin_id: Optional[int]) -> SkillAsset:
    settings = get_settings()
    _validate_content_size(payload.content, settings.skill_max_content_bytes)
    file_name = _safe_file_name(payload.file_name)
    metadata = _parse_skill_metadata(payload.content)
    content_hash = _content_hash(payload.content)
    name = _first_present(payload.name, metadata.get("name"), _extract_heading(payload.content), _stem_name(file_name))
    description = _first_present(payload.description, metadata.get("description"), "")
    version = _first_present(payload.version, metadata.get("version"), "1.0.0")
    category = _first_present(payload.category, metadata.get("category"), "通用")
    tags = payload.tags or _metadata_tags(metadata)
    slug = _normalize_slug(payload.slug or metadata.get("slug") or name, content_hash)

    existing = db.scalar(select(SkillAsset).where(SkillAsset.slug == slug, SkillAsset.is_deleted.is_(False)))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="同名 Skill 已存在，请换一个名称或 slug")

    file_path = _write_skill_file(slug=slug, file_name=file_name, content=payload.content)
    skill = SkillAsset(
        slug=slug,
        name=name,
        description=description,
        version=version,
        category=category,
        tags_json=json.dumps(_clean_tags(tags), ensure_ascii=False),
        status=payload.status,
        file_name=file_name,
        file_path=str(file_path),
        content_hash=content_hash,
        created_by_admin_id=admin_id,
    )
    db.add(skill)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="同名 Skill 已存在，请换一个名称或 slug") from exc
    db.refresh(skill)
    return skill


def update_skill(db: Session, skill_id: int, payload: SkillUpdateRequest) -> SkillAsset:
    settings = get_settings()
    skill = get_skill_or_404(db, skill_id)

    content = payload.content
    metadata: dict[str, Any] = {}
    if content is not None:
        _validate_content_size(content, settings.skill_max_content_bytes)
        metadata = _parse_skill_metadata(content)
        file_name = _safe_file_name(payload.file_name or skill.file_name)
        old_path = Path(skill.file_path)
        file_path = _write_skill_file(slug=skill.slug, file_name=file_name, content=content)
        if old_path != file_path and old_path.exists():
            old_path.unlink()
        skill.file_name = file_name
        skill.file_path = str(file_path)
        skill.content_hash = _content_hash(content)
    elif payload.file_name is not None:
        file_name = _safe_file_name(payload.file_name)
        if file_name != skill.file_name:
            old_path = Path(skill.file_path)
            content = _read_skill_content(skill)
            file_path = _write_skill_file(slug=skill.slug, file_name=file_name, content=content)
            if old_path != file_path and old_path.exists():
                old_path.unlink()
            skill.file_name = file_name
            skill.file_path = str(file_path)

    skill.name = _first_present(payload.name, metadata.get("name"), skill.name)
    skill.description = _first_present(payload.description, metadata.get("description"), skill.description or "")
    skill.version = _first_present(payload.version, metadata.get("version"), skill.version)
    skill.category = _first_present(payload.category, metadata.get("category"), skill.category)
    if payload.tags is not None:
        skill.tags_json = json.dumps(_clean_tags(payload.tags), ensure_ascii=False)
    elif metadata.get("tags") is not None:
        skill.tags_json = json.dumps(_clean_tags(_metadata_tags(metadata)), ensure_ascii=False)
    if payload.status is not None:
        skill.status = payload.status

    db.commit()
    db.refresh(skill)
    return skill


def set_skill_status(db: Session, skill_id: int, next_status: SkillStatus) -> SkillAsset:
    skill = get_skill_or_404(db, skill_id)
    skill.status = next_status
    db.commit()
    db.refresh(skill)
    return skill


def delete_skill(db: Session, skill_id: int) -> None:
    skill = get_skill_or_404(db, skill_id)
    skill.is_deleted = True
    skill.status = "disabled"
    db.commit()


def serialize_skill(skill: SkillAsset) -> dict[str, Any]:
    return SkillResponse(
        id=skill.id,
        slug=skill.slug,
        name=skill.name,
        description=skill.description or "",
        version=skill.version,
        category=skill.category,
        tags=_load_tags(skill.tags_json),
        status=skill.status,  # type: ignore[arg-type]
        file_name=skill.file_name,
        content=_read_skill_content(skill),
        content_hash=skill.content_hash,
        created_at=skill.created_at,
        updated_at=skill.updated_at,
    ).model_dump(mode="json")


def _parse_skill_metadata(content: str) -> dict[str, Any]:
    lines = content.splitlines()
    if not lines or lines[0].strip() != FRONTMATTER_BOUNDARY:
        return {}

    meta_lines: list[str] = []
    for line in lines[1:]:
        if line.strip() == FRONTMATTER_BOUNDARY:
            break
        meta_lines.append(line.rstrip())

    metadata: dict[str, Any] = {}
    current_list_key: Optional[str] = None
    for raw_line in meta_lines:
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("-") and current_list_key:
            metadata.setdefault(current_list_key, []).append(_strip_quotes(line[1:].strip()))
            continue
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        key = key.strip().lower().replace("-", "_")
        value = value.strip()
        if not key:
            continue
        if value == "":
            metadata[key] = []
            current_list_key = key
            continue
        metadata[key] = _parse_metadata_value(value)
        current_list_key = key if isinstance(metadata[key], list) else None
    return metadata


def _parse_metadata_value(value: str) -> str | list[str]:
    clean_value = _strip_quotes(value)
    if clean_value.startswith("[") and clean_value.endswith("]"):
        inner = clean_value[1:-1].strip()
        if not inner:
            return []
        return [_strip_quotes(item.strip()) for item in inner.split(",") if item.strip()]
    if "," in clean_value:
        return [_strip_quotes(item.strip()) for item in clean_value.split(",") if item.strip()]
    return clean_value


def _extract_heading(content: str) -> Optional[str]:
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# "):
            return stripped[2:].strip()
    return None


def _metadata_tags(metadata: dict[str, Any]) -> list[str]:
    raw = metadata.get("tags")
    if isinstance(raw, list):
        return [str(item) for item in raw]
    if isinstance(raw, str):
        return [item.strip() for item in raw.split(",")]
    return []


def _safe_file_name(file_name: str) -> str:
    clean_name = Path(file_name.strip()).name
    if not clean_name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="文件名不能为空")
    if Path(clean_name).suffix.lower() not in SUPPORTED_FILE_SUFFIXES:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Skill 文件仅支持 .md 或 .txt")
    return clean_name


def _write_skill_file(*, slug: str, file_name: str, content: str) -> Path:
    root = Path(get_settings().skill_storage_dir).expanduser().resolve()
    directory = root / slug
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / file_name
    path.write_text(content, encoding="utf-8")
    return path


def _read_skill_content(skill: SkillAsset) -> str:
    try:
        return Path(skill.file_path).read_text(encoding="utf-8")
    except OSError:
        return ""


def _validate_content_size(content: str, max_bytes: int) -> None:
    if len(content.encode("utf-8")) > max_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Skill 文件内容过大")


def _normalize_slug(value: str, fallback_hash: str) -> str:
    ascii_value = (
        unicodedata.normalize("NFKD", value)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_value).strip("-")
    if not slug:
        slug = f"skill-{fallback_hash[:10]}"
    return slug[:128].strip("-") or f"skill-{fallback_hash[:10]}"


def _content_hash(content: str) -> str:
    return sha256(content.encode("utf-8")).hexdigest()


def _first_present(*values: Any) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _stem_name(file_name: str) -> str:
    stem = Path(file_name).stem.strip()
    return stem or "Untitled Skill"


def _clean_tags(tags: list[str]) -> list[str]:
    cleaned: list[str] = []
    for tag in tags:
        value = tag.strip()
        if value and value not in cleaned:
            cleaned.append(value[:32])
    return cleaned[:20]


def _load_tags(tags_json: str) -> list[str]:
    try:
        tags = json.loads(tags_json)
    except json.JSONDecodeError:
        return []
    if not isinstance(tags, list):
        return []
    return [str(tag) for tag in tags if str(tag).strip()]


def _strip_quotes(value: str) -> str:
    if (value.startswith('"') and value.endswith('"')) or (value.startswith("'") and value.endswith("'")):
        return value[1:-1]
    return value
