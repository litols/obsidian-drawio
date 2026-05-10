#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/.obsidian-unpacked"
OBSIDIAN_APP_PATH="${OBSIDIAN_APP_PATH:-/Applications/Obsidian.app}"

usage() {
  echo "Usage: $0 [--ci]"
  echo ""
  echo "  (no flags)  Extract from local Obsidian.app"
  echo "  --ci        Download Obsidian DMG from GitHub Releases (requires OBSIDIAN_VERSION and gh CLI)"
  exit 1
}

check_gh() {
  if ! command -v gh &>/dev/null; then
    echo "error: gh CLI not found. Install via: brew install gh" >&2
    exit 1
  fi
}

extract_asar() {
  local app_path="$1"
  local asar_src="${app_path}/Contents/Resources/app.asar"

  if [[ ! -f "${asar_src}" ]]; then
    echo "error: app.asar not found at ${asar_src}" >&2
    exit 1
  fi

  echo "🔧 Extracting Obsidian app.asar to .obsidian-unpacked/"

  rm -rf "${OUT_DIR}"
  mkdir -p "${OUT_DIR}"

  npx --yes @electron/asar extract "${asar_src}" "${OUT_DIR}"

  cp "${asar_src}" "${OUT_DIR}/obsidian.asar"

  echo "✅ Done: ${OUT_DIR}"
}

CI_MODE=false
for arg in "$@"; do
  case "$arg" in
    --ci) CI_MODE=true ;;
    --help|-h) usage ;;
    *) echo "error: unknown argument: $arg" >&2; usage ;;
  esac
done

if [[ "${CI_MODE}" == true ]]; then
  if [[ -z "${OBSIDIAN_VERSION:-}" ]]; then
    echo "error: --ci requires OBSIDIAN_VERSION env to be set. Example: OBSIDIAN_VERSION=1.7.7" >&2
    exit 1
  fi

  check_gh

  DMG_DIR="${REPO_ROOT}/.tmp/obsidian-dmg"
  rm -rf "${DMG_DIR}"
  mkdir -p "${DMG_DIR}"

  echo "⬇️  Downloading Obsidian v${OBSIDIAN_VERSION} DMG..."
  gh release download -R obsidianmd/obsidian-releases "v${OBSIDIAN_VERSION}" \
    --pattern "Obsidian-*.dmg" \
    --dir "${DMG_DIR}"

  DMG_FILE="$(ls "${DMG_DIR}"/Obsidian-*.dmg | head -1)"
  if [[ -z "${DMG_FILE}" ]]; then
    echo "error: DMG file not found after download" >&2
    exit 1
  fi

  echo "💿 Mounting ${DMG_FILE}..."
  MOUNT_POINT="$(hdiutil attach "${DMG_FILE}" -nobrowse -readonly | awk '/\/Volumes\//{print $NF}')"

  if [[ -z "${MOUNT_POINT}" ]]; then
    echo "error: failed to mount DMG" >&2
    exit 1
  fi

  APP_PATH="$(ls -d "${MOUNT_POINT}"/Obsidian.app 2>/dev/null || true)"
  if [[ -z "${APP_PATH}" ]]; then
    hdiutil detach "${MOUNT_POINT}" &>/dev/null || true
    echo "error: Obsidian.app not found in mounted DMG at ${MOUNT_POINT}" >&2
    exit 1
  fi

  extract_asar "${APP_PATH}"

  echo "💿 Unmounting..."
  hdiutil detach "${MOUNT_POINT}"

  rm -rf "${DMG_DIR}"

else
  if [[ ! -d "${OBSIDIAN_APP_PATH}" ]]; then
    echo "error: Obsidian.app not found at ${OBSIDIAN_APP_PATH}. Set OBSIDIAN_APP_PATH or install Obsidian." >&2
    exit 1
  fi

  extract_asar "${OBSIDIAN_APP_PATH}"
fi
