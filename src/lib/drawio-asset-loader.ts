import type { DataAdapter } from "obsidian";
import type {
  DrawioAssetBundle,
  DrawioResponseEntry,
} from "../iframe/shared/asset-types";

export type { DrawioAssetBundle, DrawioResponseEntry } from "../iframe/shared/asset-types";

// ──────────────────────────────────────────────
// MIME type マッピング
// ';base64' サフィックス付きのエントリはバイナリ (base64 エンコード) を示す
// ──────────────────────────────────────────────

const TEXT_MIME: Record<string, string> = {
  html: "text/html",
  js: "text/javascript",
  mjs: "text/javascript",
  css: "text/css",
  svg: "image/svg+xml",
  xml: "application/xml",
  txt: "text/plain",
  json: "application/json",
  map: "application/json",
};

const BINARY_MIME: Record<string, string> = {
  png: "image/png;base64",
  gif: "image/gif;base64",
  jpg: "image/jpeg;base64",
  jpeg: "image/jpeg;base64",
  webp: "image/webp;base64",
  woff: "font/woff;base64",
  woff2: "font/woff2;base64",
  ttf: "font/ttf;base64",
  otf: "font/otf;base64",
  ico: "image/x-icon;base64",
  eot: "application/vnd.ms-fontobject;base64",
};

function getMediaType(filePath: string): { mediaType: string; isBinary: boolean } | null {
  const dotIdx = filePath.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const ext = filePath.slice(dotIdx + 1).toLowerCase();

  const textMime = TEXT_MIME[ext];
  if (textMime !== undefined) return { mediaType: textMime, isBinary: false };

  const binaryMime = BINARY_MIME[ext];
  if (binaryMime !== undefined) return { mediaType: binaryMime, isBinary: true };

  return null;
}

// base64 エンコーダ (ArrayBuffer → base64 文字列)
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ──────────────────────────────────────────────
// DrawioAssetLoader インターフェース
// ──────────────────────────────────────────────

export interface DrawioAssetLoader {
  loadAll(): Promise<DrawioAssetBundle>;
  dispose(): void;
}

export type CreateDrawioAssetLoader = (
  adapter: DataAdapter,
  drawioDir: string,
) => DrawioAssetLoader;

// ──────────────────────────────────────────────
// ファクトリ実装
// ──────────────────────────────────────────────

export function createDrawioAssetLoader(
  adapter: DataAdapter,
  drawioDir: string,
): DrawioAssetLoader {
  let disposed = false;
  // 一時バッファへの参照 (dispose で解放)
  let internalBuffers: ArrayBuffer[] = [];

  /**
   * drawioDir 配下を再帰的に列挙してすべてのファイルパスを返す
   */
  async function listAllFiles(dir: string): Promise<string[]> {
    const result = await adapter.list(dir);
    const allFiles: string[] = [...result.files];
    for (const folder of result.folders) {
      const subFiles = await listAllFiles(folder);
      allFiles.push(...subFiles);
    }
    return allFiles;
  }

  /**
   * appJsSource の決定: app.min.js → app.js の順にフォールバック
   */
  async function resolveAppJsSource(dirPrefix: string): Promise<string> {
    const candidates = [
      `${dirPrefix}/js/app.min.js`,
      `${dirPrefix}/js/app.js`,
    ];
    for (const candidate of candidates) {
      const exists = await adapter.exists(candidate);
      if (exists) {
        return adapter.read(candidate);
      }
    }
    throw new DrawioAssetLoadError(
      "appJsSource: drawio app entry point not found (tried js/app.min.js and js/app.js)",
    );
  }

  return {
    async loadAll(): Promise<DrawioAssetBundle> {
      if (disposed) {
        throw new DrawioAssetLoadError(
          "DrawioAssetLoader has been disposed; create a new instance to load again",
        );
      }

      // drawioDir の末尾スラッシュを正規化
      const dir = drawioDir.endsWith("/") ? drawioDir.slice(0, -1) : drawioDir;

      // index.html の存在確認
      const indexHtmlPath = `${dir}/index.html`;
      const indexExists = await adapter.exists(indexHtmlPath);
      if (!indexExists) {
        throw new DrawioAssetLoadError(
          `index.html not found at: ${indexHtmlPath}`,
        );
      }

      // ファイル一覧を再帰列挙
      const allFiles = await listAllFiles(dir);

      // appJsSource を解決
      const appJsSource = await resolveAppJsSource(dir);

      // 各ファイルを並列読み込み
      const entries = await Promise.all(
        allFiles.map(async (filePath): Promise<DrawioResponseEntry | null> => {
          const mediaTypeInfo = getMediaType(filePath);
          if (!mediaTypeInfo) return null; // MIME 不明ファイルはスキップ

          // href は drawioDir からの相対パス
          const href = filePath.startsWith(dir + "/")
            ? filePath.slice(dir.length + 1)
            : filePath;

          let source: string;
          if (mediaTypeInfo.isBinary) {
            const buffer = await adapter.readBinary(filePath);
            internalBuffers.push(buffer);
            source = arrayBufferToBase64(buffer);
          } else {
            source = await adapter.read(filePath);
          }

          return {
            mediaType: mediaTypeInfo.mediaType,
            href,
            source,
          };
        }),
      );

      // null (MIME 不明) を除外
      const responses: DrawioResponseEntry[] = entries.filter(
        (e): e is DrawioResponseEntry => e !== null,
      );

      // indexHtml: responses から取得、なければ直接読む
      const indexHtmlEntry = responses.find((r) => r.href === "index.html");
      const indexHtml = indexHtmlEntry?.source ?? (await adapter.read(indexHtmlPath));

      return { responses, indexHtml, appJsSource };
    },

    dispose(): void {
      disposed = true;
      // 保持していた一時 ArrayBuffer バッファを解放
      internalBuffers = [];
    },
  };
}

// ──────────────────────────────────────────────
// エラー型
// ──────────────────────────────────────────────

export class DrawioAssetLoadError extends Error {
  override readonly name = "DrawioAssetLoadError";

  constructor(message: string) {
    super(message);
  }
}
