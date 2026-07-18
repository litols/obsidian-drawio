// @vitest-environment jsdom
/**
 * Tests for iframe-init/index (chunked asset ingest).
 *
 * Requirements: 1.1, 1.2, 1.3, 2.2, 3.1, 5.5, 5.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DrawioResponseEntry } from "../shared/asset-types";
import { bootstrapIframeInit } from "./index";
import type { InstallFrameGlobals } from "./frame-globals";
import type { CreateRequestManager, RequestManager } from "./request-manager";

function makeEntry(href: string): DrawioResponseEntry {
  return { href, mediaType: "text/javascript", source: "/* stub */" };
}

function dispatchMessage(selfWindow: Window, data: unknown, source: unknown): void {
  const event = new MessageEvent("message", {
    data: typeof data === "string" ? data : JSON.stringify(data),
    source: source as MessageEventSource,
  });
  selfWindow.dispatchEvent(event);
}

describe("bootstrapIframeInit", () => {
  let selfWindow: Window;
  let parentWindow: { postMessage: ReturnType<typeof vi.fn> };

  let installGlobalsSpy: ReturnType<typeof vi.fn<InstallFrameGlobals>>;
  let interceptRequestsSpy: ReturnType<typeof vi.fn>;
  let ingestSpy: ReturnType<typeof vi.fn>;
  let injectStylesheetsSpy: ReturnType<typeof vi.fn>;
  let disposeSpy: ReturnType<typeof vi.fn>;
  let createManagerSpy: ReturnType<typeof vi.fn<CreateRequestManager>>;

  let debugSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  let disposeBootstrap: () => void;

  const sampleEntries: readonly DrawioResponseEntry[] = [
    makeEntry("js/app.js"),
    makeEntry("styles/main.css"),
  ];
  const sampleUrlParams: Record<string, string> = { embed: "1", proto: "json" };
  const configureMsg = {
    action: "configure",
    urlParams: sampleUrlParams,
    indexHtml: "<html><head></head></html>",
  };

  beforeEach(() => {
    selfWindow = window;
    parentWindow = { postMessage: vi.fn() };

    interceptRequestsSpy = vi.fn();
    ingestSpy = vi.fn();
    injectStylesheetsSpy = vi.fn();
    disposeSpy = vi.fn();

    const fakeManager: RequestManager = {
      interceptRequests: interceptRequestsSpy,
      ingest: ingestSpy,
      injectStylesheets: injectStylesheetsSpy,
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (window as any).__drawioFrameDispose;
  });

  it("configure で installGlobals(urlParams, loadScript) が呼ばれる", () => {
    dispatchMessage(selfWindow, configureMsg, parentWindow);
    expect(installGlobalsSpy).toHaveBeenCalledTimes(1);
    const callArg = installGlobalsSpy.mock.calls[0]![0];
    expect(callArg.urlParams).toEqual(sampleUrlParams);
    expect(typeof callArg.loadScript).toBe("function");
  });

  it("configure は createManager() を引数なしで呼び interceptRequests する", () => {
    dispatchMessage(selfWindow, configureMsg, parentWindow);
    expect(createManagerSpy).toHaveBeenCalledTimes(1);
    expect(createManagerSpy).toHaveBeenCalledWith();
    expect(interceptRequestsSpy).toHaveBeenCalledTimes(1);
  });

  it("configure は responses を含まず、console.debug で configured を出す", () => {
    dispatchMessage(selfWindow, configureMsg, parentWindow);
    expect(debugSpy).toHaveBeenCalledWith("[drawio-frame] configured");
  });

  it("real installFrameGlobals で mxLoadResources=false / urlParams が設定される", () => {
    disposeBootstrap();
    const dispose2 = bootstrapIframeInit({
      selfWindow,
      parentWindow: parentWindow as unknown as Window,
      createManager: createManagerSpy,
    });
    dispatchMessage(selfWindow, configureMsg, parentWindow);
    expect((selfWindow as Window & typeof globalThis).mxLoadResources).toBe(false);
    expect((selfWindow as Window & typeof globalThis).urlParams).toEqual(sampleUrlParams);
    dispose2();
  });

  it("assets チャンク受信で ingest + {event:'asset-ack'} 応答", () => {
    dispatchMessage(selfWindow, configureMsg, parentWindow);
    dispatchMessage(
      selfWindow,
      { action: "assets", entries: sampleEntries, group: "core", final: false, seq: 0 },
      parentWindow,
    );
    expect(ingestSpy).toHaveBeenCalledTimes(1);
    expect(ingestSpy).toHaveBeenCalledWith(sampleEntries, "core");
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      JSON.stringify({ event: "asset-ack", seq: 0 }),
      "*",
    );
  });

  it("core 群の最終チャンクで injectStylesheets(indexHtml) が呼ばれる", () => {
    dispatchMessage(selfWindow, configureMsg, parentWindow);
    dispatchMessage(
      selfWindow,
      { action: "assets", entries: sampleEntries, group: "core", final: true, seq: 0 },
      parentWindow,
    );
    expect(injectStylesheetsSpy).toHaveBeenCalledTimes(1);
    expect(injectStylesheetsSpy).toHaveBeenCalledWith(configureMsg.indexHtml);
  });

  it("tail 群の最終チャンクでは injectStylesheets を呼ばない", () => {
    dispatchMessage(selfWindow, configureMsg, parentWindow);
    dispatchMessage(
      selfWindow,
      { action: "assets", entries: sampleEntries, group: "tail", final: true, seq: 5 },
      parentWindow,
    );
    expect(injectStylesheetsSpy).not.toHaveBeenCalled();
    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      JSON.stringify({ event: "asset-ack", seq: 5 }),
      "*",
    );
  });

  it("configure 前の assets は warn + drop (ingest されない)", () => {
    dispatchMessage(
      selfWindow,
      { action: "assets", entries: sampleEntries, group: "core", final: false, seq: 0 },
      parentWindow,
    );
    expect(ingestSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("assets received before configure"),
    );
  });

  it("script / load アクションは configure ハンドラを起動しない", () => {
    dispatchMessage(selfWindow, { action: "script", script: "x" }, parentWindow);
    dispatchMessage(selfWindow, { action: "load", xml: "<mxGraphModel/>" }, parentWindow);
    expect(installGlobalsSpy).not.toHaveBeenCalled();
    expect(createManagerSpy).not.toHaveBeenCalled();
  });

  it("configure 2 回目は no-op (warn)", () => {
    dispatchMessage(selfWindow, configureMsg, parentWindow);
    dispatchMessage(selfWindow, configureMsg, parentWindow);
    expect(installGlobalsSpy).toHaveBeenCalledTimes(1);
    expect(createManagerSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("configure received more than once"),
    );
  });

  it("foreign source の configure は無視される", () => {
    const foreignSource = { postMessage: vi.fn() };
    dispatchMessage(selfWindow, configureMsg, foreignSource);
    expect(installGlobalsSpy).not.toHaveBeenCalled();
  });

  it("__drawioFrameDispose が manager.dispose を呼ぶ", () => {
    dispatchMessage(selfWindow, configureMsg, parentWindow);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(typeof (selfWindow as any).__drawioFrameDispose).toBe("function");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (selfWindow as any).__drawioFrameDispose();
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });
});
