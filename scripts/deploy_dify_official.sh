#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_DIR="${ROOT_DIR}/.stack/dify"
DOCKER_DIR="${STACK_DIR}/docker"
DIFY_VERSION="${DIFY_VERSION:-1.14.2}"

mkdir -p "${ROOT_DIR}/.stack"

if [[ ! -d "${STACK_DIR}/.git" ]]; then
  git clone https://github.com/langgenius/dify.git "${STACK_DIR}"
fi

git -C "${STACK_DIR}" fetch --tags --force
git -C "${STACK_DIR}" checkout "${DIFY_VERSION}"

cd "${DOCKER_DIR}"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

python3 - <<'PY'
from pathlib import Path

path = Path(".env")
content = path.read_text(encoding="utf-8")
replacements = {
    "EXPOSE_NGINX_PORT=80": "EXPOSE_NGINX_PORT=18080",
    "EXPOSE_NGINX_SSL_PORT=443": "EXPOSE_NGINX_SSL_PORT=18443",
}
for old, new in replacements.items():
    if old in content:
        content = content.replace(old, new)
    elif new not in content:
        content += f"\n{new}\n"
path.write_text(content, encoding="utf-8")
PY

docker compose -p zhipei-dify up -d
