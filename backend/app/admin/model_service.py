"""模型广场 + 系统设置 — 业务逻辑层"""
from __future__ import annotations

import json
import base64
import re
import time
from typing import Optional

import httpx
from fastapi import HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.admin.models import ModelConfig, ModelTestLog, SystemConfig
from app.admin.schemas import ModelCreate, ModelUpdate, ModelListQuery, ModelResponse, ModelTestResponse


# ── API Key 加解密（base64，后续可升级 AES） ─────

def encrypt_api_key(plain: str) -> str:
    return base64.urlsafe_b64encode(plain.encode("utf-8")).decode("utf-8")


def decrypt_api_key(cipher: str) -> str:
    return base64.urlsafe_b64decode(cipher.encode("utf-8")).decode("utf-8")


# → 测试连接失败中文翻译：HTTP 状态码 / response_body 关键词 → 人词化描述。
HTTP_STATUS_HINTS_CN: dict = {
    400: '请求格式错误（参数有误）',
    402: '需要付费或余额不足，请充值或更换 Key',
    401: '认证失败（API Key 无效、过期或错误）',
    403: '权限不足或禁止访问',
    404: '接口地址不存在，请检查 Base URL 和模型名称',
    408: '请求超时',
    413: '请求内容过大',
    429: '请求频率过高或配额用尽',
    500: '供应商服务器内部错误',
    502: '供应商网关错误',
    503: '供应商服务暂时不可用',
    504: '供应商网关超时',
}

KEYWORD_HINTS_CN: list = [
    # 认证 / API Key（最具体，优先匹配）
    (re.compile(r'authentication\s*(?:fails?|failure)?|unauthorized|invalid[_\s-]?(?:api[_\s-]?)?key|invalid[_\s-]?token|invalid[_\s-]?auth|api[_\s-]?key[_\s-]?(?:invalid|error|expired|wrong|missing)|凭证|令牌', re.I), '认证失败：API Key 无效、过期或错误'),
    # 余额不足 / 配额用尽
    (re.compile(r'insufficient[_\s-]?(?:quota|balance|credits?)|quota[_\s-]?exceeded|balance[_\s-]?(?:not[_\s-]?enough|insufficient)|payment[_\s-]?required|out[_\s-]?of[_\s-]?credits?|余额|欠费|额度', re.I), '余额不足或配额用尽，请充值或更换 Key'),
    # 请求频率超限
    (re.compile(r'rate[_\s-]?limit[_\s-]?(?:exceeded|reached)?|too[_\s-]?many[_\s-]?requests|requests[_\s-]?per[_\s-]?(?:minute|second|day)|频率超限', re.I), '请求频率过高，请稍后重试'),
    # 模型不存在
    (re.compile(r'model[_\s-]?not[_\s-]?found|unknown[_\s-]?model|no[_\s-]?such[_\s-]?model|the[_\s-]?model[_\s-]?does[_\s-]?not[_\s-]?exist|invalid[_\s-]?model', re.I), '模型不存在，请检查模型名称'),
    # 上下文长度超限
    (re.compile(r'context[_\s-]?length[_\s-]?(?:exceeded|limit)|max[_\s-]?context[_\s-]?length|too[_\s-]?many[_\s-]?tokens', re.I), '上下文长度超限，请减少输入'),
    # 请求参数错误
    (re.compile(r'bad[_\s-]?request|invalid[_\s-]?request[_\s-]?(?:format|body)?', re.I), '请求参数错误'),
    # 资源 / 接口不存在（不包含 model not found，那个优先）
    (re.compile(r'resource[_\s-]?not[_\s-]?found|endpoint[_\s-]?not[_\s-]?found|资源不存在|接口不存在', re.I), '资源或接口不存在'),

]

def enrich_error_with_cn(http_status, response_body, base_msg):
    """给错误摘要加中文解释：
    1) response_body 关键词匹配优先（具体场景如 “余额不足”、“API Key 失效”、“模型不存在”）；
    2) 关键词未命中时才用 HTTP 状态码 hint；
    3) 都没有则返回 base_msg。"""
    cn_hint = ''
    if response_body:
        for pat, hint in KEYWORD_HINTS_CN:
            if pat.search(response_body):
                cn_hint = hint
                break
    if not cn_hint and http_status in HTTP_STATUS_HINTS_CN:
        cn_hint = HTTP_STATUS_HINTS_CN[http_status]
    if not cn_hint:
        return base_msg
    if base_msg and base_msg not in cn_hint:
        return f'{cn_hint}（{base_msg}）'
    return cn_hint


