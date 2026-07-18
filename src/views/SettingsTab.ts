import { Notice, PluginSettingTab, Setting } from "obsidian";
import type { App } from "obsidian";
import type ObsidianDrawioPlugin from "../main";
import type {
  DrawioLanguage,
  DrawioOpenMode,
  DrawioSaveFormat,
  DrawioSettings,
} from "../lib/settings";
import { BASELINE_DEFAULT_LIBRARIES } from "../lib/settings";
import { t, type TranslationKey } from "../lib/i18n";
import {
  addUniqueEntry,
  validateCustomLibraryPath,
  type LibraryPathError,
} from "../lib/settings-ui";

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

const CUSTOM_ERROR_KEYS: Record<LibraryPathError, TranslationKey> = {
  empty: "settings.customLibraries.err.empty",
  externalUrl: "settings.customLibraries.err.externalUrl",
  absolute: "settings.customLibraries.err.absolute",
};

interface AddRowOptions {
  placeholder: string;
  addLabel: string;
  focusKey: "baseline" | "custom";
  /** 追加を試みる。成功したら true。失敗時は showError で文言を表示し false を返す。 */
  onAdd: (value: string, showError: (message: string) => void) => boolean;
}

/**
 * Obsidian 公式の Setting API で設定タブを構築する。
 * display() が毎回 plugin.settings.drawio から全行を再構築し、値変更は即時永続化する。
 * トップレベル見出し / innerHTML / インラインスタイルは使用しない (Obsidian guidelines)。
 */
export class DrawioSettingTab extends PluginSettingTab {
  private readonly plugin: ObsidianDrawioPlugin;
  // 一覧更新後の再構築で追加入力欄へフォーカスを戻すための一時マーカー。
  private focusTarget: "baseline" | "custom" | null = null;

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

    // ライブラリ一覧セクション (見出し + エントリ行 + 追加行)
    this.renderBaselineLibraries(settings);
    this.renderCustomLibraries(settings);

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

  private renderBaselineLibraries(settings: DrawioSettings): void {
    const { containerEl } = this;

    // ヘッダ行: ラベル + 説明 + Reset ボタン (常設のみ)
    new Setting(containerEl)
      .setName(t("settings.baselineLibraries.label"))
      .setDesc(t("settings.baselineLibraries.hint"))
      .addButton((button) =>
        button.setButtonText(t("settings.baselineLibraries.reset")).onClick(async () => {
          settings.baselineLibraries = [...BASELINE_DEFAULT_LIBRARIES];
          await this.persist();
          this.display();
        }),
      );

    // エントリ行 (削除 ExtraButton 付き)
    settings.baselineLibraries.forEach((id, index) => {
      new Setting(containerEl).setName(id).addExtraButton((button) =>
        button
          .setIcon("trash")
          .setTooltip(t("settings.baselineLibraries.remove"))
          .onClick(async () => {
            settings.baselineLibraries = settings.baselineLibraries.filter((_, i) => i !== index);
            await this.persist();
            this.display();
          }),
      );
    });

    // 追加行
    this.renderAddRow({
      placeholder: t("settings.baselineLibraries.placeholder"),
      addLabel: t("settings.baselineLibraries.add"),
      focusKey: "baseline",
      onAdd: (value, showError) => {
        if (value.trim() === "") {
          showError(t("settings.baselineLibraries.err.empty"));
          return false;
        }
        settings.baselineLibraries = addUniqueEntry(settings.baselineLibraries, value);
        return true;
      },
    });
  }

  private renderCustomLibraries(settings: DrawioSettings): void {
    const { containerEl } = this;

    // ヘッダ行 (Reset なし)
    new Setting(containerEl).setName(t("settings.customLibraries.label"));

    // エントリ行 (削除 ExtraButton 付き)
    settings.customLibraries.forEach((path, index) => {
      new Setting(containerEl).setName(path).addExtraButton((button) =>
        button
          .setIcon("trash")
          .setTooltip(t("settings.customLibraries.remove"))
          .onClick(async () => {
            settings.customLibraries = settings.customLibraries.filter((_, i) => i !== index);
            await this.persist();
            this.display();
          }),
      );
    });

    // 追加行
    this.renderAddRow({
      placeholder: t("settings.customLibraries.placeholder"),
      addLabel: t("settings.customLibraries.add"),
      focusKey: "custom",
      onAdd: (value, showError) => {
        const error = validateCustomLibraryPath(value);
        if (error) {
          showError(t(CUSTOM_ERROR_KEYS[error]));
          return false;
        }
        settings.customLibraries = addUniqueEntry(settings.customLibraries, value);
        return true;
      },
    });
  }

  /**
   * 追加入力行を構築する。テキスト入力 (Enter 対応) + Add ボタン + エラー表示行。
   * 追加成功時は保存して display() を再構築し、再構築後に入力欄へフォーカスを戻す。
   * 失敗時は再構築せず、追加行直下の .drawio-settings-error にエラー文言を表示する。
   */
  private renderAddRow(options: AddRowOptions): void {
    const { containerEl } = this;
    // addText コールバックは Setting 構築時に同期実行されるため definite assignment で受ける。
    let inputEl!: HTMLInputElement;
    let errorEl: HTMLElement | null = null;

    const showError = (message: string): void => {
      errorEl?.setText(message);
    };

    const submit = async (): Promise<void> => {
      errorEl?.setText("");
      if (!options.onAdd(inputEl.value, showError)) return;
      this.focusTarget = options.focusKey;
      await this.persist();
      this.display();
    };

    new Setting(containerEl)
      .addText((text) => {
        text.setPlaceholder(options.placeholder);
        inputEl = text.inputEl;
        text.inputEl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        });
      })
      .addButton((button) =>
        button
          .setButtonText(options.addLabel)
          .setCta()
          .onClick(() => void submit()),
      );

    // エラー行は追加行の直下に置く
    errorEl = containerEl.createEl("div", { cls: "drawio-settings-error" });

    if (this.focusTarget === options.focusKey) {
      this.focusTarget = null;
      inputEl.focus();
    }
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
