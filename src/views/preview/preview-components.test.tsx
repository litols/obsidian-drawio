// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { ImagePreview } from "./ImagePreview";
import { PreviewErrorPanel } from "./PreviewErrorPanel";

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(node: React.ReactNode): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root!.render(node));
  return host;
}

afterEach(() => {
  if (root) flushSync(() => root!.unmount());
  root = null;
  if (host?.parentNode) host.remove();
  host = null;
});

describe("PreviewErrorPanel", () => {
  it("メッセージを表示し、ボタンで onOpenEditor を呼ぶ", () => {
    const onOpenEditor = vi.fn();
    const el = render(<PreviewErrorPanel message="描画に失敗" onOpenEditor={onOpenEditor} />);

    expect(el.querySelector(".drawio-preview-error-message")?.textContent).toBe("描画に失敗");
    const button = el.querySelector<HTMLButtonElement>(".drawio-preview-error-action")!;
    button.click();
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
  });
});

describe("ImagePreview", () => {
  it("src を img に反映し、ズームツールバーを描画する", () => {
    const el = render(<ImagePreview src="app://vault/x.svg?v=1" onRequestEdit={vi.fn()} />);
    const img = el.querySelector<HTMLImageElement>(".drawio-image-preview-img")!;
    expect(img.getAttribute("src")).toBe("app://vault/x.svg?v=1");
    // in/out/fit/reset の 4 ボタン
    expect(el.querySelectorAll(".drawio-image-preview-toolbar button").length).toBe(4);
  });

  it("ダブルクリックで onRequestEdit を呼ぶ", () => {
    const onRequestEdit = vi.fn();
    const el = render(<ImagePreview src="app://vault/x.svg" onRequestEdit={onRequestEdit} />);
    const viewport = el.querySelector<HTMLElement>(".drawio-image-preview-viewport")!;
    viewport.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    expect(onRequestEdit).toHaveBeenCalledTimes(1);
  });
});
