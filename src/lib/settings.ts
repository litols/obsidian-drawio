import type { Plugin } from "obsidian";

/**
 * drawio 内蔵の基本カテゴリ ID。drawio.com / desktop の初期サイドバーに
 * 常時表示される 7 カテゴリ (Sidebar.prototype.defaultEntries の hardcoded default)。
 * plugin では localStorage を無効化しているため、settings.baselineLibraries に
 * 何も設定されていない場合はここが seed される。実運用では
 * `settings.drawio.baselineLibraries` を参照すること。
 */
export const BASELINE_DEFAULT_LIBRARIES: readonly string[] = [
  "general",
  "uml",
  "er",
  "bpmn",
  "flowchart",
  "basic",
  "arrows2",
];

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
export type DrawioOpenMode = "preview" | "editor";

export type ExternalSyncNotificationLevel = "silent" | "statusbar" | "notice" | "banner";

export interface ExternalSyncSettings {
  autoReloadWhenClean: boolean;
  notifyOnExternalChange: boolean;
  notificationLevel: ExternalSyncNotificationLevel;
  echoSuppressionMs: number;
  dedupDebounceMs: number;
}

export const DEFAULT_EXTERNAL_SYNC_SETTINGS: ExternalSyncSettings = {
  autoReloadWhenClean: true,
  notifyOnExternalChange: true,
  notificationLevel: "banner",
  echoSuppressionMs: 300,
  dedupDebounceMs: 100,
};

export interface DrawioSettings {
  settingsVersion: number;
  theme: DrawioTheme;
  /**
   * 常にサイドバーに出す drawio 内蔵カテゴリ (general / basic / flowchart 等)。
   * user が More Shapes で選択解除しても buildDrawioConfig が再 union して復元する。
   */
  baselineLibraries: string[];
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
  /**
   * ダイアグラムファイルを開いたときの既定表示モード。
   * "preview" は読み取り専用プレビュー、"editor" は従来のフルエディタを直接起動する。
   */
  defaultOpenMode: DrawioOpenMode;
  /** プレビューの背景色 (CSS color 値)。既定は白。画像・GraphViewer プレビュー双方に適用。 */
  previewBackground: string;
  externalSync: ExternalSyncSettings;
}

export interface DrawioPluginSettings {
  drawio: DrawioSettings;
}

export const DEFAULT_DRAWIO_SETTINGS: DrawioSettings = {
  settingsVersion: 2,
  theme: "auto",
  baselineLibraries: [...BASELINE_DEFAULT_LIBRARIES],
  defaultLibraries: [],
  customLibraries: [],
  defaultSaveFormat: "keep",
  compression: true,
  math: false,
  grid: true,
  language: "auto",
  ribbonEnabled: true,
  openDrawioSvg: true,
  openDrawioPng: true,
  defaultOpenMode: "preview",
  previewBackground: "#ffffff",
  externalSync: { ...DEFAULT_EXTERNAL_SYNC_SETTINGS },
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
const VALID_OPEN_MODES: DrawioOpenMode[] = ["preview", "editor"];

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

  const rawOpenMode = drawioInput.defaultOpenMode;
  const defaultOpenMode: DrawioOpenMode = VALID_OPEN_MODES.includes(rawOpenMode as DrawioOpenMode)
    ? (rawOpenMode as DrawioOpenMode)
    : DEFAULT_DRAWIO_SETTINGS.defaultOpenMode;

  const rawPreviewBackground = drawioInput.previewBackground;
  const previewBackground =
    typeof rawPreviewBackground === "string" && rawPreviewBackground.trim() !== ""
      ? rawPreviewBackground
      : DEFAULT_DRAWIO_SETTINGS.previewBackground;

  const baselineLibraries = Array.isArray(drawioInput.baselineLibraries)
    ? (drawioInput.baselineLibraries as string[]).filter((v) => typeof v === "string")
    : [...BASELINE_DEFAULT_LIBRARIES];

  const defaultLibraries = Array.isArray(drawioInput.defaultLibraries)
    ? (drawioInput.defaultLibraries as string[]).filter((v) => typeof v === "string")
    : DEFAULT_DRAWIO_SETTINGS.defaultLibraries;

  const customLibraries = Array.isArray(drawioInput.customLibraries)
    ? (drawioInput.customLibraries as string[]).filter((v) => typeof v === "string")
    : DEFAULT_DRAWIO_SETTINGS.customLibraries;

  const rawVersion =
    typeof drawioInput.settingsVersion === "number" ? drawioInput.settingsVersion : 1;

  // v1 → v2: externalSync 補完
  const externalSyncInput =
    drawioInput.externalSync != null && typeof drawioInput.externalSync === "object"
      ? (drawioInput.externalSync as Record<string, unknown>)
      : {};

  const externalSync: ExternalSyncSettings =
    rawVersion < 2 || drawioInput.externalSync == null
      ? { ...DEFAULT_EXTERNAL_SYNC_SETTINGS }
      : {
          autoReloadWhenClean: resolveBoolean(
            externalSyncInput.autoReloadWhenClean,
            undefined,
            DEFAULT_EXTERNAL_SYNC_SETTINGS.autoReloadWhenClean,
          ),
          notifyOnExternalChange: resolveBoolean(
            externalSyncInput.notifyOnExternalChange,
            undefined,
            DEFAULT_EXTERNAL_SYNC_SETTINGS.notifyOnExternalChange,
          ),
          notificationLevel: (
            ["silent", "statusbar", "notice", "banner"] as ExternalSyncNotificationLevel[]
          ).includes(externalSyncInput.notificationLevel as ExternalSyncNotificationLevel)
            ? (externalSyncInput.notificationLevel as ExternalSyncNotificationLevel)
            : DEFAULT_EXTERNAL_SYNC_SETTINGS.notificationLevel,
          echoSuppressionMs:
            typeof externalSyncInput.echoSuppressionMs === "number"
              ? externalSyncInput.echoSuppressionMs
              : DEFAULT_EXTERNAL_SYNC_SETTINGS.echoSuppressionMs,
          dedupDebounceMs:
            typeof externalSyncInput.dedupDebounceMs === "number"
              ? externalSyncInput.dedupDebounceMs
              : DEFAULT_EXTERNAL_SYNC_SETTINGS.dedupDebounceMs,
        };

  return {
    settingsVersion: 2,
    theme,
    baselineLibraries,
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
    defaultOpenMode,
    previewBackground,
    externalSync,
  };
}

export async function loadSettings(plugin: Plugin): Promise<PluginSettings> {
  const persisted = (await plugin.loadData()) as PluginSettings | null;
  return Object.assign({}, DEFAULT_SETTINGS, persisted ?? {});
}

export async function saveSettings(plugin: Plugin, settings: PluginSettings): Promise<void> {
  await plugin.saveData(settings);
}
