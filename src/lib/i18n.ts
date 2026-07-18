export type Locale = "ja" | "en";

export type TranslationKey =
  | "command.editPerDiagramSettings"
  | "command.refreshFromDisk"
  | "command.openDemo"
  | "command.enterEditor"
  | "command.enterPreview"
  | "notice.openDrawioFileFirst"
  | "notice.noDrawioFileOpen"
  | "notice.reloadFailed"
  | "notice.saveFailed"
  | "notice.saveFailedWithName"
  | "notice.diagramDeleted"
  | "notice.loadFailed"
  | "notice.sidecarRenameFailed"
  | "confirm.keepMine"
  | "settings.theme"
  | "settings.defaultLibraries"
  | "settings.saveFormat"
  | "settings.saveFormat.keep"
  | "settings.language"
  | "settings.defaultOpenMode"
  | "settings.defaultOpenMode.preview"
  | "settings.defaultOpenMode.editor"
  | "settings.bool.compression"
  | "settings.bool.math"
  | "settings.bool.grid"
  | "settings.bool.ribbonEnabled"
  | "settings.bool.openDrawioSvg"
  | "settings.bool.openDrawioPng"
  | "settings.editorPrefHint"
  | "settings.externalSync.heading"
  | "settings.externalSync.body"
  | "settings.customLibraries.label"
  | "settings.customLibraries.placeholder"
  | "settings.customLibraries.add"
  | "settings.customLibraries.remove"
  | "settings.customLibraries.err.empty"
  | "settings.customLibraries.err.externalUrl"
  | "settings.customLibraries.err.absolute"
  | "settings.baselineLibraries.label"
  | "settings.baselineLibraries.hint"
  | "settings.baselineLibraries.placeholder"
  | "settings.baselineLibraries.add"
  | "settings.baselineLibraries.remove"
  | "settings.baselineLibraries.reset"
  | "settings.baselineLibraries.err.empty"
  | "perDiagram.heading"
  | "perDiagram.themeOverride"
  | "perDiagram.useGlobal"
  | "perDiagram.math"
  | "perDiagram.grid"
  | "perDiagram.enabled"
  | "perDiagram.disabled"
  | "perDiagram.librariesOverride"
  | "perDiagram.useGlobalLibraries"
  | "common.save"
  | "common.cancel"
  | "diff.heading"
  | "diff.reloadExternal"
  | "diff.keepMine"
  | "banner.externalUpdated"
  | "banner.externalUpdatedWithHint"
  | "banner.reload"
  | "banner.diff"
  | "banner.keepMine"
  | "view.drawio.displayText"
  | "view.drawio.loading"
  | "view.demo.displayText"
  | "menu.editInDrawio"
  | "action.newDiagram"
  | "embed.clickToEdit"
  | "preview.error.render"
  | "preview.openEditor"
  | "preview.zoom.in"
  | "preview.zoom.out"
  | "preview.zoom.fit"
  | "preview.zoom.reset"
  | "notice.createDiagramFailed";

