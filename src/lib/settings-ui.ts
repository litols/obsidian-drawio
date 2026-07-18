/**
 * 設定タブのライブラリ一覧編集ロジックを純関数として抽出したモジュール。
 * DOM を持たないため vitest で挙動を固定できる (Setting API の DOM は単体テスト不向き)。
 * 既存 SettingsTab.tsx の validate / dedupe ロジックと同一の判定結果を返す。
 */

/** カスタムライブラリパスの検証エラー種別。文言 (i18n) はコール側で解決する。 */
export type LibraryPathError = "empty" | "externalUrl" | "absolute";

/**
 * カスタムライブラリパスを検証する。
 * 空文字 / 外部 URL スキーム (http/file/app 等) / 絶対パスを拒否し、
 * 問題なければ null を返す。入力は破壊しない。
 */
export function validateCustomLibraryPath(input: string): LibraryPathError | null {
  const trimmed = input.trim();
  if (!trimmed) return "empty";
  if (/^https?:|^file:|^app:|:\/\//.test(trimmed)) return "externalUrl";
  if (trimmed.startsWith("/") || /^[A-Z]:[\\/]/i.test(trimmed)) return "absolute";
  return null;
}

/**
 * trim したエントリを重複排除しつつ末尾に追加した新しい配列を返す。
 * 空文字や既存重複の場合は変更がないため元配列をそのまま返す (immutable)。
 */
export function addUniqueEntry(list: readonly string[], entry: string): string[] {
  const trimmed = entry.trim();
  if (trimmed === "" || list.includes(trimmed)) {
    return list as string[];
  }
  return [...list, trimmed];
}