# ── 模型 CRUD ────────────────────────────────────

def list_models(db: Session, query: ModelListQuery) -> dict:
    stmt = select(ModelConfig).where(ModelConfig.is_deleted == False)
    if query.capability:
        stmt = stmt.where(ModelConfig.capability == query.capability)
    if query.status:
        stmt = stmt.where(ModelConfig.status == query.status)
    if query.open_to_student is not None:
        stmt = stmt.where(ModelConfig.open_to_student == query.open_to_student)
    if query.keyword:
        kw = f"%{query.keyword}%"
        stmt = stmt.where(
            (ModelConfig.display_name.ilike(kw))
            | (ModelConfig.model_identifier.ilike(kw))
            | (ModelConfig.provider.ilike(kw))
        )
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(ModelConfig.created_at.desc()).offset((query.page - 1) * query.size).limit(query.size)).all()
    return {"list": [ModelResponse.model_validate(r) for r in rows], "total": total or 0, "page": query.page, "size": query.size}


def create_model(db: Session, payload: ModelCreate) -> ModelResponse:
    model = ModelConfig(
        display_name=payload.display_name, provider=payload.provider, deploy_type=payload.deploy_type,
        capability=payload.capability, protocols=payload.protocols, base_url=payload.base_url,
        api_key_cipher=encrypt_api_key(payload.api_key) if payload.api_key else None,
        model_identifier=payload.model_identifier, dify_model_ref=payload.dify_model_ref,
        context_length=payload.context_length, default_temp=payload.default_temp,
        max_output=payload.max_output, timeout_sec=payload.timeout_sec,
        open_to_student=payload.open_to_student,
    )
    db.add(model); db.commit(); db.refresh(model)
    return ModelResponse.model_validate(model)


def _get_model(db: Session, model_id: int) -> ModelConfig:
    model = db.scalar(select(ModelConfig).where(ModelConfig.id == model_id, ModelConfig.is_deleted == False))
    if not model:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="模型不存在")
    return model


def get_model_detail(db: Session, model_id: int) -> ModelResponse:
    return ModelResponse.model_validate(_get_model(db, model_id))


def update_model(db: Session, model_id: int, payload: ModelUpdate) -> ModelResponse:
    model = _get_model(db, model_id)
    update_data = payload.model_dump(exclude_unset=True)
    if "api_key" in update_data:
        key = update_data.pop("api_key")
        update_data["api_key_cipher"] = encrypt_api_key(key) if key else None
    for field, value in update_data.items():
        setattr(model, field, value)
    db.commit(); db.refresh(model)
    return ModelResponse.model_validate(model)


def delete_model(db: Session, model_id: int) -> None:
    _get_model(db, model_id).is_deleted = True
    db.commit()


def toggle_open(db: Session, model_id: int, open_flag: bool) -> ModelResponse:
    model = _get_model(db, model_id)
    model.open_to_student = open_flag
    db.commit(); db.refresh(model)
    return ModelResponse.model_validate(model)


# ── 测试连接 ────────────────────────────────────

