import * as React from "react";
import { App, PluginSettingTab } from "obsidian";
import type ObsidianDrawioPlugin from "../main";
import type { DrawioLanguage, DrawioSaveFormat, DrawioSettings } from "../lib/settings";
import { t, type TranslationKey } from "../lib/i18n";

interface SettingsAppProps {
  plugin: ObsidianDrawioPlugin;
}

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

interface CustomLibrariesInputProps {
  paths: string[];
  onChange: (paths: string[]) => void;
}

const CustomLibrariesInput: React.FC<CustomLibrariesInputProps> = ({ paths, onChange }) => {
  const [draft, setDraft] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  const validate = (input: string): string | null => {
    const trimmed = input.trim();
    if (!trimmed) return t("settings.customLibraries.err.empty");
    if (/^https?:|^file:|^app:|:\/\//.test(trimmed))
      return t("settings.customLibraries.err.externalUrl");
    if (trimmed.startsWith("/") || /^[A-Z]:[\\/]/i.test(trimmed))
      return t("settings.customLibraries.err.absolute");
    return null;
  };

  const add = () => {
    const err = validate(draft);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    onChange([...paths, draft.trim()]);
    setDraft("");
  };

  return (
    <div>
      <label>{t("settings.customLibraries.label")}</label>
      <div>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("settings.customLibraries.placeholder")}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button onClick={add}>{t("settings.customLibraries.add")}</button>
      </div>
      {error && <span style={{ color: "red" }}>{error}</span>}
      <ul>
        {paths.map((p, i) => (
          <li key={i}>
            {p}{" "}
            <button onClick={() => onChange(paths.filter((_, j) => j !== i))}>
              {t("settings.customLibraries.remove")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

const SettingsApp: React.FC<SettingsAppProps> = ({ plugin }) => {
  const [settings, setSettings] = React.useState<DrawioSettings>(() => plugin.settings.drawio!);

  const update = async <K extends keyof DrawioSettings>(key: K, value: DrawioSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    plugin.settings.drawio = next;
    await plugin.saveSettings();
  };

  return (
    <div className="drawio-settings-app">
      <h2>draw.io</h2>

      <p style={{ opacity: 0.75, fontSize: "0.9em" }}>{t("settings.editorPrefHint")}</p>

      <CustomLibrariesInput
        paths={settings.customLibraries}
        onChange={(paths) => void update("customLibraries", paths)}
      />

      <div>
        <label>{t("settings.saveFormat")}</label>
        <select
          value={settings.defaultSaveFormat}
          onChange={(e) => void update("defaultSaveFormat", e.target.value as DrawioSaveFormat)}
        >
          <option value="keep">{t("settings.saveFormat.keep")}</option>
          <option value="drawio">drawio</option>
        </select>
      </div>

      {BOOLEAN_KEYS.map((key) => (
        <div key={key}>
          <label>
            <input
              type="checkbox"
              checked={settings[key]}
              onChange={(e) => void update(key, e.target.checked)}
            />
            {t(BOOLEAN_LABEL_KEYS[key])}
          </label>
        </div>
      ))}

      <div>
        <label>{t("settings.language")}</label>
        <select
          value={settings.language}
          onChange={(e) => void update("language", e.target.value as DrawioLanguage)}
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <hr />
      <section data-spec="external-sync">
        <h3>{t("settings.externalSync.heading")}</h3>
        <p>{t("settings.externalSync.body")}</p>
      </section>
    </div>
  );
};

export class DrawioSettingTab extends PluginSettingTab {
  private readonly plugin: ObsidianDrawioPlugin;
  private mountDispose: (() => void) | null = null;

  constructor(app: App, plugin: ObsidianDrawioPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    this.containerEl.empty();
    const container = this.containerEl.createDiv();
    this.mountDispose = this.plugin.reactMountManager.mount(
      container,
      <SettingsApp plugin={this.plugin} />,
    );
  }

  hide(): void {
    this.mountDispose?.();
    this.mountDispose = null;
  }
}
