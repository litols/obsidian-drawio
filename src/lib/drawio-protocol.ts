export type DrawioInboundInit = {
  event: "init";
};

export type DrawioInboundLoad = {
  event: "load";
  xml: string;
};

export type DrawioInboundAutosave = {
  event: "autosave";
  xml: string;
};

export type DrawioInboundSave = {
  event: "save";
  xml: string;
  exit?: boolean;
};

export type DrawioInboundExport = {
  event: "export";
  data: string;
  format: string;
  message: DrawioOutboundExport;
};

export type DrawioInboundExit = {
  event: "exit";
};

export type DrawioInboundDialog = {
  event: "dialog";
  title?: string;
  message: string;
  button?: string;
  modified?: boolean;
};

export type DrawioInboundPrompt = {
  event: "prompt";
  title: string;
  value?: string;
};

// drawio エディタ内でユーザーが直接変更したプリファレンスを親へ通知する非標準イベント。
// iframe 側で drawio 内部メソッドを monkey-patch して発火させる (src/iframe/init/user-pref-hooks.ts)。
export type DrawioInboundUserPrefChangeLibraries = {
  event: "userPrefChange";
  pref: "libraries";
  value: { defaults: string[]; customs: string[] };
};

export type DrawioInboundUserPrefChangeTheme = {
  event: "userPrefChange";
  pref: "theme";
  value: {
    setTheme: "light" | "dark";
    uiVariant?: "kennedy" | "atlas" | "min" | "sketch" | "dark";
  };
};

export type DrawioInboundUserPrefChangeGrid = {
  event: "userPrefChange";
  pref: "grid";
  value: boolean;
};

export type DrawioInboundUserPrefChange =
  | DrawioInboundUserPrefChangeLibraries
  | DrawioInboundUserPrefChangeTheme
  | DrawioInboundUserPrefChangeGrid;

export type DrawioInbound =
  | DrawioInboundInit
  | DrawioInboundLoad
  | DrawioInboundAutosave
  | DrawioInboundSave
  | DrawioInboundExport
  | DrawioInboundExit
  | DrawioInboundDialog
  | DrawioInboundPrompt
  | DrawioInboundUserPrefChange;

export type DrawioOutboundLoad = {
  action: "load";
  xml: string;
  autosave?: 0 | 1;
};

export type DrawioOutboundMerge = {
  action: "merge";
  xml: string;
};

export type DrawioOutboundConfigure = {
  action: "configure";
  config: Record<string, unknown>;
};

export type DrawioOutboundLayout = {
  action: "layout";
  layouts: unknown[];
};

export type DrawioOutboundExport = {
  action: "export";
  // 'xmlpng' / 'xmlsvg' は mxfile XML を PNG/SVG バイナリに埋め込む drawio embed 標準 format。drawio-file-io が lossless 保存に使用する。
  format: "png" | "svg" | "xml" | "pdf" | "xmlpng" | "xmlsvg";
  xml?: string;
  spin?: string;
  scale?: number;
  border?: number;
};

export type DrawioOutbound =
  | DrawioOutboundLoad
  | DrawioOutboundMerge
  | DrawioOutboundConfigure
  | DrawioOutboundLayout
  | DrawioOutboundExport;
