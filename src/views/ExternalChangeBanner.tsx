import * as React from "react";
import { t } from "../lib/i18n";

export interface ExternalChangeBannerProps {
  sourceHint?: string;
  onReload: () => void;
  onDiff: () => void;
  onKeepMine: () => void;
}

export const ExternalChangeBanner: React.FC<ExternalChangeBannerProps> = ({
  sourceHint,
  onReload,
  onDiff,
  onKeepMine,
}) => {
  return (
    <div
      className="drawio-external-change-banner"
      style={{
        padding: "8px 12px",
        background: "var(--background-secondary)",
        borderBottom: "1px solid var(--background-modifier-border)",
        display: "flex",
        gap: "8px",
        alignItems: "center",
      }}
    >
      <span>
        {sourceHint
          ? t("banner.externalUpdatedWithHint", { source: sourceHint })
          : t("banner.externalUpdated")}
      </span>
      <button onClick={onReload}>{t("banner.reload")}</button>
      <button onClick={onDiff}>{t("banner.diff")}</button>
      <button onClick={onKeepMine}>{t("banner.keepMine")}</button>
    </div>
  );
};
