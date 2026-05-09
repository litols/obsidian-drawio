import type { DrawioLanguage } from "./settings";

const SUPPORTED: ReadonlySet<string> = new Set([
  "en",
  "ja",
  "zh",
  "de",
  "fr",
  "es",
  "pt",
  "ru",
  "ko",
  "pl",
  "nl",
  "it",
]);

export function resolveDrawioLanguage(setting: DrawioLanguage): string {
  if (setting !== "auto") return setting;
  const detected = (typeof navigator !== "undefined" ? navigator.language : "en")
    .toLowerCase()
    .slice(0, 2);
  return SUPPORTED.has(detected) ? detected : "en";
}