const EN: Record<TranslationKey, string> = {
  "command.editPerDiagramSettings": "drawio: Edit per-diagram settings",
  "command.refreshFromDisk": "drawio: Refresh diagram from disk",
  "command.openDemo": "drawio: Open demo",
  "command.enterEditor": "drawio: Edit diagram",
  "command.enterPreview": "drawio: Back to preview",
  "notice.openDrawioFileFirst": "Open a draw.io file first",
  "notice.noDrawioFileOpen": "No draw.io file is open",
  "notice.reloadFailed": "Failed to reload diagram",
  "notice.saveFailed": "Failed to save",
  "notice.saveFailedWithName": "drawio: failed to save {name}",
  "notice.diagramDeleted": "The diagram was deleted",
  "notice.loadFailed": "Failed to load diagram",
  "notice.sidecarRenameFailed": "drawio: failed to rename sidecar for {path}",
  "confirm.keepMine": "Save your current edits and discard the external changes?",
  "settings.theme": "Theme",
  "settings.defaultLibraries": "Default libraries",
  "settings.saveFormat": "Save format",
  "settings.saveFormat.keep": "keep (preserve original format)",
  "settings.language": "Language",
  "settings.defaultOpenMode": "Default open mode",
  "settings.defaultOpenMode.preview": "Preview",
  "settings.defaultOpenMode.editor": "Editor",
  "settings.bool.compression": "Compression",
  "settings.bool.math": "Math typesetting",
  "settings.bool.grid": "Grid",
  "settings.bool.ribbonEnabled": "Show ribbon icon",
  "settings.bool.openDrawioSvg": "Open .drawio.svg with draw.io",
  "settings.bool.openDrawioPng": "Open .drawio.png with draw.io",
  "settings.editorPrefHint":
    "Theme, grid, and the built-in library selection are remembered from what you do inside the draw.io editor. This tab only configures the items that must be set outside draw.io.",
  "settings.externalSync.heading": "External change sync (added by external-sync spec)",
  "settings.externalSync.body":
    "This section will be implemented by the drawio-external-sync spec.",
  "settings.customLibraries.label": "Custom libraries (vault-relative paths)",
  "settings.customLibraries.placeholder": "e.g. libraries/custom.xml",
  "settings.customLibraries.add": "Add",
  "settings.customLibraries.remove": "Remove",
  "settings.customLibraries.err.empty": "Enter a path",
  "settings.customLibraries.err.externalUrl": "External URLs are not allowed",
  "settings.customLibraries.err.absolute": "Absolute paths are not allowed",
  "settings.baselineLibraries.label": "Baseline libraries (always shown in sidebar)",
  "settings.baselineLibraries.hint":
    "drawio built-in category IDs (e.g. general, basic, flowchart, uml). Always merged into the sidebar regardless of what you toggle in More Shapes.",
  "settings.baselineLibraries.placeholder": "e.g. general",
  "settings.baselineLibraries.add": "Add",
  "settings.baselineLibraries.remove": "Remove",
  "settings.baselineLibraries.reset": "Reset to drawio default",
  "settings.baselineLibraries.err.empty": "Enter a library ID",
  "perDiagram.heading": "Per-diagram settings",
  "perDiagram.themeOverride": "Theme override (leave empty to use global)",
  "perDiagram.useGlobal": "(Use global setting)",
  "perDiagram.math": "Math typesetting",
  "perDiagram.grid": "Grid",
  "perDiagram.enabled": "Enabled",
  "perDiagram.disabled": "Disabled",
  "perDiagram.librariesOverride": "Libraries override",
  "perDiagram.useGlobalLibraries": "Use global setting",
  "common.save": "Save",
  "common.cancel": "Cancel",
  "diff.heading": "Diff against external changes",
  "diff.reloadExternal": "Reload (use external)",
  "diff.keepMine": "Keep mine",
  "banner.externalUpdated": "Updated externally",
  "banner.externalUpdatedWithHint": "Updated externally ({source})",
  "banner.reload": "Reload",
  "banner.diff": "Diff",
  "banner.keepMine": "Keep mine",
  "view.drawio.displayText": "Drawio",
  "view.drawio.loading": "Loading draw.io…",
  "view.demo.displayText": "Drawio demo",
  "menu.editInDrawio": "Edit in draw.io",
  "action.newDiagram": "New diagram",
  "embed.clickToEdit": "Click to edit",
  "preview.error.render": "Failed to render the preview",
  "preview.openEditor": "Open in editor",
  "preview.zoom.in": "Zoom in",
  "preview.zoom.out": "Zoom out",
  "preview.zoom.fit": "Fit to view",
  "preview.zoom.reset": "Reset zoom (100%)",
  "notice.createDiagramFailed": "Failed to create the diagram",
};

