#!/usr/bin/env bash
#
# Package the built dist/ into GitHub Release assets.
#
# Produces, in <outdir> (default: release-assets/):
#   - main.js, manifest.json, styles.css   (loose files; Obsidian BRAT downloads these three)
#   - obsidian-drawio-<version>.zip         (full plugin folder incl. iframe-init.js + drawio/;
#                                            for manual install and until BRAT can fetch the
#                                            bundled draw.io web app)
#
# Usage: scripts/package-plugin.sh <version> [outdir]
#   <version>  Version string stamped into the released manifest.json (e.g. 1.2.3 or
#              0.1.0-nightly.202607060300). BRAT / Obsidian compare this to detect updates.
#
# Requires: a completed `pnpm build` (dist/ present) and `zip` on PATH.
set -euo pipefail

VERSION="${1:?usage: package-plugin.sh <version> [outdir]}"
OUTDIR="${2:-release-assets}"
PLUGIN_ID="obsidian-drawio"

if [ ! -f dist/main.js ] || [ ! -d dist/drawio ]; then
  echo "error: dist/ is not built — run 'pnpm build' first" >&2
  exit 1
fi

# Stamp the release version into the built manifest so BRAT / Obsidian see the new version.
node -e '
  const fs = require("fs");
  const p = "dist/manifest.json";
  const m = JSON.parse(fs.readFileSync(p, "utf8"));
  m.version = process.argv[1];
  fs.writeFileSync(p, JSON.stringify(m, null, 2) + "\n");
' "$VERSION"

rm -rf "$OUTDIR"
mkdir -p "$OUTDIR"
OUT_ABS="$(cd "$OUTDIR" && pwd)"

# Loose files: the three assets BRAT knows how to download.
cp dist/main.js dist/manifest.json dist/styles.css "$OUTDIR"/

# Full plugin zip: extracts to <vault>/.obsidian/plugins/obsidian-drawio/ for a working manual install.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$PLUGIN_ID"
cp dist/main.js dist/manifest.json dist/styles.css dist/iframe-init.js "$STAGE/$PLUGIN_ID"/
cp -r dist/drawio "$STAGE/$PLUGIN_ID"/
( cd "$STAGE" && zip -rq "$OUT_ABS/${PLUGIN_ID}-${VERSION}.zip" "$PLUGIN_ID" )

echo "Packaged version $VERSION into $OUTDIR:"
ls -la "$OUTDIR"
