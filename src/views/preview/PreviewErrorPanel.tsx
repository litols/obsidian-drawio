import * as React from "react";
import { t } from "../../lib/i18n";

export interface PreviewErrorPanelProps {
  message: string;
  /** 「エディタで開く」導線 (要件 1.5) */
  onOpenEditor: () => void;
}

/**
 * プレビュー描画失敗時のエラーパネル。閲覧の完全遮断を避けるため、
 * メッセージとともに「エディタで開く」導線を提示する (要件 1.5)。
 */
export const PreviewErrorPanel: React.FC<PreviewErrorPanelProps> = ({ message, onOpenEditor }) => (
  <div className="drawio-preview-error" role="alert">
    <p className="drawio-preview-error-message">{message}</p>
    <button type="button" className="drawio-preview-error-action mod-cta" onClick={onOpenEditor}>
      {t("preview.openEditor")}
    </button>
  </div>
);
