// Dist smoke test: asserts that all required build artifacts exist after pnpm build.
// Requirements 3.4 (Apache-2.0 bundling), 4.1 (all assets included), 4.3 (VERSION present).
// Exit 0 on success, exit 1 with a list of missing paths on failure.

import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");

/** Paths that must exist as files (or any filesystem entry via access). */
const requiredFiles = [
  "dist/main.js",
  "dist/iframe-init.js",
  "dist/manifest.json",
  "dist/styles.css",
  "dist/drawio/index.html",
  "dist/drawio/LICENSE",
  "dist/drawio/NOTICE",
  "dist/drawio/CHANGES.md",
  "dist/drawio/VERSION",
];

/** Directories that must contain at least 1 file. */
const requiredNonEmptyDirs = [
  "dist/drawio/js",
  "dist/drawio/styles",
  "dist/drawio/images",
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function hasEntries(p) {
  try {
    const entries = await readdir(p);
    return entries.length > 0;
  } catch {
    return false;
  }
}

const missing = [];

for (const rel of requiredFiles) {
  const abs = join(root, rel);
  if (!(await exists(abs))) {
    missing.push(rel);
  }
}

for (const rel of requiredNonEmptyDirs) {
  const abs = join(root, rel);
  if (!(await hasEntries(abs))) {
    missing.push(`${rel}/ (must contain at least 1 file)`);
  }
}

if (missing.length > 0) {
  console.error("Dist smoke FAILED. Missing paths:");
  for (const p of missing) {
    console.error(`  - ${p}`);
  }
  process.exit(1);
}

console.log("Dist smoke OK");
