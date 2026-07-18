import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import type ObsidianDrawioPlugin from "../main";
import type { DrawioLanguage, DrawioOpenMode, DrawioSaveFormat } from "../lib/settings";
import { t, type TranslationKey } from "../lib/i18n";

const LANGUAGES: DrawioLanguage[] = [
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

// drawio エディタ内では切り替えられないため設定タブで管理する真偽フラグ。
// アイコンライブラリ集合 / テーマ / グリッド ON-OFF は drawio 側操作が source-of-truth に
// なったため、ここから除去している (DrawioView の onUserPrefChange で自動保存)。
const BOOLEAN_KEYS = [
  "compression",
  "math",
  "ribbonEnabled",
  "openDrawioSvg",
  "openDrawioPng",
] as const;

const BOOLEAN_LABEL_KEYS: Record<(typeof BOOLEAN_KEYS)[number], TranslationKey> = {
  compression: "settings.bool.compression",
  math: "settings.bool.math",
  ribbonEnabled: "settings.bool.ribbonEnabled",
  openDrawioSvg: "settings.bool.openDrawioSvg",
  openDrawioPng: "settings.bool.openDrawioPng",
};

/**
 * Obsidian 公式の Setting API で設定タブを構築する。
 * display() が毎回 plugin.settings.drawio から全行を再構築し、値変更は即時永続化する。
 * トップレベル見出し / innerHTML / インラインスタイルは使用しない (Obsidian guidelines)。
 */
export class DrawioSettingTab extends PluginSettingTab {
  private readonly plugin: ObsidianDrawioPlugin;

  constructor(app: App, plugin: ObsidianDrawioPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    const settings = this.plugin.settings.drawio;
    if (!settings) return;

    // 補助説明 (editorPrefHint)。標準の setting-item-description クラスを再利用する。
    containerEl.createEl("div", {
      text: t("settings.editorPrefHint"),
      cls: "setting-item-description drawio-settings-intro",
    });

    // ライブラリ一覧セクション (見出しのみ。エントリ行と追加編集は task 2.2 で構築する)
    this.renderBaselineLibrariesHeader();
    this.renderCustomLibrariesHeader();

    // 保存形式
    new Setting(containerEl).setName(t("settings.saveFormat")).addDropdown((dropdown) => {
      dropdown
        .addOption("keep", t("settings.saveFormat.keep"))
        .addOption("drawio", "drawio")
        .setValue(settings.defaultSaveFormat)
        .onChange(async (value) => {
          settings.defaultSaveFormat = value as DrawioSaveFormat;
          await this.persist();
        });
    });

    // 真偽値設定群
    for (const key of BOOLEAN_KEYS) {
      new Setting(containerEl).setName(t(BOOLEAN_LABEL_KEYS[key])).addToggle((toggle) => {
        toggle.setValue(settings[key]).onChange(async (value) => {
          settings[key] = value;
          await this.persist();
        });
      });
    }

    // drawio 表示言語
    new Setting(containerEl).setName(t("settings.language")).addDropdown((dropdown) => {
      for (const language of LANGUAGES) {
        dropdown.addOption(language, language);
      }
      dropdown.setValue(settings.language).onChange(async (value) => {
        settings.language = value as DrawioLanguage;
        await this.persist();
      });
    });

    // 既定表示モード (drawio-preview-mode spec が追加した defaultOpenMode)
    new Setting(containerEl).setName(t("settings.defaultOpenMode")).addDropdown((dropdown) => {
      dropdown
        .addOption("preview", t("settings.defaultOpenMode.preview"))
        .addOption("editor", t("settings.defaultOpenMode.editor"))
        .setValue(settings.defaultOpenMode)
        .onChange(async (value) => {
          settings.defaultOpenMode = value as DrawioOpenMode;
          await this.persist();
        });
    });

    // 外部変更の同期 (見出しと説明のみ。操作コントロールは本 spec のスコープ外)
    new Setting(containerEl).setName(t("settings.externalSync.heading")).setHeading();
    new Setting(containerEl).setDesc(t("settings.externalSync.body"));
  }

  private renderBaselineLibrariesHeader(): void {
    new Setting(this.containerEl)
      .setName(t("settings.baselineLibraries.label"))
      .setDesc(t("settings.baselineLibraries.hint"));
  }

  private renderCustomLibrariesHeader(): void {
    new Setting(this.containerEl).setName(t("settings.customLibraries.label"));
  }

  private async persist(): Promise<void> {
    try {
      await this.plugin.saveSettings();
    } catch (error) {
      console.error("drawio: failed to save settings", error);
      new Notice(t("notice.saveFailed"));
    }
  }
}
