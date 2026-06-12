"""LLM bridge — fetches LLM client from the main agent system.

This module isolates the LLM dependency so that service.py and
harness.py never import from app.student or app.core directly.
"""
from __future__ import annotations

from app.admin.models import ModelConfig


def get_llm_client():  # noqa: ANN201
    """Return the main agent system's LLM client."""
    from app.core.llm_client import chat_completion
    return chat_completion


def build_model_fallback_chain(
    models: list[ModelConfig],
    system_prompt: str,
    *,
    temperature: float = 0.35,
    max_tokens: int = 2500,
):
    """Build a fallback chain that tries models in order."""
    from app.core.llm_client import chat_completion as _cc

    def _chain(prompt: str, *, context: dict | None = None):
        for model in models:
            try:
                result = _cc(
                    model,
                    system_prompt=system_prompt,
                    variables={},
                    memory=[],
                    user_message=prompt,
                    temperature=temperature,
                    max_tokens=max_tokens,
                )
                return result
            except Exception:
                continue
        return None
    return _chain
