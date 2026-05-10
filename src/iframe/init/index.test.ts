// @vitest-environment jsdom
/**
 * Tests for iframe-init/index (task 3.1)
 *
 * Requirements: 1.1, 1.2, 1.3, 2.2, 3.1
 * Design: iframe-init entry component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DrawioResponseEntry } from "../shared/asset-types";
import { bootstrapIframeInit } from "./index";
import type { InstallFrameGlobals } from "./frame-globals";
import type { CreateRequestManager, RequestManager } from "./request-manager";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeEntry(href: string): DrawioResponseEntry {
  return { href, mediaType: "text/javascript", source: "/* stub */" };
}

/** Dispatch a synthetic MessageEvent on selfWindow with a given source. */
function dispatchMessage(selfWindow: Window, data: unknown, source: unknown): void {
  const event = new MessageEvent("message", {
    data: typeof data === "string" ? data : JSON.stringify(data),
    source: source as MessageEventSource,
  });
  selfWindow.dispatchEvent(event);
}

// ─── Test setup ────────────────────────────────────────────────────────────────

describe("bootstrapIframeInit", () => {
  // We use the real jsdom window as selfWindow.
  // parentWindow is a minimal stub with a postMessage spy.
  let selfWindow: Window;
  let parentWindow: { postMessage: ReturnType<typeof vi.fn> };

  let installGlobalsSpy: ReturnType<typeof vi.fn<InstallFrameGlobals>>;
  let interceptRequestsSpy: ReturnType<typeof vi.fn>;
  let disposeSpy: ReturnType<typeof vi.fn>;
  let createManagerSpy: ReturnType<typeof vi.fn<CreateRequestManager>>;

  let debugSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  let disposeBootstrap: () => void;

  const sampleResponses: readonly DrawioResponseEntry[] = [
    makeEntry("js/app.js"),
    makeEntry("styles/main.css"),
  ];

  const sampleUrlParams: Record<string, string> = { embed: "1", proto: "json" };

  beforeEach(() => {
    selfWindow = window;
    parentWindow = { postMessage: vi.fn() };

    interceptRequestsSpy = vi.fn();
    disposeSpy = vi.fn();

    const fakeManager: RequestManager = {
      interceptRequests: interceptRequestsSpy,
      dispose: disposeSpy,
    };

    createManagerSpy = vi.fn<CreateRequestManager>().mockReturnValue(fakeManager);
    installGlobalsSpy = vi.fn<InstallFrameGlobals>();

    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    disposeBootstrap = bootstrapIframeInit({
      selfWindow,
      parentWindow: parentWindow as unknown as Window,
      installGlobals: installGlobalsSpy,
      createManager: createManagerSpy,
    });
  });

  afterEach(() => {
    disposeBootstrap();
    vi.restoreAllMocks();
    // Clean up __drawioFrameDispose
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__drawioFrameDispose;
  });

  // ─── configure message wires frame-globals ──────────────────────────────────

  it("on {action:'configure'}, installGlobals is called with provided urlParams and a loadScript function", () => {
    dispatchMessage(
      selfWindow,
      { action: "configure", responses: sampleResponses, urlParams: sampleUrlParams },
      parentWindow,
    );

    expect(installGlobalsSpy).toHaveBeenCalledTimes(1);
    const callArg = installGlobalsSpy.mock.calls[0][0];
    expect(callArg.urlParams).toEqual(sampleUrlParams);
    expect(typeof callArg.loadScript).toBe("function");
  });

  it("on {action:'configure'}, window.mxLoadResources is false when using real installFrameGlobals", () => {
    // Re-run with real installFrameGlobals (no spy) to verify end-to-end globals.
    disposeBootstrap(); // tear down spy-based one

    const dispose2 = bootstrapIframeInit({
      selfWindow,
      parentWindow: parentWindow as unknown as Window,
      createManager: createManagerSpy,
      // installGlobals is omitted → defaults to the real implementation
    });

    dispatchMessage(
      selfWindow,
      { action: "configure", responses: sampleResponses, urlParams: sampleUrlParams },
      parentWindow,
    );

    // Real installFrameGlobals sets these globals.
    expect((selfWindow as Window & typeof globalThis).mxLoadResources).toBe(false);
    expect((selfWindow as Window & typeof globalThis).urlParams).toEqual(sampleUrlParams);
    expect((selfWindow as Window & typeof globalThis).urlParams?.embed).toBe("1");

    dispose2();
  });

  // ─── configure message wires RequestManager ─────────────────────────────────

  it("on {action:'configure'}, createManager is called with the provided responses array", () => {
    dispatchMessage(
      selfWindow,
      { action: "configure", responses: sampleResponses, urlParams: sampleUrlParams },
      parentWindow,
    );

    expect(createManagerSpy).toHaveBeenCalledTimes(1);
    expect(createManagerSpy).toHaveBeenCalledWith(sampleResponses);
  });

  it("on {action:'configure'}, interceptRequests() is called on the created manager", () => {
    dispatchMessage(
      selfWindow,
      { action: "configure", responses: sampleResponses, urlParams: sampleUrlParams },
      parentWindow,
    );

    expect(interceptRequestsSpy).toHaveBeenCalledTimes(1);
  });

  // ─── debug log on configure ─────────────────────────────────────────────────

  it("on {action:'configure'}, console.debug logs '[drawio-frame] configured'", () => {
    dispatchMessage(
      selfWindow,
      { action: "configure", responses: sampleResponses, urlParams: sampleUrlParams },
      parentWindow,
    );

    expect(debugSpy).toHaveBeenCalledWith("[drawio-frame] configured");
  });

  // ─── other actions do not trigger configure handling ────────────────────────

  it("other actions such as {action:'script'} do NOT trigger installGlobals", () => {
    dispatchMessage(selfWindow, { action: "script", script: "console.log('hello')" }, parentWindow);

    expect(installGlobalsSpy).not.toHaveBeenCalled();
    expect(createManagerSpy).not.toHaveBeenCalled();
  });

  it("other actions such as {action:'load'} do NOT trigger installGlobals", () => {
    dispatchMessage(selfWindow, { action: "load", xml: "<mxGraphModel/>" }, parentWindow);

    expect(installGlobalsSpy).not.toHaveBeenCalled();
    expect(createManagerSpy).not.toHaveBeenCalled();
  });

  // ─── idempotency: configure twice → second is no-op ─────────────────────────

  it("receiving configure twice — second call is a no-op (warn and skip)", () => {
    const configureMsg = {
      action: "configure",
      responses: sampleResponses,
      urlParams: sampleUrlParams,
    };

    dispatchMessage(selfWindow, configureMsg, parentWindow);
    dispatchMessage(selfWindow, configureMsg, parentWindow);

    // installGlobals and createManager should only be called once.
    expect(installGlobalsSpy).toHaveBeenCalledTimes(1);
    expect(createManagerSpy).toHaveBeenCalledTimes(1);
    expect(interceptRequestsSpy).toHaveBeenCalledTimes(1);
  });

  it("second configure emits console.warn with recognizable message", () => {
    const configureMsg = {
      action: "configure",
      responses: sampleResponses,
      urlParams: sampleUrlParams,
    };

    dispatchMessage(selfWindow, configureMsg, parentWindow);
    dispatchMessage(selfWindow, configureMsg, parentWindow);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("configure received more than once"),
    );
  });

  // ─── messages from untrusted sources are ignored ─────────────────────────────

  it("a configure message from a foreign source does NOT trigger installGlobals", () => {
    const foreignSource = { postMessage: vi.fn() };

    dispatchMessage(
      selfWindow,
      { action: "configure", responses: sampleResponses, urlParams: sampleUrlParams },
      foreignSource,
    );

    expect(installGlobalsSpy).not.toHaveBeenCalled();
    expect(createManagerSpy).not.toHaveBeenCalled();
  });

  // ─── __drawioFrameDispose is exposed on selfWindow ───────────────────────────

  it("after configure, __drawioFrameDispose is a function on selfWindow", () => {
    dispatchMessage(
      selfWindow,
      { action: "configure", responses: sampleResponses, urlParams: sampleUrlParams },
      parentWindow,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof (selfWindow as any).__drawioFrameDispose).toBe("function");
  });

  it("calling __drawioFrameDispose invokes manager.dispose()", () => {
    dispatchMessage(
      selfWindow,
      { action: "configure", responses: sampleResponses, urlParams: sampleUrlParams },
      parentWindow,
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (selfWindow as any).__drawioFrameDispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});
