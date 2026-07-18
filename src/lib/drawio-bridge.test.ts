// @vitest-environment jsdom
/**
 * drawio-bridge.test.ts
 *
 * Integration tests for the drawio-bridge state machine.
 * Verifies the new data:text/html bootstrap + postMessage script injection flow.
 *
 * Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 3.1, 3.3, 6.1, 6.2, 6.3
 * Design: drawio-bridge component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createDrawioBridge } from "./drawio-bridge";
import type { DrawioBridgeCallbacks, DrawioBridgeMountOptions } from "./drawio-bridge";

// ─── Constants ────────────────────────────────────────────────────────────────

const FAKE_INIT_SOURCE = "console.log('init')";
const FAKE_APP_JS = "console.log('drawio-app')";
const FAKE_INDEX_HTML = "<html><body>index</body></html>";

// ─── Mock obsidian App ────────────────────────────────────────────────────────

/**
 * Build a minimal mock App with stub vault.adapter.
 */
function buildMockApp(pluginDir = "test-plugin") {
  const adapter = {
    list: vi.fn().mockImplementation(async (dir: string) => {
      if (dir.includes("drawio")) {
        return {
          files: [`${pluginDir}/drawio/index.html`, `${pluginDir}/drawio/js/app.min.js`],
          folders: [],
        };
      }
      return { files: [], folders: [] };
    }),
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path.includes("iframe-init.js")) return FAKE_INIT_SOURCE;
      if (path.includes("app.min.js")) return FAKE_APP_JS;
      if (path.includes("index.html")) return FAKE_INDEX_HTML;
      return "";
    }),
    readBinary: vi.fn().mockResolvedValue(new ArrayBuffer(0)),
    exists: vi.fn().mockImplementation(async (path: string) => {
      return path.includes("index.html") || path.includes("app.min.js");
    }),
    getResourcePath: vi.fn().mockReturnValue("app://mock/drawio/index.html"),
  };

  return { vault: { adapter } };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Wait for the async mount IIFE to complete by yielding enough ticks.
 * The mock adapter resolves promises immediately, so a few microtask flushes suffice.
 */
async function flushAsync(): Promise<void> {
  // Yield multiple times to drain promise queues from nested async calls
  for (let i = 0; i < 20; i++) {
    await Promise.resolve();
  }
}

/**
 * Simulate a message from iframeContentWindow to parent window.
 */
function simulateIframeMessage(source: WindowProxy | null, data: unknown): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: source as Window,
      data: JSON.stringify(data),
      origin: "null",
    }),
  );
}

