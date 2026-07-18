import type { DrawioFormat } from "./drawio-formats";

/**
 * プレビュー表示戦略。
 * - "image": ファイル内包のレンダリング済み画像 (svg / png) を直接表示する
 * - "graph-viewer": GraphViewer で XML を描画する (複数ページ対応)
 */
export type PreviewStrategy = "image" | "graph-viewer";

/**
 * mxfile 内の `<diagram>` 要素数 (= ページ数) を返す。
 * XML が空・パース不能・diagram 要素なしの場合は 1 ページ扱い (1 を返す)。
 */
export function countDiagramPages(xml: string): number {
  if (typeof xml !== "string" || xml.trim() === "") return 1;
  try {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.getElementsByTagName("parsererror").length > 0) return 1;
    const diagrams = doc.getElementsByTagName("diagram");
    return diagrams.length > 0 ? diagrams.length : 1;
  } catch {
    return 1;
  }
}

/**
 * ファイル形式と抽出済み XML からプレビュー戦略を決定する。
 * svg / png の内包画像は現在ページのみのレンダリングであるため、
 * 単一ページのときのみ "image"。複数ページ・XML はすべて "graph-viewer"。
 */
export function selectPreviewStrategy(format: DrawioFormat, xml: string): PreviewStrategy {
  if (format === "drawio-svg" || format === "drawio-png") {
    return countDiagramPages(xml) <= 1 ? "image" : "graph-viewer";
  }
  return "graph-viewer";
}
