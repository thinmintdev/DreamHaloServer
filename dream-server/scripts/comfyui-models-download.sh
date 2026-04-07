#!/bin/bash
set -euo pipefail

# comfyui-models-download.sh — Download essential ComfyUI model checkpoints
# Idempotent: skips files that already exist.
# Usage: DREAM_DATA_DIR=./data bash scripts/comfyui-models-download.sh

CHECKPOINTS_DIR="${DREAM_DATA_DIR:-./data}/comfyui/models/checkpoints"

SDXL_LIGHTNING_URL="https://huggingface.co/ByteDance/SDXL-Lightning/resolve/main/sdxl_lightning_4step.safetensors"
SDXL_LIGHTNING_FILE="sdxl_lightning_4step.safetensors"

mkdir -p "${CHECKPOINTS_DIR}"

download_if_missing() {
  local url="$1"
  local dest="$2"
  local filename
  filename="$(basename "${dest}")"

  if [[ -f "${dest}" ]]; then
    echo "  [skip] ${filename} already exists"
    return 0
  fi

  echo "  [download] ${filename}"
  curl --location --progress-bar --output "${dest}" "${url}"
  echo "  [done] ${filename}"
}

echo "=== ComfyUI model download ==="
echo "Destination: ${CHECKPOINTS_DIR}"
echo ""

download_if_missing \
  "${SDXL_LIGHTNING_URL}" \
  "${CHECKPOINTS_DIR}/${SDXL_LIGHTNING_FILE}"

echo ""
echo "=== Summary ==="
echo "Checkpoints directory: ${CHECKPOINTS_DIR}"
du -sh "${CHECKPOINTS_DIR}" 2>/dev/null || true
echo "Done."
