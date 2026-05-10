import { describe, it, expect } from "vitest";

import { buildBootstrapHtml } from "./drawio-bootstrap-html";

describe("buildBootstrapHtml", () => {
  // Test 1: 戻り値は <script> ブロックを含む
  it("戻り値に <script> ブロックが含まれる", () => {
    const html = buildBootstrapHtml();
    expect(html).toContain("<script");
    expect(html).toContain("</script>");
  });

  // Test 2: window.parent.postMessage で {event:"iframe"} を送出するコードを含む
  it('戻り値に window.parent.postMessage と "iframe" イベント名が含まれる', () => {
    const html = buildBootstrapHtml();
    expect(html).toContain("window.parent.postMessage");
    expect(html).toContain('"iframe"');
  });

  // Test 3: document.createElement('script') と document.head.appendChild を含む
  it("戻り値に document.createElement('script') と document.head.appendChild が含まれる", () => {
    const html = buildBootstrapHtml();
    // シングルクォート or ダブルクォートどちらでも可
    const hasCreateElement =
      html.includes("document.createElement('script')") ||
      html.includes('document.createElement("script")');
    expect(hasCreateElement).toBe(true);
    expect(html).toContain("document.head.appendChild");
  });

  // Test 4: message リスナ登録 (addEventListener("message") または addEventListener('message')) を含む
  it('戻り値に addEventListener("message") が含まれる', () => {
    const html = buildBootstrapHtml();
    const hasListener =
      html.includes('addEventListener("message"') || html.includes("addEventListener('message'");
    expect(hasListener).toBe(true);
  });

  // Test 5: innerHTML / outerHTML / insertAdjacentHTML を含まない
  it("戻り値に innerHTML, outerHTML, insertAdjacentHTML が含まれない", () => {
    const html = buildBootstrapHtml();
    expect(html).not.toContain("innerHTML");
    expect(html).not.toContain("outerHTML");
    expect(html).not.toContain("insertAdjacentHTML");
  });

  // Test 6: 純関数 — 複数回呼び出しで同一文字列を返す
  it("複数回呼び出しで同一の文字列を返す (純関数)", () => {
    const result1 = buildBootstrapHtml();
    const result2 = buildBootstrapHtml();
    const result3 = buildBootstrapHtml();
    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
  });

  // Test 7: message リスナが action:"script" を受け取り script.text に代入して head に追加する
  it('action:"script" ペイロードを受け取り script.text に代入する処理が含まれる', () => {
    const html = buildBootstrapHtml();
    // script.text = source 相当の代入が行われること
    expect(html).toContain(".text");
    // action プロパティが参照されていること
    expect(html).toContain('"script"');
  });
});
