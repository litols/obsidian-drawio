import * as React from "react";
import { App, PluginSettingTab } from "obsidian";
import type ObsidianDrawioPlugin from "../main";
import type {
  DrawioLanguage,
  DrawioSaveFormat,
  DrawioSettings,
  DrawioTheme,
} from "../lib/settings";

interface SettingsAppProps {
  plugin: ObsidianDrawioPlugin;
}

const DEFAULT_LIBRARIES = [
  "general",
  "basic",
  "arrows3",
  "flowchart",
  "uml",
  "er",
  "bpmn",
  "mockup",
  "network",
  "lean_mapping",
];

const THEMES: DrawioTheme[] = ["auto", "light", "dark", "kennedy", "min", "atlas"];
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
const BOOLEAN_KEYS = [
  "compression",
  "math",
  "grid",
  "ribbonEnabled",
  "openDrawioSvg",
  "openDrawioPng",
] as const;

const BOOLEAN_LABELS: Record<(typeof BOOLEAN_KEYS)[number], string> = {
  compression: "圧縮 (compression)",
  math: "数式 (math)",
  grid: "グリッド (grid)",
  ribbonEnabled: "リボン (ribbonEnabled)",
  openDrawioSvg: ".drawio.svg を draw.io で開く",
  openDrawioPng: ".drawio.png を draw.io で開く",
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
    if (!trimmed) return "パスを入力してください";
    if (/^https?:|^file:|^app:|:\/\//.test(trimmed)) return "外部 URL は使用できません";
    if (trimmed.startsWith("/") || /^[A-Z]:[\\/]/i.test(trimmed)) return "絶対パスは使用できません";
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
      <label>カスタムライブラリ (Vault 相対パス)</label>
      <div>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="例: libraries/custom.xml"
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button onClick={add}>追加</button>
      </div>
      {error && <span style={{ color: "red" }}>{error}</span>}
      <ul>
        {paths.map((p, i) => (
          <li key={i}>
            {p} <button onClick={() => onChange(paths.filter((_, j) => j !== i))}>削除</button>
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

      <div>
        <label>テーマ</label>
        <select
          value={settings.theme}
          onChange={(e) => void update("theme", e.target.value as DrawioTheme)}
        >
          {THEMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>デフォルトライブラリ</label>
        {DEFAULT_LIBRARIES.map((lib) => (
          <label key={lib} style={{ display: "block" }}>
            <input
              type="checkbox"
              checked={settings.defaultLibraries.includes(lib)}
              onChange={(e) => {
                const next = e.target.checked
                  ? [...settings.defaultLibraries, lib]
                  : settings.defaultLibraries.filter((l) => l !== lib);
                void update("defaultLibraries", next);
              }}
            />
            {lib}
          </label>
        ))}
      </div>

      <CustomLibrariesInput
        paths={settings.customLibraries}
        onChange={(paths) => void update("customLibraries", paths)}
      />

      <div>
        <label>保存形式</label>
        <select
          value={settings.defaultSaveFormat}
          onChange={(e) => void update("defaultSaveFormat", e.target.value as DrawioSaveFormat)}
        >
          <option value="keep">keep (元の形式を維持)</option>
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
            {BOOLEAN_LABELS[key]}
          </label>
        </div>
      ))}

      <div>
        <label>言語</label>
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
        <h3>外部変更の同期設定 (external-sync spec により追加)</h3>
        <p>このセクションは drawio-external-sync spec で本実装されます。</p>
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
