import * as React from "react";
import { App, Modal, type TFile } from "obsidian";
import {
  loadPerDiagramConfig,
  savePerDiagramConfig,
  type PerDiagramConfig,
} from "../lib/per-diagram-config";
import type { DrawioTheme } from "../lib/settings";
import type ObsidianDrawioPlugin from "../main";

const THEMES: DrawioTheme[] = ["auto", "light", "dark", "kennedy", "min", "atlas"];
const LIBS = [
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

interface FormProps {
  initial: PerDiagramConfig;
  onSave: (config: PerDiagramConfig) => void;
  onCancel: () => void;
}

const PerDiagramForm: React.FC<FormProps> = ({ initial, onSave, onCancel }) => {
  const [config, setConfig] = React.useState<PerDiagramConfig>(initial);

  const useGlobalLibraries = config.libraries === undefined;

  return (
    <div className="drawio-per-diagram-form">
      <h3>図ごとの設定</h3>

      <div>
        <label>テーマ override（空欄でグローバル設定を使用）</label>
        <select
          value={config.theme ?? ""}
          onChange={(e) =>
            setConfig({
              ...config,
              theme: e.target.value === "" ? undefined : (e.target.value as DrawioTheme),
            })
          }
        >
          <option value="">(グローバル設定を使用)</option>
          {THEMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label>数式 (math)</label>
        <select
          value={config.math === undefined ? "" : String(config.math)}
          onChange={(e) => {
            const v = e.target.value;
            setConfig({ ...config, math: v === "" ? undefined : v === "true" });
          }}
        >
          <option value="">(グローバル設定を使用)</option>
          <option value="true">有効</option>
          <option value="false">無効</option>
        </select>
      </div>

      <div>
        <label>グリッド (grid)</label>
        <select
          value={config.grid === undefined ? "" : String(config.grid)}
          onChange={(e) => {
            const v = e.target.value;
            setConfig({ ...config, grid: v === "" ? undefined : v === "true" });
          }}
        >
          <option value="">(グローバル設定を使用)</option>
          <option value="true">有効</option>
          <option value="false">無効</option>
        </select>
      </div>

      <div>
        <label>ライブラリ override</label>
        <label style={{ display: "block" }}>
          <input
            type="checkbox"
            checked={useGlobalLibraries}
            onChange={(e) => setConfig({ ...config, libraries: e.target.checked ? undefined : [] })}
          />
          グローバル設定を使用
        </label>
        {!useGlobalLibraries &&
          LIBS.map((lib) => (
            <label key={lib} style={{ display: "block" }}>
              <input
                type="checkbox"
                checked={config.libraries?.includes(lib) ?? false}
                onChange={(e) => {
                  const cur = config.libraries ?? [];
                  const next = e.target.checked ? [...cur, lib] : cur.filter((l) => l !== lib);
                  setConfig({ ...config, libraries: next });
                }}
              />
              {lib}
            </label>
          ))}
      </div>

      <div>
        <button onClick={() => onSave(config)}>保存</button>
        <button onClick={onCancel}>キャンセル</button>
      </div>
    </div>
  );
};

export class DiagramSettingsModal extends Modal {
  private readonly plugin: ObsidianDrawioPlugin;
  private readonly file: TFile;
  private readonly onSaveCallback?: () => void;
  private mountDispose: (() => void) | null = null;

  constructor(app: App, plugin: ObsidianDrawioPlugin, file: TFile, onSave?: () => void) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.onSaveCallback = onSave;
  }

  async onOpen(): Promise<void> {
    const initial = await loadPerDiagramConfig(this.app.vault, this.file.path);
    this.mountDispose = this.plugin.reactMountManager.mount(
      this.contentEl,
      <PerDiagramForm
        initial={initial}
        onSave={async (config) => {
          await savePerDiagramConfig(this.app.vault, this.file.path, config);
          this.onSaveCallback?.();
          this.close();
        }}
        onCancel={() => this.close()}
      />,
    );
  }

  onClose(): void {
    this.mountDispose?.();
    this.mountDispose = null;
    this.contentEl.empty();
  }
}
