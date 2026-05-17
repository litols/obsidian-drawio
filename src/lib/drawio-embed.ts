import { MarkdownRenderChild, type MarkdownPostProcessorContext, type TFile } from "obsidian";
import { createDrawioBridge, type DrawioBridge } from "./drawio-bridge";
import { readDrawioFile } from "./drawio-formats";
import { resolveDrawioLanguage } from "./language-bridge";
import { t } from "./i18n";
import type ObsidianDrawioPlugin from "../main";

/**
 * 埋め込み drawio リンク (`![[diagram.drawio]]`) を、ライブ drawio iframe による
 * プレビューに置き換える。プレビューをクリックすると編集ビューが開く。
 *
 * iframe は重い (drawio 本体 ~9MB) ため、IntersectionObserver で
 * 画面内に入ったときだけ遅延マウントする。
 */
export function registerDrawioEmbedPreview(plugin: ObsidianDrawioPlugin): void {
  plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
    const embeds = el.querySelectorAll<HTMLElement>(".internal-embed");
    embeds.forEach((embed) => {
      if (embed.dataset.drawioEmbed) return;

      const src = embed.getAttribute("src");
      if (!src) return;

      // `![[file.drawio#section|alt]]` から純粋なリンクパスだけ取り出す。
      // `.drawio.svg` / `.drawio.png` は Obsidian が画像として描画するため対象外。
      const linkpath = src.split(/[#|]/)[0].trim();
      if (!/\.drawio$/i.test(linkpath)) return;

      const file = plugin.app.metadataCache.getFirstLinkpathDest(linkpath, ctx.sourcePath);
      if (!file) return;

      embed.dataset.drawioEmbed = "1";
      ctx.addChild(new DrawioEmbedChild(plugin, embed, file));
    });
  });
}

class DrawioEmbedChild extends MarkdownRenderChild {
  private bridge: DrawioBridge | null = null;
  private observer: IntersectionObserver | null = null;
  private unloaded = false;
  private readonly plugin: ObsidianDrawioPlugin;
  private readonly file: TFile;

  constructor(plugin: ObsidianDrawioPlugin, embedEl: HTMLElement, file: TFile) {
    super(embedEl);
    this.plugin = plugin;
    this.file = file;
  }

  onload(): void {
    const embed = this.containerEl;
    embed.empty();
    embed.removeClass("file-embed", "mod-empty", "is-loaded");
    embed.addClass("drawio-embed");

    const host = embed.createDiv({ cls: "drawio-embed-preview" });
    host.createDiv({ cls: "drawio-embed-hint", text: t("embed.clickToEdit") });

    host.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      void this.plugin.openInDrawioView(this.file);
    });

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
