/**
 * iframe-init/user-pref-hooks
 *
 * drawio エディタ内でユーザーが直接操作した「ライブラリ集合 / テーマ / グリッド表示」
 * を捕捉し、親 (Obsidian プラグイン) に postMessage で通知するための monkey-patch 群。
 *
 * 設計方針:
 *   - drawio の内部 API (EditorUi.prototype.* / Graph.prototype.* / mxSettings) を
 *     ラップする。失敗してもサイレントに警告ログのみ — drawio 起動を絶対に妨げない。
 *   - drawio v29.7.12 を想定したメソッド名。将来 vendor 更新で名前が変わった場合は
 *     console.warn が観察される (機能が無効化されるだけ)。
 *   - 親側プロトコル: src/lib/drawio-protocol.ts の DrawioInboundUserPrefChange。
 *
 * Allowed imports: ブラウザグローバルのみ。obsidian / electron / node / src/lib/* は不可。
 */

// drawio の内部オブジェクトは型不明なので any を許容する。Lint は本ファイル内で局所無効化。
/* eslint-disable @typescript-eslint/no-explicit-any */

type UiVariant = "kennedy" | "atlas" | "min" | "sketch" | "dark";

interface UserPrefMessageLibraries {
  readonly event: "userPrefChange";
  readonly pref: "libraries";
  readonly value: { defaults: string[]; customs: string[] };
}

interface UserPrefMessageTheme {
  readonly event: "userPrefChange";
  readonly pref: "theme";
  readonly value: { setTheme: "light" | "dark"; uiVariant?: UiVariant };
}

interface UserPrefMessageGrid {
  readonly event: "userPrefChange";
  readonly pref: "grid";
  readonly value: boolean;
}

type UserPrefMessage = UserPrefMessageLibraries | UserPrefMessageTheme | UserPrefMessageGrid;

export interface InstallUserPrefHooksConfig {
  /** postMessage 先 (親ウィンドウ)。 */
  readonly parentWindow: Window;
  /** EditorUi グローバルを観察する対象ウィンドウ。テスト時は注入可能。 */
  readonly hostWindow?: Window;
  /** EditorUi 出現を待ち受けるタイムアウト (ms)。デフォルト 30s。 */
  readonly readyTimeoutMs?: number;
  /** ポーリング間隔 (ms)。デフォルト 100ms。 */
  readonly pollIntervalMs?: number;
}

/**
 * drawio が iframe 内で起動した後、ユーザー操作プリファレンスを親へ通知するための
 * monkey-patch をインストールする。設定の永続化は親側で行う (DrawioView)。
 *
 * 呼び出しは idempotent: 同一の EditorUi に対して二重に patch を当てない。
 */
export function installUserPrefHooks(config: InstallUserPrefHooksConfig): void {
  const host: any = config.hostWindow ?? window;
  const parent = config.parentWindow;
  const readyTimeoutMs = config.readyTimeoutMs ?? 30_000;
  const pollIntervalMs = config.pollIntervalMs ?? 100;

  function send(msg: UserPrefMessage): void {
    try {
      parent.postMessage(JSON.stringify(msg), "*");
    } catch (err) {
      console.warn("[user-pref-hooks] postMessage failed:", err);
    }
  }

  // EditorUi が drawio app.min.js 評価後に host 上に現れるのを待つ。
  const started = Date.now();
  const tick = (): void => {
    try {
      const proto = host.EditorUi?.prototype;
      if (proto && typeof proto.init === "function") {
        try {
          hookEditorUiClass(proto, send);
        } catch (err) {
          console.warn("[user-pref-hooks] hookEditorUiClass failed:", err);
        }
        return;
      }
    } catch {
      // ignore — host が破棄された等
    }
    if (Date.now() - started > readyTimeoutMs) {
      console.warn("[user-pref-hooks] EditorUi did not appear within timeout");
      return;
    }
    host.setTimeout?.(tick, pollIntervalMs);
  };
  tick();
}

// ─── EditorUi クラスレベルの patch ────────────────────────────────────────────

function hookEditorUiClass(proto: any, send: (msg: UserPrefMessage) => void): void {
  if (proto.__userPrefHookInstalled) return;
  proto.__userPrefHookInstalled = true;

  const origInit = proto.init;
  proto.init = function patchedInit(this: any): any {
    const result = origInit.apply(this, arguments as any);
    try {
      installInstanceHooks(this, send);
    } catch (err) {
      console.warn("[user-pref-hooks] installInstanceHooks failed:", err);
    }
    return result;
  };

  // setCurrentTheme: ユーザーが View > Theme を切り替えると呼ばれる。
  if (typeof proto.setCurrentTheme === "function") {
    const origSetTheme = proto.setCurrentTheme;
    proto.setCurrentTheme = function patchedSetCurrentTheme(value: unknown): any {
      const result = origSetTheme.apply(this, arguments as any);
      try {
        emitTheme(typeof value === "string" ? value : "", send);
      } catch (err) {
        console.warn("[user-pref-hooks] theme emit failed:", err);
      }
      return result;
    };
  }
}

