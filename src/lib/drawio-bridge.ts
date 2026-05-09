import type { App } from "obsidian";
import type { DrawioInbound, DrawioOutbound } from "./drawio-protocol";
import { buildDrawioUrl, type DrawioUrlOptions } from "./drawio-url";

// 'xmlpng' / 'xmlsvg' は mxfile XML を PNG/SVG バイナリに埋め込む drawio embed 標準 format (drawio-file-io 用)
export type DrawioExportFormat = "png" | "svg" | "xml" | "pdf" | "xmlpng" | "xmlsvg";

// 'light'/'dark' は obsidian テーマ → drawio `ui` 値 への logical alias
export type DrawioThemeMode = "light" | "dark" | "kennedy" | "atlas" | "min";

export interface DrawioBridgeCallbacks {
  onSave?: (xml: string, exit?: boolean) => void;
  onAutosave?: (xml: string) => void;
  onExport?: (data: string, format: string) => void;
  onExit?: (modified?: boolean) => void;
}

export interface DrawioBridgeMountOptions extends DrawioUrlOptions {
  initialXml?: string;
  callbacks?: DrawioBridgeCallbacks;
}

export interface DrawioBridge {
  mount(container: HTMLElement, opts?: DrawioBridgeMountOptions): void;
  dispose(): void;
  load(xml: string): void;
  replaceContent(xml: string): void;
  requestSave(): void;
  requestExport(format: DrawioExportFormat): void;
  setTheme(theme: "light" | "dark"): void;
  setLibraries(libs: ReadonlyArray<{ title: string; entries: unknown[] }>): void;
  sendMessage(msg: DrawioOutbound): void;
  readonly isMounted: boolean;
}

export function createDrawioBridge(app: App): DrawioBridge {
  let iframe: HTMLIFrameElement | null = null;
  let messageHandler: ((event: MessageEvent) => void) | null = null;
  let callbacks: DrawioBridgeCallbacks = {};
  let mounted = false;

  function disposeInternal(): void {
    if (!mounted) return;
    if (messageHandler) {
      window.removeEventListener("message", messageHandler);
      messageHandler = null;
    }
    callbacks = {};
    if (iframe) {
      iframe.src = "about:blank";
      iframe.remove();
      iframe = null;
    }
    mounted = false;
  }

  function handleMessage(event: MessageEvent): void {
    if (!iframe || event.source !== iframe.contentWindow) return;
    let msg: DrawioInbound;
    try {
      msg = JSON.parse(event.data as string) as DrawioInbound;
    } catch {
      console.warn("[DrawioBridge] Failed to parse message:", event.data);
      return;
    }
    console.debug("[DrawioBridge] received:", msg.event, "callbacks:", callbacks);
  }

  return {
    get isMounted(): boolean {
      return mounted;
    },

    mount(container: HTMLElement, opts?: DrawioBridgeMountOptions): void {
      if (mounted) {
        disposeInternal();
      }

      let basePath: string;
      try {
        basePath = app.vault.adapter.getResourcePath("drawio/index.html");
      } catch (err) {
        console.error("[DrawioBridge] Failed to get resource path:", err);
        return;
      }

      const src = buildDrawioUrl(basePath, opts);
      iframe = document.createElement("iframe");
      iframe.setAttribute("sandbox", "allow-scripts allow-same-origin allow-downloads");
      iframe.src = src;
      iframe.style.width = "100%";
      iframe.style.height = "100%";
      iframe.style.border = "none";

      callbacks = opts?.callbacks ?? {};

      messageHandler = handleMessage;
      window.addEventListener("message", messageHandler);

      container.appendChild(iframe);
      mounted = true;
    },

    dispose(): void {
      disposeInternal();
    },

    load(_xml: string): void {
      console.warn("[DrawioBridge] load() not yet implemented (task 4.3)");
    },

    replaceContent(_xml: string): void {
      console.warn("[DrawioBridge] replaceContent() not yet implemented (task 4.3)");
    },

    requestSave(): void {
      console.warn("[DrawioBridge] requestSave() not yet implemented (task 4.3)");
    },

    requestExport(_format: DrawioExportFormat): void {
      console.warn("[DrawioBridge] requestExport() not yet implemented (task 4.3)");
    },

    setTheme(_theme: "light" | "dark"): void {
      console.warn("[DrawioBridge] setTheme() not yet implemented (task 4.3)");
    },

    setLibraries(_libs: ReadonlyArray<{ title: string; entries: unknown[] }>): void {
      console.warn("[DrawioBridge] setLibraries() not yet implemented (task 4.3)");
    },

    sendMessage(_msg: DrawioOutbound): void {
      console.warn("[DrawioBridge] sendMessage() not yet implemented (task 4.3)");
    },
  };
}
