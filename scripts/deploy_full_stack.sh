#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "${ROOT_DIR}"
docker compose up -d --build

if [[ "${DEPLOY_DIFY:-0}" == "1" ]]; then
  "${ROOT_DIR}/scripts/deploy_dify_official.sh"
fi
