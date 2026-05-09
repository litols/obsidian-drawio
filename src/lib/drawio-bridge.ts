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
  let initialXml = "";
  let lastKnownXml = "";
  let mounted = false;

  function disposeInternal(): void {
    if (!mounted) return;
    if (messageHandler) {
      window.removeEventListener("message", messageHandler);
      messageHandler = null;
    }
    callbacks = {};
    initialXml = "";
    lastKnownXml = "";
    if (iframe) {
      iframe.src = "about:blank";
      iframe.remove();
      iframe = null;
    }
    mounted = false;
  }

  function sendMessageInternal(msg: DrawioOutbound): void {
    if (!mounted) {
      console.warn("[DrawioBridge] sendMessage() called before mount");
      return;
    }
    if (!iframe?.contentWindow) {
      console.warn("[DrawioBridge] sendMessage() called with null contentWindow");
      return;
    }
    iframe.contentWindow.postMessage(JSON.stringify(msg), "*");
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
    switch (msg.event) {
      case "init":
        sendMessageInternal({ action: "load", xml: initialXml });
        break;
      case "load":
        break;
      case "save":
        lastKnownXml = msg.xml;
        callbacks.onSave?.(msg.xml, msg.exit);
        break;
      case "autosave":
        lastKnownXml = msg.xml;
        callbacks.onAutosave?.(msg.xml);
        break;
      case "export":
        callbacks.onExport?.(msg.data, msg.format);
        break;
      case "exit":
        callbacks.onExit?.();
        break;
      case "dialog":
        console.warn("[DrawioBridge] dialog event (unhandled):", msg);
        break;
      case "prompt":
        console.warn("[DrawioBridge] prompt event (unhandled):", msg);
        break;
    }
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
      initialXml = opts?.initialXml ?? "";
      lastKnownXml = initialXml;

      messageHandler = handleMessage;
      window.addEventListener("message", messageHandler);

      container.appendChild(iframe);
      mounted = true;
    },

    dispose(): void {
      disposeInternal();
    },

    load(xml: string): void {
      sendMessageInternal({ action: "load", xml });
    },

    replaceContent(xml: string): void {
      sendMessageInternal({ action: "merge", xml });
    },

    requestSave(): void {
      sendMessageInternal({ action: "load", xml: lastKnownXml, autosave: 1 });
    },

    requestExport(format: DrawioExportFormat): void {
      sendMessageInternal({ action: "export", format });
    },

    setTheme(theme: "light" | "dark"): void {
      sendMessageInternal({
        action: "configure",
        config: { ui: theme === "dark" ? "dark" : "kennedy" },
      });
    },

    setLibraries(libs: ReadonlyArray<{ title: string; entries: unknown[] }>): void {
      sendMessageInternal({ action: "configure", config: { libraries: libs } });
    },

    sendMessage(msg: DrawioOutbound): void {
      sendMessageInternal(msg);
    },
  };
}
