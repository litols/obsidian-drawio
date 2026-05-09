import * as React from "react";

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
      <span>{sourceHint ? `外部で更新されました (${sourceHint})` : "外部で更新されました"}</span>
      <button onClick={onReload}>Reload</button>
      <button onClick={onDiff}>Diff</button>
      <button onClick={onKeepMine}>Keep mine</button>
    </div>
  );
};
