// @vitest-environment jsdom
/**
 * Tests for iframe-init/frame-messenger (task 2.5)
 *
 * Requirements: 1.2, 2.2, 6.1
 * Design: iframe-init/frame-messenger component
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createIframeFrameMessenger } from "./frame-messenger";

// ─── RED phase guard ───────────────────────────────────────────────────────
// This import is expected to fail before frame-messenger.ts exists.

describe("createIframeFrameMessenger", () => {
  /**
   * In jsdom there is no real iframe hierarchy — window.parent === window.
   * To isolate parent-origin filtering we pass a custom parentWindow
   * (testable injection point) that is a separate EventTarget-like object.
   *
   * We create a minimal stub for the parent window used as the injection
   * target for postMessage:
   *   - `parentWindow.postMessage(data, origin)` is spied upon.
   *   - We fire synthetic MessageEvents on the listening `selfWindow` with
   *     `source` set to either `parentWindow` (trusted) or a foreign object.
   */

  // Minimal fake window that acts as the parent target for postMessage.
  let parentWindow: { postMessage: ReturnType<typeof vi.fn> };
  // Self window is the real jsdom `window` (the in-iframe side listener).
  let selfWindow: Window;

  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    parentWindow = { postMessage: vi.fn() };
    selfWindow = window;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── helper: dispatch a synthetic MessageEvent on selfWindow ────────────

  function dispatchMessage(data: unknown, source: unknown): void {
    const event = new MessageEvent("message", {
      data: typeof data === "string" ? data : JSON.stringify(data),
      source: source as MessageEventSource,
    });
    selfWindow.dispatchEvent(event);
  }

  // ── send ───────────────────────────────────────────────────────────────

  it("send() calls postMessage on parentWindow with JSON.stringify(msg) and '*'", () => {
    const messenger = createIframeFrameMessenger({
      selfWindow,
      parentWindow: parentWindow as unknown as Window,
    });

    messenger.send({ foo: 1 });

    expect(parentWindow.postMessage).toHaveBeenCalledTimes(1);
    expect(parentWindow.postMessage).toHaveBeenCalledWith(JSON.stringify({ foo: 1 }), "*");

    messenger.destroy();
  });

  // ── onMessage — trusted source ─────────────────────────────────────────

  it("onMessage handler receives parsed object from parent-origin messages", () => {
    const messenger = createIframeFrameMessenger({
      selfWindow,
      parentWindow: parentWindow as unknown as Window,
    });

    const handler = vi.fn();
    messenger.onMessage(handler);

    dispatchMessage({ action: "configure" }, parentWindow);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ action: "configure" });

    messenger.destroy();
  });

  // ── onMessage — untrusted source ────────────────────────────────────────

  it("onMessage ignores messages whose source !== parentWindow", () => {
    const messenger = createIframeFrameMessenger({
      selfWindow,
      parentWindow: parentWindow as unknown as Window,
    });

    const handler = vi.fn();
    messenger.onMessage(handler);

    const foreignSource = { postMessage: vi.fn() };
    dispatchMessage({ action: "evil" }, foreignSource);

    expect(handler).not.toHaveBeenCalled();

    messenger.destroy();
  });

  // ── onMessage — JSON parse failure ─────────────────────────────────────

  it("onMessage calls console.warn and does not throw on JSON.parse failure", () => {
    const messenger = createIframeFrameMessenger({
      selfWindow,
      parentWindow: parentWindow as unknown as Window,
    });

    const handler = vi.fn();
    messenger.onMessage(handler);

    // Dispatch a raw string that is not valid JSON, with trusted source.
    const event = new MessageEvent("message", {
      data: "not json",
      source: parentWindow as unknown as MessageEventSource,
    });
    selfWindow.dispatchEvent(event);

    expect(warnSpy).toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();

    messenger.destroy();
  });

  // ── multiple onMessage handlers ────────────────────────────────────────

  it("all registered handlers are called for one message, in registration order", () => {
    const messenger = createIframeFrameMessenger({
      selfWindow,
      parentWindow: parentWindow as unknown as Window,
    });

    const calls: string[] = [];
    messenger.onMessage(() => calls.push("first"));
    messenger.onMessage(() => calls.push("second"));

    dispatchMessage({ x: 1 }, parentWindow);

    expect(calls).toEqual(["first", "second"]);

    messenger.destroy();
  });

  // ── unregister returned by onMessage ───────────────────────────────────

  it("unregister function returned by onMessage removes only that handler", () => {
    const messenger = createIframeFrameMessenger({
      selfWindow,
      parentWindow: parentWindow as unknown as Window,
    });

    const handler1 = vi.fn();
    const handler2 = vi.fn();

    const unregister1 = messenger.onMessage(handler1);
    messenger.onMessage(handler2);

    // Remove only handler1.
    unregister1();

    dispatchMessage({ x: 1 }, parentWindow);

    expect(handler1).not.toHaveBeenCalled();
    expect(handler2).toHaveBeenCalledTimes(1);

    messenger.destroy();
  });

  // ── destroy ─────────────────────────────────────────────────────────────

  it("after destroy(), subsequent messages do not trigger any handler", () => {
    const messenger = createIframeFrameMessenger({
      selfWindow,
      parentWindow: parentWindow as unknown as Window,
    });

    const handler = vi.fn();
    messenger.onMessage(handler);

    messenger.destroy();

    dispatchMessage({ x: 1 }, parentWindow);

    expect(handler).not.toHaveBeenCalled();
  });
});
