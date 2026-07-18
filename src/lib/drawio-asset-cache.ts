/**
 * drawio-asset-cache
 *
 * アセット I/O の唯一の所有者。エディタバンドル (除外マニフェスト適用済み) と
 * viewer スクリプトをセッション内で 1 度だけディスクから読み込み、以後メモリから供給する。
 * 並行要求は single-flight (同一 Promise 共有)。ロード失敗時はメモを破棄し次回リトライ可能。
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4
 */

import type { DataAdapter } from "obsidian";
import type { DrawioAssetBundle } from "../iframe/shared/asset-types";
import { createDrawioAssetLoader, isExcludedEditorAsset } from "./drawio-asset-loader";

const LOG_PREFIX = "[drawio-preview]";

export interface DrawioAssetProvider {
  loadAll(): Promise<DrawioAssetBundle>;
}

export interface DrawioAssetCache extends DrawioAssetProvider {
  /** エディタバンドル (除外マニフェスト適用済み)。メモ化 + single-flight */
  loadAll(): Promise<DrawioAssetBundle>;
  /** viewer-static.min.js のソース文字列。メモ化 + single-flight */
  getViewerScript(): Promise<string>;
  /** メモを破棄 (次回アクセスで再ロード) */
  invalidate(): void;
  /** 全資源解放。以後の呼び出しは invalidate 済みとして再ロード */
  dispose(): void;
}

export function createDrawioAssetCache(
  adapter: DataAdapter,
  pluginDir: string,
): DrawioAssetCache {
  const drawioDir = pluginDir ? `${pluginDir}/drawio` : "drawio";

  // single-flight 用にメモ化した Promise。null はメモ未保持を表す。
  let bundlePromise: Promise<DrawioAssetBundle> | null = null;
  let viewerPromise: Promise<string> | null = null;

  async function loadBundleFromDisk(): Promise<DrawioAssetBundle> {
    // ディスクロードの実行回数を観測するためのデバッグログ (E2E 5.2 の計装根拠)
    console.debug(`${LOG_PREFIX} asset-cache: loading editor bundle from disk`);
    const loader = createDrawioAssetLoader(adapter, drawioDir, {
      exclude: isExcludedEditorAsset,
    });
    try {
      return await loader.loadAll();
    } finally {
      loader.dispose();
    }
  }

  async function loadViewerFromDisk(): Promise<string> {
    console.debug(`${LOG_PREFIX} asset-cache: loading viewer script from disk`);
    return adapter.read(`${drawioDir}/js/viewer-static.min.js`);
  }

  return {
    loadAll(): Promise<DrawioAssetBundle> {
      if (bundlePromise === null) {
        bundlePromise = loadBundleFromDisk().catch((err: unknown) => {
          // 失敗時はメモを破棄し次回呼び出しで再試行できるようにする (要件 5.3)
          bundlePromise = null;
          throw err;
        });
      }
      return bundlePromise;
    },

    getViewerScript(): Promise<string> {
      if (viewerPromise === null) {
        viewerPromise = loadViewerFromDisk().catch((err: unknown) => {
          viewerPromise = null;
          throw err;
        });
      }
      return viewerPromise;
    },

    invalidate(): void {
      bundlePromise = null;
      viewerPromise = null;
    },

    dispose(): void {
      console.debug(`${LOG_PREFIX} asset-cache: dispose (releasing cached assets)`);
      bundlePromise = null;
      viewerPromise = null;
    },
  };
}