async def test_model_connection(db, model_id):
    model = _get_model(db, model_id)
    api_key = decrypt_api_key(model.api_key_cipher) if model.api_key_cipher else None
    success, latency_ms = False, None
    error_message = None
    error_summary = None
    http_status = None
    response_body = None
    request_url = ''

    base_url = (model.base_url or '').rstrip('/')
    if model.protocols and 'anthropic' in (model.protocols or '').lower():
        request_url = base_url + '/v1/messages'
    else:
        request_url = base_url + '/chat/completions'
    payload = {
        'model': model.model_identifier,
        'messages': [{'role': 'user', 'content': 'hi'}],
        'max_tokens': 16,
        'temperature': 0,
    }

    headers = {'Content-Type': 'application/json', 'User-Agent': 'CareerForge-ModelTest/1.0'}
    if api_key:
        headers['Authorization'] = 'Bearer ' + api_key

    try:
        start = time.perf_counter()
        async with httpx.AsyncClient(timeout=httpx.Timeout(model.timeout_sec or 30)) as client:
            resp = await client.post(request_url, headers=headers, json=payload)
        latency_ms = int((time.perf_counter() - start) * 1000)
        http_status = resp.status_code
        try:
            response_body = resp.text[:8000]
        except Exception:
            response_body = ''

        parsed = None
        try:
            parsed = resp.json()
        except Exception:
            parsed = None

        success = 200 <= resp.status_code < 300

        if success and isinstance(parsed, dict):
            err_obj = parsed.get('error')
            if err_obj:
                success = False
                if isinstance(err_obj, dict):
                    err_msg = err_obj.get('message') or err_obj.get('type') or json.dumps(err_obj, ensure_ascii=False)[:300]
                    err_code = err_obj.get('code') or err_obj.get('type')
                else:
                    err_msg = str(err_obj)[:300]
                    err_code = None
                error_summary = err_msg
                error_message = (f'[{err_code}] {err_msg}' if err_code else err_msg)
            elif not (parsed.get('choices') or parsed.get('content') or parsed.get('message')):
                success = False
                error_summary = '响应缺少 choices/content 字段'
                error_message = error_summary

        if not success and not error_message:
            # HTTP 非 2xx：尝试从 response_body 提取详细错误信息
            extracted = None
            if response_body:
                try:
                    j = json.loads(response_body) if response_body.lstrip().startswith(('{', '[')) else None
                    if isinstance(j, dict):
                        err_obj = j.get('error')
                        if isinstance(err_obj, dict):
                            extracted = err_obj.get('message') or err_obj.get('type') or json.dumps(err_obj, ensure_ascii=False)[:300]
                        elif err_obj is not None:
                            extracted = str(err_obj)[:300]
                        elif j.get('message'):
                            extracted = j['message']
                except Exception:
                    pass
                # JSON 解析失败但是短文本（< 300 字符），直接用作错误消息
                if not extracted and response_body and len(response_body) < 300:
                    extracted = response_body.strip()
            if extracted:
                base = f'HTTP {resp.status_code}: {extracted[:300]}'
                error_summary = enrich_error_with_cn(resp.status_code, response_body, base)
                error_message = error_summary
            else:
                base = 'HTTP ' + str(resp.status_code)
                error_summary = enrich_error_with_cn(resp.status_code, response_body, base)
                error_message = error_summary
    except httpx.TimeoutException:
        msg = f'连接超时 ({model.timeout_sec or 30}s)'
        error_summary = enrich_error_with_cn(None, None, msg)
        error_message = error_summary
    except httpx.ConnectError as e:
        msg = f'无法连接到目标地址: {str(e)[:200]}'
        error_summary = enrich_error_with_cn(None, None, msg)
        error_message = error_summary
    except Exception as e:
        msg = str(e)[:500]
        error_summary = enrich_error_with_cn(None, None, msg)
        error_message = error_summary

    log_entry = ModelTestLog(model_id=model.id, success=success, latency_ms=latency_ms, error_message=error_message)
    db.add(log_entry); db.commit(); db.refresh(log_entry)
    return ModelTestResponse(
        success=log_entry.success, latency_ms=log_entry.latency_ms, error_message=log_entry.error_message,
        model_id=log_entry.model_id, tested_at=log_entry.tested_at,
        http_status=http_status, response_body=response_body, request_url=request_url,
        error_summary=error_summary,
    )

async def test_batch(db: Session) -> list[ModelTestResponse]:
    models = db.scalars(select(ModelConfig).where(ModelConfig.is_deleted == False)).all()
    results = []
    for model in models:
        results.append(await test_model_connection(db, model.id))
    return results


# ── 种子数据 ────────────────────────────────────

DEFAULT_MODELS = [
    {
        "display_name": "DeepSeek V4 Pro",
        "provider": "DeepSeek",
        "deploy_type": "cloud",
        "capability": "chat",
        "protocols": "openai",
        "base_url": "https://api.deepseek.com/v1",
        "model_identifier": "deepseek-v4-pro",
        "context_length": 131072,
        "default_temp": 0.7,
        "max_output": 32768,
        "timeout_sec": 120,
        "open_to_student": False,
    },
    {
        "display_name": "DeepSeek V4 Flash",
        "provider": "DeepSeek",
        "deploy_type": "cloud",
        "capability": "chat",
        "protocols": "openai",
        "base_url": "https://api.deepseek.com/v1",
        "model_identifier": "deepseek-v4-flash",
        "context_length": 131072,
        "default_temp": 0.7,
        "max_output": 32768,
        "timeout_sec": 120,
        "open_to_student": False,
    },
    {
        "display_name": "DeepSeek Chat (V3)",
        "provider": "DeepSeek",
        "deploy_type": "cloud",
        "capability": "chat",
        "protocols": "openai",
        "base_url": "https://api.deepseek.com/v1",
        "model_identifier": "deepseek-chat",
        "context_length": 65536,
        "default_temp": 0.7,
        "max_output": 8192,
        "timeout_sec": 120,
        "open_to_student": True,
    },
]