function getIframe(container: HTMLElement): HTMLIFrameElement | null {
  return container.querySelector("iframe");
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("createDrawioBridge", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (container.parentNode) {
      container.remove();
    }
    vi.restoreAllMocks();
  });

  // ── Test 1: Public API preserved ──────────────────────────────────────────

  it("exports createDrawioBridge and DrawioBridge interface with all required methods", () => {
    const mockApp = buildMockApp();
    const bridge = createDrawioBridge(mockApp as never, "test-plugin");

    expect(typeof bridge.mount).toBe("function");
    expect(typeof bridge.dispose).toBe("function");
    expect(typeof bridge.load).toBe("function");
    expect(typeof bridge.replaceContent).toBe("function");
    expect(typeof bridge.requestSave).toBe("function");
    expect(typeof bridge.requestExport).toBe("function");
    expect(typeof bridge.setTheme).toBe("function");
    expect(typeof bridge.sendMessage).toBe("function");
    expect(bridge.isMounted).toBe(false);
  });

  // ── Test 2: mount → iframe.src is data:text/html, ────────────────────────

  it("mount creates an iframe with src starting with data:text/html,", async () => {
    const mockApp = buildMockApp();
    const bridge = createDrawioBridge(mockApp as never, "test-plugin");

    bridge.mount(container);
    await flushAsync();

    const iframe = getIframe(container);
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toMatch(/^data:text\/html,/);

    bridge.dispose();
  });

  // ── Test 3: state machine — iframe event → script/configure/script messages

  it("simulating {event:'iframe'} triggers postMessage sequence: script(init) → configure → script(app)", async () => {
    const mockApp = buildMockApp();
    const bridge = createDrawioBridge(mockApp as never, "test-plugin");
    bridge.mount(container);
    await flushAsync();

    const iframe = getIframe(container)!;
    expect(iframe).not.toBeNull();

    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");

    // Simulate {event:"iframe"} from iframe
    simulateIframeMessage(iframe.contentWindow, { event: "iframe" });

    // First: {action:"script", script: iframeInitSource}
    // Second: {action:"configure", responses, urlParams}
    // Third: {action:"script", script: appJsSource}
    // These are synchronous postMessage calls, so they happen immediately
    expect(postMessageSpy.mock.calls.length).toBeGreaterThanOrEqual(3);

    // parent→iframe の script / configure はオブジェクトのまま送られる。drawio webapp
    // 向けの configure 応答 / load は従来どおり JSON 文字列。両方を許容して読む。
    const calls = postMessageSpy.mock.calls.map((c) =>
      typeof c[0] === "string"
        ? (JSON.parse(c[0]) as Record<string, unknown>)
        : (c[0] as Record<string, unknown>),
    );

    // Script injection call (init source)
    const scriptCalls = calls.filter((m) => m["action"] === "script");
    expect(scriptCalls.length).toBeGreaterThanOrEqual(2);

    // Configure call
    const configureCall = calls.find((m) => m["action"] === "configure" && "responses" in m);
    expect(configureCall).toBeDefined();
    expect(Array.isArray(configureCall!["responses"])).toBe(true);
    expect(typeof configureCall!["urlParams"]).toBe("object");

    bridge.dispose();
  });

  // ── Test 3b: drawioConfig → configure=1 URL param + configure reply ──────

  it("with drawioConfig set, replies to drawio's {event:'configure'} request with {action:'configure', config}", async () => {
    const mockApp = buildMockApp();
    const bridge = createDrawioBridge(mockApp as never, "test-plugin");
    const drawioConfig = { defaultLibraries: "aws4;general" };
    bridge.mount(container, { initialXml: "<mxfile/>", drawioConfig });
    await flushAsync();

    const iframe = getIframe(container)!;
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");

    // Advance state machine to "configuring"
    simulateIframeMessage(iframe.contentWindow, { event: "iframe" });

    // drawio (in configure=1 mode) asks the parent for its config
    simulateIframeMessage(iframe.contentWindow, { event: "configure" });

    // parent→iframe の script / configure はオブジェクトのまま送られる。drawio webapp
    // 向けの configure 応答 / load は従来どおり JSON 文字列。両方を許容して読む。
    const calls = postMessageSpy.mock.calls.map((c) =>
      typeof c[0] === "string"
        ? (JSON.parse(c[0]) as Record<string, unknown>)
        : (c[0] as Record<string, unknown>),
    );
    // configure reply: {action:"configure", config: drawioConfig}
    const reply = calls.find(
      (m) => m["action"] === "configure" && "config" in m && !("responses" in m),
    );
    expect(reply).toBeDefined();
    expect(reply!["config"]).toEqual(drawioConfig);

    bridge.dispose();
  });

  it("without drawioConfig, does not add configure=1 to URL params", async () => {
    const mockApp = buildMockApp();
    const bridge = createDrawioBridge(mockApp as never, "test-plugin");
    bridge.mount(container, { initialXml: "<mxfile/>" });
    await flushAsync();

    const iframe = getIframe(container)!;
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");
    simulateIframeMessage(iframe.contentWindow, { event: "iframe" });

    // parent→iframe の script / configure はオブジェクトのまま送られる。drawio webapp
    // 向けの configure 応答 / load は従来どおり JSON 文字列。両方を許容して読む。
    const calls = postMessageSpy.mock.calls.map((c) =>
      typeof c[0] === "string"
        ? (JSON.parse(c[0]) as Record<string, unknown>)
        : (c[0] as Record<string, unknown>),
    );
    const configureCall = calls.find((m) => m["action"] === "configure" && "urlParams" in m);
    const urlParams = configureCall?.["urlParams"] as Record<string, string> | undefined;
    expect(urlParams?.["configure"]).toBeUndefined();

    bridge.dispose();
  });

  // ── Test 4: {event:'init'} after configure → load(xml) and isMounted ─────

  it("simulating {event:'init'} after configure causes load message and isMounted=true", async () => {
    const mockApp = buildMockApp();
    const opts: DrawioBridgeMountOptions = { initialXml: "<mxfile/>" };
    const bridge = createDrawioBridge(mockApp as never, "test-plugin");
    bridge.mount(container, opts);
    await flushAsync();

    const iframe = getIframe(container)!;
    const postMessageSpy = vi.spyOn(iframe.contentWindow!, "postMessage");

    // Step through state machine to configuring
    simulateIframeMessage(iframe.contentWindow, { event: "iframe" });

    // Now simulate {event:"init"} from drawio webapp
    simulateIframeMessage(iframe.contentWindow, { event: "init" });

    // parent→iframe の script / configure はオブジェクトのまま送られる。drawio webapp
    // 向けの configure 応答 / load は従来どおり JSON 文字列。両方を許容して読む。
    const calls = postMessageSpy.mock.calls.map((c) =>
      typeof c[0] === "string"
        ? (JSON.parse(c[0]) as Record<string, unknown>)
        : (c[0] as Record<string, unknown>),
    );
    const loadCall = calls.find((m) => m["action"] === "load");
    expect(loadCall).toBeDefined();
    expect(loadCall!["xml"]).toBe("<mxfile/>");
    expect(bridge.isMounted).toBe(true);

    bridge.dispose();
  });

  // ── Test 5: timeout — never receive {event:"iframe"} → error state ────────

  it("times out if {event:'iframe'} is never received and transitions to error state", async () => {
    vi.useFakeTimers();

    const mockApp = buildMockApp();
    const bridge = createDrawioBridge(mockApp as never, "test-plugin");
    bridge.mount(container);

    // Flush async (works even with fake timers since mock adapters resolve synchronously)
    await flushAsync();

    // Advance past the iframe event timeout (5s)
    vi.advanceTimersByTime(6000);

    // Error indicator should be rendered in container
    const errorEl = container.querySelector("[data-drawio-error]");
    expect(errorEl).not.toBeNull();
    expect(bridge.isMounted).toBe(false);

    vi.useRealTimers();
  });

  // ── Test 6: timeout — never receive {event:"init"} after configure ────────

  it("times out if {event:'init'} is never received after configure", async () => {
    vi.useFakeTimers();

    const mockApp = buildMockApp();
    const bridge = createDrawioBridge(mockApp as never, "test-plugin");
    bridge.mount(container);

    // Flush the async promise chain (mock adapters resolve immediately)
    await flushAsync();

    // Simulate the iframe event to advance state to configuring
    const iframe = getIframe(container);
    if (iframe) {
      simulateIframeMessage(iframe.contentWindow, { event: "iframe" });
    }

    // Advance past the init timeout (15s) without receiving {event:"init"}
    vi.advanceTimersByTime(16000);

    // Error indicator should be in the container
    const errorEl = container.querySelector("[data-drawio-error]");
    expect(errorEl).not.toBeNull();

    vi.useRealTimers();
  });

  // ── Test 7: dispose removes iframe, listener, and sets isMounted=false ────

  it("dispose removes iframe from container, removes message listener, sets isMounted=false", async () => {
    const mockApp = buildMockApp();
    const bridge = createDrawioBridge(mockApp as never, "test-plugin");
    bridge.mount(container);
    await flushAsync();

    expect(getIframe(container)).not.toBeNull();

    bridge.dispose();

    expect(getIframe(container)).toBeNull();
    expect(bridge.isMounted).toBe(false);
  });

  // ── Test 8: dispose then mount again → fresh start ────────────────────────

  it("dispose then mount again works as a fresh start", async () => {
    const mockApp = buildMockApp();
    const bridge = createDrawioBridge(mockApp as never, "test-plugin");

    bridge.mount(container);
    await flushAsync();
    bridge.dispose();

    expect(getIframe(container)).toBeNull();
    expect(bridge.isMounted).toBe(false);

    // Mount again
    bridge.mount(container);
    await flushAsync();

    const iframe = getIframe(container);
    expect(iframe).not.toBeNull();
    expect(iframe!.src).toMatch(/^data:text\/html,/);

    bridge.dispose();
  });

  // ── Test 9: inbound save dispatch ─────────────────────────────────────────

  it("simulates {event:'save', xml, exit} after init → callbacks.onSave called", async () => {
    const onSave = vi.fn();
    const callbacks: DrawioBridgeCallbacks = { onSave };
    const mockApp = buildMockApp();
    const bridge = createDrawioBridge(mockApp as never, "test-plugin");

    bridge.mount(container, { callbacks });
    await flushAsync();

    const iframe = getIframe(container)!;

    // Drive through state machine to ready
    simulateIframeMessage(iframe.contentWindow, { event: "iframe" });
    simulateIframeMessage(iframe.contentWindow, { event: "init" });

    // Now simulate save
    simulateIframeMessage(iframe.contentWindow, { event: "save", xml: "<saved/>", exit: false });

    expect(onSave).toHaveBeenCalledWith("<saved/>", false);

    bridge.dispose();
  });

  // ── Test 10: inbound autosave / export / exit dispatch ────────────────────

  it("simulates autosave / export / exit after init → respective callbacks called", async () => {
    const onAutosave = vi.fn();
    const onExport = vi.fn();
    const onExit = vi.fn();
    const callbacks: DrawioBridgeCallbacks = { onAutosave, onExport, onExit };
    const mockApp = buildMockApp();
    const bridge = createDrawioBridge(mockApp as never, "test-plugin");

    bridge.mount(container, { callbacks });
    await flushAsync();

    const iframe = getIframe(container)!;

    // Drive to ready state
    simulateIframeMessage(iframe.contentWindow, { event: "iframe" });
    simulateIframeMessage(iframe.contentWindow, { event: "init" });

    // autosave
    simulateIframeMessage(iframe.contentWindow, { event: "autosave", xml: "<auto/>" });
    expect(onAutosave).toHaveBeenCalledWith("<auto/>");

    // export
    simulateIframeMessage(iframe.contentWindow, {
      event: "export",
      data: "base64data",
      format: "png",
    });
    expect(onExport).toHaveBeenCalledWith("base64data", "png");

    // exit
    simulateIframeMessage(iframe.contentWindow, { event: "exit" });
    expect(onExit).toHaveBeenCalled();

    bridge.dispose();
  });

  // ── Test 11: event.source mismatch is ignored ──────────────────────────────

  it("messages from different source (not iframe.contentWindow) are ignored", async () => {
    const onSave = vi.fn();
    const mockApp = buildMockApp();
    const bridge = createDrawioBridge(mockApp as never, "test-plugin");

    bridge.mount(container, { callbacks: { onSave } });
    await flushAsync();

    const iframe = getIframe(container)!;

    // Drive to ready state
    simulateIframeMessage(iframe.contentWindow, { event: "iframe" });
    simulateIframeMessage(iframe.contentWindow, { event: "init" });

    // Dispatch a message from a DIFFERENT source (window itself, not iframe.contentWindow)
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window, // wrong source
        data: JSON.stringify({ event: "save", xml: "<malicious/>", exit: false }),
        origin: "null",
      }),
    );

    expect(onSave).not.toHaveBeenCalled();

    bridge.dispose();
  });
});
