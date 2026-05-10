import { readFileSync, writeFileSync } from "node:fs";
import { resolve, isAbsolute } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const REPO_ROOT = resolve(import.meta.dirname, "../..");

export type SampleName =
  | "empty.drawio"
  | "compressed.drawio"
  | "sample.drawio.svg"
  | "sample.drawio.png";

export function vaultRoot(): string {
  return resolve(REPO_ROOT, "e2e-vault");
}

export function samplePath(name: SampleName): string {
  return resolve(vaultRoot(), "samples", name);
}

export function readSample(name: SampleName): Buffer {
  return readFileSync(samplePath(name));
}

export async function writeExternal(
  filePath: string,
  content: string | Buffer,
  options?: { sleepMs?: number },
): Promise<void> {
  const sleepMs = options?.sleepMs ?? 5000;
  const absPath = isAbsolute(filePath) ? filePath : resolve(vaultRoot(), filePath);
  await sleep(sleepMs);
  writeFileSync(absPath, content);
}