// ─── EditorUi インスタンスレベルの hook ───────────────────────────────────────

function installInstanceHooks(editorUi: any, send: (msg: UserPrefMessage) => void): void {
  // Grid: graph.setGridEnabled(value) は View > Grid トグル / グリッドボタンから呼ばれる。
  try {
    const graph = editorUi?.editor?.graph;
    if (graph && typeof graph.setGridEnabled === "function" && !graph.__userPrefGridHooked) {
      graph.__userPrefGridHooked = true;
      const origSetGridEnabled = graph.setGridEnabled;
      graph.setGridEnabled = function patchedSetGridEnabled(value: unknown): any {
        const result = origSetGridEnabled.apply(this, arguments as any);
        try {
          send({ event: "userPrefChange", pref: "grid", value: Boolean(value) });
        } catch (err) {
          console.warn("[user-pref-hooks] grid emit failed:", err);
        }
        return result;
      };
    }
  } catch (err) {
    console.warn("[user-pref-hooks] grid hook failed:", err);
  }

  // Libraries: ユーザーが "Shapes..." (Edit Shapes / More Shapes) で適用すると
  // drawio は内部的に mxSettings.currentLibraries を更新し mxSettings.save() を呼ぶ。
  // mxSettings は drawio app.min.js の評価後に window 上にぶら下がる。
  try {
    hookMxSettings(send);
  } catch (err) {
    console.warn("[user-pref-hooks] mxSettings hook failed:", err);
  }
}

// ─── mxSettings.save を hook してライブラリ集合の変化を捕捉 ──────────────────

function hookMxSettings(send: (msg: UserPrefMessage) => void): void {
  const w: any = window;
  const mxSettings = w.mxSettings;
  if (!mxSettings) {
    // embed モードでは mxSettings が存在しないケースがある。サイレントに諦める。
    return;
  }
  if (mxSettings.__userPrefHooked) return;
  mxSettings.__userPrefHooked = true;

  // 変化検出用: 直前に送ったライブラリ集合のシリアライズ
  let lastSerialized = "";

  function emit(): void {
    try {
      const libs = readCurrentLibraries(mxSettings);
      const serialized = JSON.stringify(libs);
      if (serialized === lastSerialized) return;
      lastSerialized = serialized;
      send({ event: "userPrefChange", pref: "libraries", value: libs });
    } catch (err) {
      console.warn("[user-pref-hooks] library emit failed:", err);
    }
  }

  if (typeof mxSettings.save === "function") {
    const origSave = mxSettings.save;
    mxSettings.save = function patchedMxSettingsSave(this: any): any {
      const result = origSave.apply(this, arguments as any);
      emit();
      return result;
    };
  }

  // 初期値もシリアライズ済みとしてキャッシュ (起動直後の差分を無駄送信しない)
  try {
    lastSerialized = JSON.stringify(readCurrentLibraries(mxSettings));
  } catch {
    // ignore
  }
}

// drawio 内部から「現在有効なライブラリ集合」を取り出す。
// drawio は内蔵ライブラリを `mxSettings.currentLibraries` (semicolon-separated string)
// として、カスタムライブラリを `mxSettings.customLibraries` (配列 / オブジェクト) として
// 保持する。embed モードでは両方が存在しないこともある。
function readCurrentLibraries(mxSettings: any): { defaults: string[]; customs: string[] } {
  const defaults: string[] = [];
  const customs: string[] = [];

  try {
    const cur = mxSettings.currentLibraries ?? mxSettings.settings?.libraries;
    if (typeof cur === "string" && cur.length > 0) {
      for (const id of cur.split(";")) {
        const trimmed = id.trim();
        if (trimmed) defaults.push(trimmed);
      }
    } else if (Array.isArray(cur)) {
      for (const id of cur) {
        if (typeof id === "string" && id.length > 0) defaults.push(id);
      }
    }
  } catch {
    // ignore
  }

  try {
    const cust = mxSettings.customLibraries ?? mxSettings.settings?.customLibraries;
    if (Array.isArray(cust)) {
      for (const entry of cust) {
        if (typeof entry === "string") {
          customs.push(entry);
        } else if (entry && typeof entry.title === "string") {
          customs.push(entry.title as string);
        }
      }
    }
  } catch {
    // ignore
  }

  return { defaults, customs };
}

// ─── theme 変更通知 ──────────────────────────────────────────────────────────

function emitTheme(value: string, send: (msg: UserPrefMessage) => void): void {
  // drawio が認識する theme 値: "default" / "kennedy" / "atlas" / "min" / "dark" / "sketch"
  let setTheme: "light" | "dark" = "light";
  let uiVariant: UiVariant | undefined;
  switch (value) {
    case "dark":
      setTheme = "dark";
      uiVariant = "dark";
      break;
    case "kennedy":
    case "atlas":
    case "min":
    case "sketch":
      uiVariant = value;
      break;
    default:
      uiVariant = undefined;
  }
  send({ event: "userPrefChange", pref: "theme", value: { setTheme, uiVariant } });
}
