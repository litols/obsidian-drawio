/**
 * iframe-init/frame-messenger (task 2.5)
 *
 * In-iframe postMessage messenger.
 * Abstracts parent ↔ iframe postMessage I/O and centralises event.source
 * verification so that only messages from window.parent are dispatched to
 * registered handlers.
 *
 * Allowed imports (in-iframe IIFE build):
 *   - Browser globals only. NO obsidian / electron / node imports.
 *   - NO imports from src/lib/.
 *
 * Requirements: 1.2, 2.2, 6.1
 * Design: iframe-init/frame-messenger component
 */

// ─── Public interface ────────────────────────────────────────────────────────

export interface IframeFrameMessenger<TIn, TOut> {
  /** JSON-stringify `msg` and postMessage it to window.parent with origin "*". */
  send(msg: TOut): void;
  /**
   * Register a handler for incoming messages from window.parent.
   * Multiple registrations are kept in an internal array and called in
   * registration order.
   * Returns an unregister function that removes only this single handler.
   */
  onMessage(handler: (msg: TIn) => void): () => void;
  /**
   * Remove the underlying window "message" listener and clear the handler
   * array. After destroy(), subsequent messages are silently ignored and
   * subsequent send() calls are no-ops.
   */
  destroy(): void;
}

// ─── Factory config ──────────────────────────────────────────────────────────

export interface IframeFrameMessengerConfig {
  /**
   * The window on which to install the "message" event listener.
   * Defaults to the global `window` (the in-iframe context).
   * Injectable for testability.
   */
  selfWindow?: Window;
  /**
   * The window to use as the postMessage target (i.e. window.parent in
   * production). Also used as the trusted source for incoming messages.
   * Defaults to `window.parent`.
   * Injectable for testability.
   */
  parentWindow?: Window;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create an in-iframe postMessage messenger.
 *
 * Production usage (no args — defaults to `window` / `window.parent`):
 *   const messenger = createIframeFrameMessenger();
 *
 * Test usage (inject custom windows):
 *   const messenger = createIframeFrameMessenger({ selfWindow, parentWindow });
 */
export function createIframeFrameMessenger<TIn = unknown, TOut = unknown>(
  config?: IframeFrameMessengerConfig,
): IframeFrameMessenger<TIn, TOut> {
  const self: Window = config?.selfWindow ?? window;
  const parent: Window = config?.parentWindow ?? window.parent;

  let handlers: Array<(msg: TIn) => void> = [];
  let destroyed = false;

  // ── Internal message listener ────────────────────────────────────────────

  function onWindowMessage(event: MessageEvent): void {
    // Drop messages that do not originate from window.parent.
    if (event.source !== parent) {
      return;
    }

    // 親→iframe メッセージは JSON 文字列と structured clone オブジェクトの両方を受理する。
    // 巨大な configure ペイロードはオブジェクトのまま送られ、JSON.parse を回避する。
    let parsed: TIn;
    if (typeof event.data === "string") {
      try {
        parsed = JSON.parse(event.data) as TIn;
      } catch {
        console.warn("[frame-messenger] Failed to JSON.parse incoming message data:", event.data);
        return;
      }
    } else if (event.data !== null && typeof event.data === "object") {
      parsed = event.data as TIn;
    } else {
      return;
    }

    // Dispatch to all registered handlers in registration order.
    // Snapshot the array so that a handler that calls unregister() during
    // iteration doesn't affect the current dispatch round.
    const snapshot = handlers.slice();
    for (const handler of snapshot) {
      handler(parsed);
    }
  }

  self.addEventListener("message", onWindowMessage);

  // ── Public API ───────────────────────────────────────────────────────────

  return {
    send(msg: TOut): void {
      if (destroyed) {
        return;
      }
      parent.postMessage(JSON.stringify(msg), "*");
    },

    onMessage(handler: (msg: TIn) => void): () => void {
      handlers.push(handler);
      return function unregister(): void {
        const idx = handlers.indexOf(handler);
        if (idx !== -1) {
          handlers.splice(idx, 1);
        }
      };
    },

    destroy(): void {
      destroyed = true;
      self.removeEventListener("message", onWindowMessage);
      handlers = [];
    },
  };
}
