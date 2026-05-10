import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "../..");
const OBSIDIAN_DIR = resolve(REPO_ROOT, "e2e-vault", ".obsidian");

const ARTIFACTS = [
  resolve(OBSIDIAN_DIR, "workspace.json"),
  resolve(OBSIDIAN_DIR, "workspace.json.bak"),
  resolve(OBSIDIAN_DIR, "cache"),
  resolve(OBSIDIAN_DIR, "plugins", "obsidian-drawio", "data.json"),
];

try {
  console.log("Cleaning e2e-vault runtime artifacts");
  for (const path of ARTIFACTS) {
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
      console.log(`  removed: ${path}`);
    }
  }
  console.log("Cleanup done");
} catch (err) {
  console.error("Cleanup failed:", err);
  process.exit(1);
}
