#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${REPO_ROOT}/.obsidian-unpacked"
DEFAULT_APP_PATH="/Applications/Obsidian.app"

usage() {
  echo "Usage: $0 [--ci]"
  echo ""
  echo "  (no flags)  Extract from installed Obsidian.app (default: ${DEFAULT_APP_PATH})"
  echo "  --ci        Download Obsidian DMG via gh CLI to .obsidian-app/ and extract"
  echo ""
  echo "Env:"
  echo "  OBSIDIAN_APP_PATH   Override path to Obsidian.app to extract from"
  echo "  OBSIDIAN_VERSION    Obsidian release tag for --ci mode (default: 1.12.7)"
  echo ""
  echo "Note: E2E runtime state is isolated via --user-data-dir at launch time"
  echo "      (see tests/helpers/obsidian-launch.ts), so the user's installed"
  echo "      Obsidian state is not affected even when extracting from it."
  exit 1
}

extract_asar() {
  local app_path="$1"
  local asar_src="${app_path}/Contents/Resources/app.asar"
  local obsidian_asar="${app_path}/Contents/Resources/obsidian.asar"

  if [[ ! -f "${asar_src}" ]]; then
    echo "error: app.asar not found at ${asar_src}" >&2
    exit 1
  fi
  if [[ ! -f "${obsidian_asar}" ]]; then
    echo "error: obsidian.asar not found at ${obsidian_asar}" >&2
    exit 1
  fi

  echo "🔧 Extracting app.asar to ${OUT_DIR}"
  rm -rf "${OUT_DIR}"
  mkdir -p "${OUT_DIR}"
  npx --yes @electron/asar extract "${asar_src}" "${OUT_DIR}"
  cp "${obsidian_asar}" "${OUT_DIR}/obsidian.asar"

  local size
  size="$(stat -f%z "${OUT_DIR}/obsidian.asar" 2>/dev/null || echo 0)"
  if [[ "${size}" -lt 1000000 ]]; then
    echo "warning: obsidian.asar is only ${size} bytes (expected >1MB)." >&2
    echo "         The .dmg may ship a bootstrap stub. Use installed Obsidian.app instead." >&2
  fi
  echo "✅ Unpacked: ${OUT_DIR} (obsidian.asar: ${size} bytes)"
}

download_obsidian_app() {
  if ! command -v gh &>/dev/null; then
    echo "error: gh CLI not found. Install via: brew install gh" >&2
    exit 1
  fi

  local version="${OBSIDIAN_VERSION:-1.12.7}"
  local dmg_dir="${REPO_ROOT}/.tmp/obsidian-dmg"
  local app_dir="${REPO_ROOT}/.obsidian-app"
  local app_path="${app_dir}/Obsidian.app"

  rm -rf "${dmg_dir}"
  mkdir -p "${dmg_dir}"

  # All progress output goes to stderr so the function's stdout is just the
  # final app path that the caller captures via $(download_obsidian_app).
  echo "⬇️  Downloading Obsidian v${version} DMG..." >&2
  gh release download -R obsidianmd/obsidian-releases "v${version}" \
    --pattern "Obsidian-*.dmg" \
    --dir "${dmg_dir}" >&2

  local dmg_file
  dmg_file="$(ls "${dmg_dir}"/Obsidian-*.dmg | head -1)"
  if [[ -z "${dmg_file}" || ! -f "${dmg_file}" ]]; then
    echo "error: no Obsidian-*.dmg downloaded into ${dmg_dir}" >&2
    exit 1
  fi

  echo "💿 Mounting ${dmg_file}..." >&2
  local mount_point
  mount_point="$(hdiutil attach "${dmg_file}" -nobrowse -readonly | grep -Eo '/Volumes/.*$' | head -1)"

  if [[ -z "${mount_point}" || ! -d "${mount_point}/Obsidian.app" ]]; then
    [[ -n "${mount_point}" ]] && hdiutil detach "${mount_point}" &>/dev/null || true
    echo "error: Obsidian.app not found in mounted DMG (mount_point='${mount_point}')" >&2
    exit 1
  fi

  echo "📦 Copying Obsidian.app to ${app_path}" >&2
  rm -rf "${app_path}"
  mkdir -p "${app_dir}"
  cp -R "${mount_point}/Obsidian.app" "${app_path}"
  hdiutil detach "${mount_point}" >&2
  rm -rf "${dmg_dir}"

  # The single stdout line is the resolved app path.
  echo "${app_path}"
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
  app_path="$(download_obsidian_app)"
  extract_asar "${app_path}"
else
  app_path="${OBSIDIAN_APP_PATH:-${DEFAULT_APP_PATH}}"
  if [[ ! -d "${app_path}" ]]; then
    echo "error: Obsidian.app not found at ${app_path}." >&2
    echo "       Set OBSIDIAN_APP_PATH or run with --ci to download." >&2
    exit 1
  fi
  echo "🔗 Using ${app_path}"
  extract_asar "${app_path}"
fi
