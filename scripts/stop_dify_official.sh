#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_DIR="${ROOT_DIR}/.stack/dify/docker"

if [[ -d "${DOCKER_DIR}" ]]; then
  cd "${DOCKER_DIR}"
  docker compose -p zhipei-dify down
fi
