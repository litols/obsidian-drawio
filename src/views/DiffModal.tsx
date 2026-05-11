import * as React from "react";
import { App, Modal } from "obsidian";
import type ObsidianDrawioPlugin from "../main";
import { t } from "../lib/i18n";

interface DiffLine {
  kind: " " | "+" | "-";
  text: string;
}

function simpleLineDiff(a: string, b: string): DiffLine[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < aLines.length || j < bLines.length) {
    if (i < aLines.length && j < bLines.length && aLines[i] === bLines[j]) {
      result.push({ kind: " ", text: aLines[i] });
      i++;
      j++;
    } else if (j < bLines.length && (i >= aLines.length || !aLines.includes(bLines[j], i))) {
      result.push({ kind: "+", text: bLines[j] });
      j++;
    } else {
      result.push({ kind: "-", text: aLines[i] });
      i++;
    }
  }
  return result;
}

interface DiffViewProps {
  current: string;
  latest: string;
  onReload: () => void;
  onKeepMine: () => void;
  onClose: () => void;
}

const DiffView: React.FC<DiffViewProps> = ({ current, latest, onReload, onKeepMine, onClose }) => {
  const lineDiff = React.useMemo(() => simpleLineDiff(current, latest), [current, latest]);
  return (
    <div>
      <h3>{t("diff.heading")}</h3>
      <pre style={{ maxHeight: "60vh", overflow: "auto", whiteSpace: "pre-wrap" }}>
        {lineDiff.map((d, idx) => (
          <div
            key={idx}
            style={{
              background:
                d.kind === "+"
                  ? "var(--color-green-rgb, #103e10)"
                  : d.kind === "-"
                    ? "var(--color-red-rgb, #3e1010)"
                    : "transparent",
            }}
          >
            {d.kind === "+" ? "+ " : d.kind === "-" ? "- " : "  "}
            {d.text}
          </div>
        ))}
      </pre>
      <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
        <button
          onClick={() => {
            onReload();
            onClose();
          }}
        >
          {t("diff.reloadExternal")}
        </button>
        <button
          onClick={() => {
            onKeepMine();
            onClose();
          }}
        >
          {t("diff.keepMine")}
        </button>
        <button onClick={onClose}>{t("common.cancel")}</button>
      </div>
    </div>
  );
};

export class DiffModal extends Modal {
  private readonly plugin: ObsidianDrawioPlugin;
  private readonly current: string;
  private readonly latest: string;
  private readonly onReload: () => void;
  private readonly onKeepMine: () => void;
  private dispose: (() => void) | null = null;

  constructor(
    app: App,
    plugin: ObsidianDrawioPlugin,
    current: string,
    latest: string,
    onReload: () => void,
    onKeepMine: () => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.current = current;
    this.latest = latest;
    this.onReload = onReload;
    this.onKeepMine = onKeepMine;
  }

  onOpen(): void {
    this.dispose = this.plugin.reactMountManager.mount(
      this.contentEl,
      <DiffView
        current={this.current}
        latest={this.latest}
        onReload={this.onReload}
        onKeepMine={this.onKeepMine}
        onClose={() => this.close()}
      />,
    );
  }

  onClose(): void {
    this.dispose?.();
    this.dispose = null;
    this.contentEl.empty();
  }
}
