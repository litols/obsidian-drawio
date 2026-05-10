/**
 * drawio-bootstrap-html
 *
 * `data:text/html,<encodeURIComponent(...)>` に渡せる最小 HTML 文字列を生成する純関数。
 * 戻り値の HTML は:
 *   1. ロード時に window.parent へ {event:"iframe"} を postMessage する。
 *   2. message リスナで {action:"script", script: <source>} を受け取り、
 *      document.createElement('script') + script.text + document.head.appendChild で実行する。
 *   3. リスナは永続 (removeEventListener しない)。
 *
 * Requirements: 1.1, 3.1
 */

/** bootstrap HTML テンプレート文字列 (固定; ユーザ入力を含まない)
 *
 * meta http-equiv="Content-Security-Policy" は drawio webapp のサブリソース
 * (CSS / 画像 / フォント / 動的 script) を blob:/data: 由来 URL から読み込ませるために必要。
 * 親ウィンドウ (Obsidian) の CSP は style-src に blob: を含まないため、
 * 自前の CSP を上書き設定して blob:/data: を許可する。
 * 外部 HTTP ホストは default-src で禁止 (オフライン要件 4.2 に準拠)。
 */
const BOOTSTRAP_HTML = `<!DOCTYPE html>
<html style="height:100%;">
<head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob: data:; style-src 'unsafe-inline' blob: data:; img-src blob: data:; font-src blob: data:; connect-src blob: data:; frame-src blob: data:; worker-src blob:;">
<style>html,body{height:100%;margin:0;padding:0;overflow:hidden;}</style>
</head>
<body class="geEditor geClassic" style="height:100%;margin:0;">
<script>
(function () {
  // parent に iframe 準備完了を通知する
  window.parent.postMessage(JSON.stringify({ event: "iframe" }), "*");

  // parent からのスクリプト注入メッセージを受け付ける
  window.addEventListener("message", function (e) {
    var data;
    try {
      data = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
    } catch (_) {
      return;
    }
    if (!data || data.action !== "script" || typeof data.script !== "string") {
      return;
    }
    var s = document.createElement('script');
    s.text = data.script;
    document.head.appendChild(s);
  });
}());
</script>
</body>
</html>`;

/**
 * `data:text/html,<encodeURIComponent(returnValue)>` に連結できる
 * bootstrap HTML 文字列を返す純関数。
 *
 * @returns 最小 bootstrap HTML 文字列 (引数なし、常に同一文字列を返す)
 */
export function buildBootstrapHtml(): string {
  return BOOTSTRAP_HTML;
}

export type BuildBootstrapHtml = () => string;