const JA: Record<TranslationKey, string> = {
  "command.editPerDiagramSettings": "drawio: 図の設定を編集",
  "command.refreshFromDisk": "drawio: ディスクから再読み込み",
  "command.openDemo": "drawio: デモを開く",
  "command.enterEditor": "drawio: 図を編集",
  "command.enterPreview": "drawio: プレビューに戻る",
  "notice.openDrawioFileFirst": "draw.io ファイルを開いた状態で実行してください",
  "notice.noDrawioFileOpen": "draw.io ファイルが開かれていません",
  "notice.reloadFailed": "ダイアグラムの再読み込みに失敗しました",
  "notice.saveFailed": "保存に失敗しました",
  "notice.saveFailedWithName": "drawio: {name} の保存に失敗しました",
  "notice.diagramDeleted": "ダイアグラムが削除されました",
  "notice.loadFailed": "ダイアグラムの読み込みに失敗しました",
  "notice.sidecarRenameFailed": "drawio: {path} のサイドカー名変更に失敗しました",
  "confirm.keepMine": "現在の編集内容を保存し、外部変更を破棄しますか?",
  "settings.theme": "テーマ",
  "settings.defaultLibraries": "デフォルトライブラリ",
  "settings.saveFormat": "保存形式",
  "settings.saveFormat.keep": "keep (元の形式を維持)",
  "settings.language": "言語",
  "settings.defaultOpenMode": "既定の表示モード",
  "settings.defaultOpenMode.preview": "プレビュー",
  "settings.defaultOpenMode.editor": "エディタ",
  "settings.bool.compression": "圧縮 (compression)",
  "settings.bool.math": "数式 (math)",
  "settings.bool.grid": "グリッド (grid)",
  "settings.bool.ribbonEnabled": "リボン (ribbonEnabled)",
  "settings.bool.openDrawioSvg": ".drawio.svg を draw.io で開く",
  "settings.bool.openDrawioPng": ".drawio.png を draw.io で開く",
  "settings.editorPrefHint":
    "テーマ・グリッド・内蔵ライブラリ一覧は draw.io エディタ内での操作がそのまま記憶されます。ここでは draw.io 外から指定する必要のある項目だけを設定します。",
  "settings.externalSync.heading": "外部変更の同期設定 (external-sync spec により追加)",
  "settings.externalSync.body": "このセクションは drawio-external-sync spec で本実装されます。",
  "settings.customLibraries.label": "カスタムライブラリ (Vault 相対パス)",
  "settings.customLibraries.placeholder": "例: libraries/custom.xml",
  "settings.customLibraries.add": "追加",
  "settings.customLibraries.remove": "削除",
  "settings.customLibraries.err.empty": "パスを入力してください",
  "settings.customLibraries.err.externalUrl": "外部 URL は使用できません",
  "settings.customLibraries.err.absolute": "絶対パスは使用できません",
  "settings.baselineLibraries.label": "ベースライブラリ (常時サイドバーに表示)",
  "settings.baselineLibraries.hint":
    "drawio 内蔵カテゴリ ID (例: general, basic, flowchart, uml)。More Shapes での切り替えに関わらずサイドバーに merge されます。",
  "settings.baselineLibraries.placeholder": "例: general",
  "settings.baselineLibraries.add": "追加",
  "settings.baselineLibraries.remove": "削除",
  "settings.baselineLibraries.reset": "drawio 既定に戻す",
  "settings.baselineLibraries.err.empty": "ライブラリ ID を入力してください",
  "perDiagram.heading": "図ごとの設定",
  "perDiagram.themeOverride": "テーマ override（空欄でグローバル設定を使用）",
  "perDiagram.useGlobal": "(グローバル設定を使用)",
  "perDiagram.math": "数式 (math)",
  "perDiagram.grid": "グリッド (grid)",
  "perDiagram.enabled": "有効",
  "perDiagram.disabled": "無効",
  "perDiagram.librariesOverride": "ライブラリ override",
  "perDiagram.useGlobalLibraries": "グローバル設定を使用",
  "common.save": "保存",
  "common.cancel": "キャンセル",
  "diff.heading": "外部変更との差分",
  "diff.reloadExternal": "Reload (外部を採用)",
  "diff.keepMine": "Keep mine (自分を採用)",
  "banner.externalUpdated": "外部で更新されました",
  "banner.externalUpdatedWithHint": "外部で更新されました ({source})",
  "banner.reload": "Reload",
  "banner.diff": "Diff",
  "banner.keepMine": "Keep mine",
  "view.drawio.displayText": "Drawio",
  "view.drawio.loading": "draw.io を読み込み中…",
  "view.demo.displayText": "Drawio デモ",
  "menu.editInDrawio": "draw.io で編集",
  "action.newDiagram": "新規ダイアグラム",
  "embed.clickToEdit": "クリックして編集",
  "preview.error.render": "プレビューの描画に失敗しました",
  "preview.openEditor": "エディタで開く",
  "preview.zoom.in": "拡大",
  "preview.zoom.out": "縮小",
  "preview.zoom.fit": "全体表示",
  "preview.zoom.reset": "等倍に戻す (100%)",
  "notice.createDiagramFailed": "ダイアグラムの作成に失敗しました",
};

const TRANSLATIONS: Record<Locale, Record<TranslationKey, string>> = { ja: JA, en: EN };

let currentLocale: Locale = "en";

export function detectObsidianLocale(): Locale {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem("language") : null;
    return raw === "ja" ? "ja" : "en";
  } catch {
    return "en";
  }
}

export function initI18n(locale?: Locale): void {
  currentLocale = locale ?? detectObsidianLocale();
}

export function getLocale(): Locale {
  return currentLocale;
}

export function t(key: TranslationKey, params?: Record<string, string>): string {
  const template = TRANSLATIONS[currentLocale][key] ?? TRANSLATIONS.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    params[k] !== undefined ? params[k] : `{${k}}`,
  );
}