def seed_default_models(db: Session) -> None:
    """首次启动时预置模型广场默认模型（仅当 model_config 表为空时执行）"""
    existing = db.scalar(select(func.count()).select_from(ModelConfig).where(ModelConfig.is_deleted == False))
    if existing and existing > 0:
        return

    for item in DEFAULT_MODELS:
        model = ModelConfig(
            display_name=item["display_name"],
            provider=item["provider"],
            deploy_type=item["deploy_type"],
            capability=item["capability"],
            protocols=item["protocols"],
            base_url=item["base_url"],
            api_key_cipher=None,  # API Key 需管理员手动配置
            model_identifier=item["model_identifier"],
            context_length=item["context_length"],
            default_temp=item["default_temp"],
            max_output=item["max_output"],
            timeout_sec=item["timeout_sec"],
            open_to_student=item["open_to_student"],
            status="active",
        )
        db.add(model)
    db.commit()


# ── 系统配置 ────────────────────────────────────

DEFAULT_CONFIG: dict[str, str] = {
    "platform_name": "智培职联",
    "maintenance_mode": "false",
    "maintenance_message": "系统维护中，请稍后再试",
    "announcement": "",
    "announcement_enabled": "false",
}



# ── 公告管理 ─────────────────────────────────────

from app.admin.models import Announcement
from app.admin.schemas import AnnouncementCreate, AnnouncementUpdate, AnnouncementResponse, AnnouncementListResponse


def list_announcements(db: Session, page: int = 1, size: int = 20, active_only: bool = False) -> AnnouncementListResponse:
    stmt = select(Announcement)
    if active_only:
        stmt = stmt.where(Announcement.is_active == True)
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(Announcement.priority.desc(), Announcement.created_at.desc()).offset((page - 1) * size).limit(size)).all()
    return AnnouncementListResponse(
        list=[AnnouncementResponse.model_validate(r) for r in rows],
        total=total or 0,
    )


def create_announcement(db: Session, payload: AnnouncementCreate, user_id: int | None = None) -> AnnouncementResponse:
    ann = Announcement(
        title=payload.title,
        content=payload.content,
        announcement_type=payload.announcement_type,
        priority=payload.priority,
        is_active=payload.is_active,
        start_time=payload.start_time,
        end_time=payload.end_time,
        created_by=user_id,
    )
    db.add(ann); db.commit(); db.refresh(ann)
    return AnnouncementResponse.model_validate(ann)


def get_announcement(db: Session, ann_id: int) -> AnnouncementResponse:
    ann = db.scalar(select(Announcement).where(Announcement.id == ann_id))
    if not ann:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
    return AnnouncementResponse.model_validate(ann)


def update_announcement(db: Session, ann_id: int, payload: AnnouncementUpdate) -> AnnouncementResponse:
    ann = db.scalar(select(Announcement).where(Announcement.id == ann_id))
    if not ann:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
    update_data = payload.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(ann, field, value)
    db.commit(); db.refresh(ann)
    return AnnouncementResponse.model_validate(ann)


def delete_announcement(db: Session, ann_id: int) -> None:
    ann = db.scalar(select(Announcement).where(Announcement.id == ann_id))
    if not ann:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Announcement not found")
    db.delete(ann)
    db.commit()

def get_all_config(db: Session) -> dict[str, str | None]:
    rows = db.scalars(select(SystemConfig)).all()
    config = {r.config_key: r.config_value for r in rows}
    for key, value in DEFAULT_CONFIG.items():
        if key not in config:
            config[key] = value
    return config


def update_config(db: Session, items: list[dict]) -> dict[str, str | None]:
    for item in items:
        key = item["config_key"]
        value = item.get("config_value")
        row = db.scalar(select(SystemConfig).where(SystemConfig.config_key == key))
        if row:
            row.config_value = value
        else:
            db.add(SystemConfig(config_key=key, config_value=value))
    db.commit()
    return get_all_config(db)
