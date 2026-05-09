import type { Plugin } from "obsidian";

export interface PluginSettings {
  drawio?: DrawioSettings;
  // Legacy top-level fields added by drawio-file-io. Absorbed into drawio.* by migrateSettings.
  openDrawioSvg?: boolean;
  openDrawioPng?: boolean;
  preserveCompression?: boolean;
}

export type DrawioTheme = "auto" | "light" | "dark" | "kennedy" | "min" | "atlas";
export type DrawioLanguage =
  | "auto"
  | "en"
  | "ja"
  | "zh"
  | "de"
  | "fr"
  | "es"
  | "pt"
  | "ru"
  | "ko"
  | "pl"
  | "nl"
  | "it";
export type DrawioSaveFormat = "keep" | "drawio";

export interface DrawioSettings {
  settingsVersion: number;
  theme: DrawioTheme;
  defaultLibraries: string[];
  customLibraries: string[];
  defaultSaveFormat: DrawioSaveFormat;
  compression: boolean;
  math: boolean;
  grid: boolean;
  language: DrawioLanguage;
  ribbonEnabled: boolean;
  openDrawioSvg: boolean;
  openDrawioPng: boolean;
}

export interface DrawioPluginSettings {
  drawio: DrawioSettings;
}

export const DEFAULT_DRAWIO_SETTINGS: DrawioSettings = {
  settingsVersion: 1,
  theme: "auto",
  defaultLibraries: ["general"],
  customLibraries: [],
  defaultSaveFormat: "keep",
  compression: true,
  math: false,
  grid: true,
  language: "auto",
  ribbonEnabled: true,
  openDrawioSvg: true,
  openDrawioPng: true,
};

export const DEFAULT_SETTINGS: PluginSettings = {
  drawio: { ...DEFAULT_DRAWIO_SETTINGS },
};

const VALID_THEMES: DrawioTheme[] = ["auto", "light", "dark", "kennedy", "min", "atlas"];
const VALID_LANGUAGES: DrawioLanguage[] = [
  "auto",
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
];
const VALID_SAVE_FORMATS: DrawioSaveFormat[] = ["keep", "drawio"];

export function migrateSettings(raw: unknown): DrawioSettings {
  if (raw == null || typeof raw !== "object") {
    return { ...DEFAULT_DRAWIO_SETTINGS };
  }

  const data = raw as Record<string, unknown>;
  const drawioInput =
    data.drawio != null && typeof data.drawio === "object"
      ? (data.drawio as Record<string, unknown>)
      : {};

  // Legacy top-level field absorption
  const legacyOpenSvg = typeof data.openDrawioSvg === "boolean" ? data.openDrawioSvg : undefined;
  const legacyOpenPng = typeof data.openDrawioPng === "boolean" ? data.openDrawioPng : undefined;
  const legacyCompression =
    typeof data.preserveCompression === "boolean" ? data.preserveCompression : undefined;

  const resolveBoolean = (
    drawioVal: unknown,
    legacyVal: boolean | undefined,
    defaultVal: boolean,
  ): boolean => {
    if (typeof drawioVal === "boolean") return drawioVal;
    if (legacyVal !== undefined) return legacyVal;
    return defaultVal;
  };

  const rawTheme = drawioInput.theme;
  const theme: DrawioTheme = VALID_THEMES.includes(rawTheme as DrawioTheme)
    ? (rawTheme as DrawioTheme)
    : DEFAULT_DRAWIO_SETTINGS.theme;

  const rawLanguage = drawioInput.language;
  const language: DrawioLanguage = VALID_LANGUAGES.includes(rawLanguage as DrawioLanguage)
    ? (rawLanguage as DrawioLanguage)
    : DEFAULT_DRAWIO_SETTINGS.language;

  const rawSaveFormat = drawioInput.defaultSaveFormat;
  const defaultSaveFormat: DrawioSaveFormat = VALID_SAVE_FORMATS.includes(
    rawSaveFormat as DrawioSaveFormat,
  )
    ? (rawSaveFormat as DrawioSaveFormat)
    : DEFAULT_DRAWIO_SETTINGS.defaultSaveFormat;

  const defaultLibraries = Array.isArray(drawioInput.defaultLibraries)
    ? (drawioInput.defaultLibraries as string[]).filter((v) => typeof v === "string")
    : DEFAULT_DRAWIO_SETTINGS.defaultLibraries;

  const customLibraries = Array.isArray(drawioInput.customLibraries)
    ? (drawioInput.customLibraries as string[]).filter((v) => typeof v === "string")
    : DEFAULT_DRAWIO_SETTINGS.customLibraries;

  return {
    settingsVersion: 1,
    theme,
    defaultLibraries,
    customLibraries,
    defaultSaveFormat,
    compression: resolveBoolean(
      drawioInput.compression,
      legacyCompression,
      DEFAULT_DRAWIO_SETTINGS.compression,
    ),
    math: resolveBoolean(drawioInput.math, undefined, DEFAULT_DRAWIO_SETTINGS.math),
    grid: resolveBoolean(drawioInput.grid, undefined, DEFAULT_DRAWIO_SETTINGS.grid),
    language,
    ribbonEnabled: resolveBoolean(
      drawioInput.ribbonEnabled,
      undefined,
      DEFAULT_DRAWIO_SETTINGS.ribbonEnabled,
    ),
    openDrawioSvg: resolveBoolean(
      drawioInput.openDrawioSvg,
      legacyOpenSvg,
      DEFAULT_DRAWIO_SETTINGS.openDrawioSvg,
    ),
    openDrawioPng: resolveBoolean(
      drawioInput.openDrawioPng,
      legacyOpenPng,
      DEFAULT_DRAWIO_SETTINGS.openDrawioPng,
    ),
  };
}

export async function loadSettings(plugin: Plugin): Promise<PluginSettings> {
  const persisted = (await plugin.loadData()) as PluginSettings | null;
  return Object.assign({}, DEFAULT_SETTINGS, persisted ?? {});
}

export async function saveSettings(plugin: Plugin, settings: PluginSettings): Promise<void> {
  await plugin.saveData(settings);
}
