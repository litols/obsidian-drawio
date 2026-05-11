/**
 * iframe-init/frame-globals (task 2.4)
 *
 * In-iframe code — installs drawio-required window globals and stubs APIs that
 * are unavailable in the null-origin iframe context (localStorage, cookie).
 *
 * Allowed imports (in-iframe IIFE build):
 *   - Browser globals only. NO obsidian / electron / node imports.
 *   - NO imports from src/lib/.
 *
 * Requirements: 1.1, 3.1
 * Design: iframe-init/frame-globals component
 */

// ─── Ambient augmentation ────────────────────────────────────────────────────

declare global {
  interface Window {
    /** drawio flag — skip loading remote MX resources when false */
    mxLoadResources?: boolean;
    /** drawio dynamic script-loading hook */
    mxscript?: (src: string, onLoad?: () => void) => void;
    /** drawio flag — disable localStorage usage when false */
    isLocalStorage?: boolean;
    /** drawio URL parameter map injected by parent */
    urlParams?: Readonly<Record<string, string>>;
  }
}

// ─── Public interface ────────────────────────────────────────────────────────

export interface InstallFrameGlobalsInput {
  /** drawio URL parameter map (embed, proto, etc.) provided by parent. */
  readonly urlParams: Readonly<Record<string, string>>;
  /**
   * drawio's dynamic script-loading hook (loadScript from RequestManager).
   * Wired to window.mxscript so drawio's mxscript() calls go through the
   * resource-resolved path instead of browser's default fetch.
   */
  readonly loadScript: (src: string, onLoad?: () => void) => void;
}

export type InstallFrameGlobals = (input: InstallFrameGlobalsInput) => void;

// ─── No-op localStorage replacement ─────────────────────────────────────────

/**
 * A no-op Storage-like object whose methods call console.warn instead of
 * accessing actual storage. Used to replace window.localStorage in the
 * null-origin iframe context where localStorage would throw SecurityError.
 */
const noOpStorage = {
  getItem(_key: string): undefined {
    console.warn(
      "[frame-globals] localStorage.getItem() is not available in the drawio iframe context.",
    );
    return undefined;
  },
  setItem(_key: string, _value: string): void {
    console.warn(
      "[frame-globals] localStorage.setItem() is not available in the drawio iframe context.",
    );
  },
  removeItem(_key: string): void {
    console.warn(
      "[frame-globals] localStorage.removeItem() is not available in the drawio iframe context.",
    );
  },
};

// ─── defineProperty helper ────────────────────────────────────────────────────

/**
 * Defines a property on `target` using Object.defineProperty with
 * `configurable: true` so downstream code (drawio webapp) can override it.
 *
 * Idempotency strategy: if the first call already created the descriptor,
 * subsequent calls re-define it with the new value. If the descriptor is
 * somehow non-configurable (e.g. set by drawio itself before we ran), we
 * catch the TypeError and emit a console.warn — this keeps the iframe load
 * alive rather than crashing.
 */
function defineProp<T extends object>(target: T, key: PropertyKey, value: unknown): void {
  try {
    Object.defineProperty(target, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } catch (err) {
    console.warn(
      `[frame-globals] Could not define property "${String(key)}" — it may be non-configurable. Skipping.`,
      err,
    );
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Installs all window-level globals required by the drawio webapp and stubs
 * browser APIs that are unavailable in the null-origin iframe context.
 *
 * Must be called before the drawio script is executed. Safe to call multiple
 * times — subsequent calls update the previously-defined property values.
 */
export const installFrameGlobals: InstallFrameGlobals = (input: InstallFrameGlobalsInput): void => {
  const { urlParams, loadScript } = input;

  // ── drawio window globals ─────────────────────────────────────────────────

  // Prevent drawio from loading remote MX resource bundles.
  defineProp(window, "mxLoadResources", false);

  // Wire drawio's dynamic script loader to our RequestManager-backed loadScript.
  defineProp(window, "mxscript", loadScript);

  // Disable drawio's localStorage-based persistence path.
  defineProp(window, "isLocalStorage", false);

  // Supply URL parameters consumed by drawio (embed mode, protocol, etc.).
  defineProp(window, "urlParams", urlParams);

  // ── localStorage stub ─────────────────────────────────────────────────────

  // In a null-origin (data:) iframe context, accessing window.localStorage
  // may throw a SecurityError. Replace it with a no-op shim so drawio's
  // (guarded) localStorage access paths degrade gracefully.
  defineProp(window, "localStorage", noOpStorage);

  // ── document.cookie stub ──────────────────────────────────────────────────

  // drawio may read document.cookie for session state. In a null-origin iframe
  // this would be an empty string anyway, but defining it explicitly avoids
  // any browser-specific SecurityError on read.
  try {
    Object.defineProperty(document, "cookie", {
      value: "",
      writable: true,
      enumerable: true,
      configurable: true,
    });
  } catch (err) {
    console.warn(
      "[frame-globals] Could not stub document.cookie — it may be non-configurable. Skipping.",
      err,
    );
  }
};
