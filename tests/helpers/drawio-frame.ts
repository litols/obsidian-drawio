import type { Page, FrameLocator } from "@playwright/test";

declare global {
  interface Window {
    __drawioMessages?: unknown[];
  }
}

export interface DrawioFrameHandle {
  frame: FrameLocator;
  waitForReady(timeoutMs?: number): Promise<void>;
  capturedMessages(): Promise<unknown[]>;
}

export function installMessageCapture(page: Page): Promise<void> {
  return page.addInitScript(() => {
    window.__drawioMessages = [];
    window.addEventListener("message", (e) => {
      window.__drawioMessages!.push(e.data);
    });
  });
}

export function getDrawioFrame(page: Page, options?: { selector?: string }): DrawioFrameHandle {
  const selector = options?.selector ?? "iframe[data-drawio]";
  const frame = page.frameLocator(selector);

  async function waitForReady(timeoutMs = 30_000): Promise<void> {
    const interval = 100;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const messages: unknown[] = await page.evaluate(() => globalThis.__drawioMessages ?? []);

      const hasInitOrLoad = messages.some((m) => {
        if (typeof m === "string") {
          try {
            const parsed = JSON.parse(m) as Record<string, unknown>;
            return parsed.event === "init" || parsed.event === "load";
          } catch {
            return false;
          }
        }
        if (m !== null && typeof m === "object") {
          const msg = m as Record<string, unknown>;
          return msg["event"] === "init" || msg["event"] === "load";
        }
        return false;
      });

      if (hasInitOrLoad) return;

      await new Promise<void>((resolve) => setTimeout(resolve, interval));
    }

    const messages = await page.evaluate(() => globalThis.__drawioMessages ?? []);
    const iframeUrl = await page
      .locator(selector)
      .getAttribute("src")
      .catch(() => "(unknown)");

    throw new Error(
      `Drawio iframe not ready after ${timeoutMs}ms. iframe URL: ${iframeUrl}, captured messages: ${messages.length}`,
    );
  }

  function capturedMessages(): Promise<unknown[]> {
    return page.evaluate(() => globalThis.__drawioMessages ?? []);
  }

  return { frame, waitForReady, capturedMessages };
}
