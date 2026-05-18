import { MarkdownRenderChild, type App, type TFile } from "obsidian";
import { createDrawioBridge, type DrawioBridge } from "./drawio-bridge";
import { readDrawioFile } from "./drawio-formats";
import { resolveDrawioLanguage } from "./language-bridge";
import { t } from "./i18n";
import type ObsidianDrawioPlugin from "../main";

// Obsidian 内部の embedRegistry — 公開 d.ts には未掲載のため最小限の型を定義する。
// 画像や PDF と同じ仕組みで `.drawio` 埋め込みのレンダラを登録することで、
// 読み取りモード・ライブプレビュー双方で一貫して動作し、かつ汎用ファイル
// 埋め込みローダとの競合 (チップ表示で上書きされる) を回避できる。
interface EmbedContext {
  app: App;
  containerEl: HTMLElement;
}
type DrawioEmbedComponent = MarkdownRenderChild & { loadFile: () => void };
type EmbedCreator = (ctx: EmbedContext, file: TFile, subpath: string) => DrawioEmbedComponent;
interface EmbedRegistry {
  registerExtension(ext: string, creator: EmbedCreator): void;
  unregisterExtension(ext: string): void;
}

/**
 * 埋め込み drawio リンク (`![[diagram.drawio]]`) を、ライブ drawio iframe による
 * プレビューに置き換える。プレビューをクリックすると編集ビューが開く。
 *
 * iframe は重い (drawio 本体 ~9MB) ため、IntersectionObserver で
 * 画面内に入ったときだけ遅延マウントする。
 *
 * @returns 登録解除を行う dispose 関数
 */
export function registerDrawioEmbedPreview(plugin: ObsidianDrawioPlugin): () => void {
  const registry = (plugin.app as unknown as { embedRegistry?: EmbedRegistry }).embedRegistry;
  if (!registry) {
    console.warn("[drawio-embed] embedRegistry is unavailable; embed previews disabled");
    return () => {};
  }
  registry.registerExtension(
    "drawio",
    (ctx, file) => new DrawioEmbed(plugin, ctx.containerEl, file),
  );
  return () => {
    try {
      registry.unregisterExtension("drawio");
    } catch (err) {
      console.warn("[drawio-embed] unregisterExtension failed:", err);
    }
  };
}

class DrawioEmbed extends MarkdownRenderChild {
  private bridge: DrawioBridge | null = null;
  private observer: IntersectionObserver | null = null;
  private unloaded = false;
  private built = false;
  private readonly plugin: ObsidianDrawioPlugin;
  private readonly file: TFile;

  constructor(plugin: ObsidianDrawioPlugin, containerEl: HTMLElement, file: TFile) {
    super(containerEl);
    this.plugin = plugin;
    this.file = file;
  }

  loadFile(): void {
    if (this.built) return;
    this.built = true;

    const embed = this.containerEl;
    embed.empty();
    embed.removeClass("file-embed", "mod-empty", "mod-generic", "is-loaded");
    embed.addClass("drawio-embed");

    const host = embed.createDiv({ cls: "drawio-embed-preview" });
    host.createDiv({ cls: "drawio-embed-hint", text: t("embed.clickToEdit") });

    host.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void this.plugin.openInDrawioView(this.file);
    });

    // iframe は重いので、画面内に入ったときだけマウントする
    this.observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        this.observer?.disconnect();
        this.observer = null;
        this.mountPreview(host);
      }
    });
    this.observer.observe(host);
  }

  private mountPreview(host: HTMLElement): void {
    void (async () => {
      let xml: string;
      try {
        xml = (await readDrawioFile(this.file, this.plugin.app.vault)).xml;
      } catch (err) {
        console.error("[drawio-embed] failed to read diagram:", err);
        return;
      }
      if (this.unloaded) return;

      this.bridge = createDrawioBridge(this.plugin.app, this.plugin.manifest.dir);
      this.bridge.mount(host, {
        initialXml: xml,
        lang: resolveDrawioLanguage(this.plugin.settings.drawio?.language ?? "auto"),
        ui: "min",
        noSaveBtn: true,
        noExitBtn: true,
        saveAndExit: false,
      });
    })();
  }

  onunload(): void {
    this.unloaded = true;
    this.observer?.disconnect();
    this.observer = null;
    this.bridge?.dispose();
    this.bridge = null;
  }
}
