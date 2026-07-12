import { describe, it, expect } from "vitest";
import {
  migrateSettings,
  DEFAULT_DRAWIO_SETTINGS,
  DEFAULT_EXTERNAL_SYNC_SETTINGS,
} from "./settings";

describe("migrateSettings", () => {
  describe("null / undefined / 非オブジェクト入力", () => {
    it("null はデフォルト設定を返す", () => {
      const result = migrateSettings(null);
      expect(result).toEqual({ ...DEFAULT_DRAWIO_SETTINGS, settingsVersion: 2 });
    });

    it("undefined はデフォルト設定を返す", () => {
      const result = migrateSettings(undefined);
      expect(result).toEqual({ ...DEFAULT_DRAWIO_SETTINGS, settingsVersion: 2 });
    });

    it("文字列はデフォルト設定を返す", () => {
      const result = migrateSettings("invalid");
      expect(result).toEqual({ ...DEFAULT_DRAWIO_SETTINGS, settingsVersion: 2 });
    });

    it("数値はデフォルト設定を返す", () => {
      const result = migrateSettings(42);
      expect(result).toEqual({ ...DEFAULT_DRAWIO_SETTINGS, settingsVersion: 2 });
    });

    it("真偽値はデフォルト設定を返す", () => {
      const result = migrateSettings(true);
      expect(result).toEqual({ ...DEFAULT_DRAWIO_SETTINGS, settingsVersion: 2 });
    });

    it("空配列はデフォルト設定を返す", () => {
      const result = migrateSettings([]);
      expect(result).toEqual({ ...DEFAULT_DRAWIO_SETTINGS, settingsVersion: 2 });
    });
  });

  describe("空オブジェクト / drawio なし", () => {
    it("空オブジェクトはデフォルト設定を返す", () => {
      const result = migrateSettings({});
      expect(result).toEqual({ ...DEFAULT_DRAWIO_SETTINGS, settingsVersion: 2 });
    });

    it("drawio フィールドなし + 無関係フィールドのみ → デフォルト設定を返す", () => {
      const result = migrateSettings({ unrelated: "value" });
      expect(result).toEqual({ ...DEFAULT_DRAWIO_SETTINGS, settingsVersion: 2 });
    });

    it("drawio フィールドが null → drawio なし扱いでデフォルトを返す", () => {
      const result = migrateSettings({ drawio: null });
      expect(result).toEqual({ ...DEFAULT_DRAWIO_SETTINGS, settingsVersion: 2 });
    });

    it("drawio フィールドが文字列 → drawio なし扱いでデフォルトを返す", () => {
      const result = migrateSettings({ drawio: "not-an-object" });
      expect(result).toEqual({ ...DEFAULT_DRAWIO_SETTINGS, settingsVersion: 2 });
    });
  });

  describe("legacy トップレベルフィールドの吸収", () => {
    it("openDrawioSvg=false が drawio.openDrawioSvg に反映される", () => {
      const result = migrateSettings({ openDrawioSvg: false });
      expect(result.openDrawioSvg).toBe(false);
    });

    it("openDrawioPng=false が drawio.openDrawioPng に反映される", () => {
      const result = migrateSettings({ openDrawioPng: false });
      expect(result.openDrawioPng).toBe(false);
    });

    it("preserveCompression=false が drawio.compression に反映される", () => {
      const result = migrateSettings({ preserveCompression: false });
      expect(result.compression).toBe(false);
    });

    it("preserveCompression=true が drawio.compression に反映される", () => {
      const result = migrateSettings({ preserveCompression: true });
      expect(result.compression).toBe(true);
    });

    it("legacy openDrawioSvg=true (drawio 名前空間なし) → openDrawioSvg=true", () => {
      const result = migrateSettings({ openDrawioSvg: true });
      expect(result.openDrawioSvg).toBe(true);
    });

    it("drawio.openDrawioSvg が存在する場合は legacy より優先される", () => {
      const result = migrateSettings({
        openDrawioSvg: false,
        drawio: { openDrawioSvg: true },
      });
      expect(result.openDrawioSvg).toBe(true);
    });

    it("drawio.openDrawioPng が存在する場合は legacy より優先される", () => {
      const result = migrateSettings({
        openDrawioPng: false,
        drawio: { openDrawioPng: true },
      });
      expect(result.openDrawioPng).toBe(true);
    });

    it("drawio.compression が存在する場合は legacy preserveCompression より優先される", () => {
      const result = migrateSettings({
        preserveCompression: false,
        drawio: { compression: true },
      });
      expect(result.compression).toBe(true);
    });

    it("legacy フィールドが非 boolean → 無視してデフォルトを使う", () => {
      const result = migrateSettings({
        openDrawioSvg: "yes",
        openDrawioPng: 1,
        preserveCompression: "true",
      });
      expect(result.openDrawioSvg).toBe(DEFAULT_DRAWIO_SETTINGS.openDrawioSvg);
      expect(result.openDrawioPng).toBe(DEFAULT_DRAWIO_SETTINGS.openDrawioPng);
      expect(result.compression).toBe(DEFAULT_DRAWIO_SETTINGS.compression);
    });
  });

  describe("theme の検証", () => {
    it.each(["auto", "light", "dark", "kennedy", "min", "atlas"] as const)(
      "有効な theme '%s' がそのまま採用される",
      (theme) => {
        const result = migrateSettings({ drawio: { theme } });
        expect(result.theme).toBe(theme);
      },
    );

    it("無効な theme 文字列 → デフォルト theme を返す", () => {
      const result = migrateSettings({ drawio: { theme: "invalid-theme" } });
      expect(result.theme).toBe(DEFAULT_DRAWIO_SETTINGS.theme);
    });

    it("theme が数値 → デフォルト theme を返す", () => {
      const result = migrateSettings({ drawio: { theme: 42 } });
      expect(result.theme).toBe(DEFAULT_DRAWIO_SETTINGS.theme);
    });

    it("theme が undefined → デフォルト theme を返す", () => {
      const result = migrateSettings({ drawio: {} });
      expect(result.theme).toBe(DEFAULT_DRAWIO_SETTINGS.theme);
    });
  });

  describe("language の検証", () => {
    it.each([
      "auto",
      "en",
      "ja",
      "zh",
      "de",
      "fr",
      "es",
      "pt",
      "ru",
      "ko",
      "pl",
      "nl",
      "it",
    ] as const)("有効な language '%s' がそのまま採用される", (language) => {
      const result = migrateSettings({ drawio: { language } });
      expect(result.language).toBe(language);
    });

    it("無効な language → デフォルト language を返す", () => {
      const result = migrateSettings({ drawio: { language: "xx" } });
      expect(result.language).toBe(DEFAULT_DRAWIO_SETTINGS.language);
    });
  });

  describe("defaultSaveFormat の検証", () => {
    it.each(["keep", "drawio"] as const)(
      "有効な defaultSaveFormat '%s' がそのまま採用される",
      (fmt) => {
        const result = migrateSettings({ drawio: { defaultSaveFormat: fmt } });
        expect(result.defaultSaveFormat).toBe(fmt);
      },
    );

    it("無効な defaultSaveFormat → デフォルトを返す", () => {
      const result = migrateSettings({ drawio: { defaultSaveFormat: "xml" } });
      expect(result.defaultSaveFormat).toBe(DEFAULT_DRAWIO_SETTINGS.defaultSaveFormat);
    });
  });

  describe("defaultLibraries / customLibraries の検証", () => {
    it("string 配列がそのまま採用される", () => {
      const result = migrateSettings({ drawio: { defaultLibraries: ["general", "aws4"] } });
      expect(result.defaultLibraries).toEqual(["general", "aws4"]);
    });

    it("非 string 混入は除外される", () => {
      const result = migrateSettings({
        drawio: { defaultLibraries: ["general", 42, null, "aws4"] },
      });
      expect(result.defaultLibraries).toEqual(["general", "aws4"]);
    });

    it("空配列は空配列として採用される", () => {
      const result = migrateSettings({ drawio: { defaultLibraries: [] } });
      expect(result.defaultLibraries).toEqual([]);
    });

    it("配列でない場合はデフォルトを返す", () => {
      const result = migrateSettings({ drawio: { defaultLibraries: "general" } });
      expect(result.defaultLibraries).toEqual(DEFAULT_DRAWIO_SETTINGS.defaultLibraries);
    });

    it("customLibraries が string 配列として採用される", () => {
      const result = migrateSettings({ drawio: { customLibraries: ["mylib"] } });
      expect(result.customLibraries).toEqual(["mylib"]);
    });

    it("baselineLibraries が未指定なら drawio 既定 7 カテゴリで seed される", () => {
      const result = migrateSettings({ drawio: {} });
      expect(result.baselineLibraries).toEqual(DEFAULT_DRAWIO_SETTINGS.baselineLibraries);
    });

    it("baselineLibraries に空配列を明示指定するとその通り採用される", () => {
      const result = migrateSettings({ drawio: { baselineLibraries: [] } });
      expect(result.baselineLibraries).toEqual([]);
    });

    it("baselineLibraries に string 配列を指定するとそのまま採用される", () => {
      const result = migrateSettings({ drawio: { baselineLibraries: ["general", "basic"] } });
      expect(result.baselineLibraries).toEqual(["general", "basic"]);
    });
  });

  describe("boolean フィールド (math / grid / ribbonEnabled / compression) の検証", () => {
    it("math=true が反映される", () => {
      expect(migrateSettings({ drawio: { math: true } }).math).toBe(true);
    });

    it("math=false が反映される", () => {
      expect(migrateSettings({ drawio: { math: false } }).math).toBe(false);
    });

    it("math が非 boolean → デフォルトを返す", () => {
      expect(migrateSettings({ drawio: { math: "yes" } }).math).toBe(DEFAULT_DRAWIO_SETTINGS.math);
    });

    it("grid=false が反映される", () => {
      expect(migrateSettings({ drawio: { grid: false } }).grid).toBe(false);
    });

    it("ribbonEnabled=false が反映される", () => {
      expect(migrateSettings({ drawio: { ribbonEnabled: false } }).ribbonEnabled).toBe(false);
    });

    it("compression=false が反映される", () => {
      expect(migrateSettings({ drawio: { compression: false } }).compression).toBe(false);
    });
  });

  describe("settingsVersion と externalSync の v1→v2 移行", () => {
    it("settingsVersion 未指定 → v1 扱いで externalSync はデフォルトに置換", () => {
      const result = migrateSettings({ drawio: {} });
      expect(result.settingsVersion).toBe(2);
      expect(result.externalSync).toEqual(DEFAULT_EXTERNAL_SYNC_SETTINGS);
    });

    it("settingsVersion=1 → externalSync はデフォルトに置換", () => {
      const result = migrateSettings({
        drawio: {
          settingsVersion: 1,
          externalSync: { autoReloadWhenClean: false },
        },
      });
      expect(result.settingsVersion).toBe(2);
      expect(result.externalSync).toEqual(DEFAULT_EXTERNAL_SYNC_SETTINGS);
    });

    it("settingsVersion=2 かつ externalSync あり → フィールドが保持される", () => {
      const result = migrateSettings({
        drawio: {
          settingsVersion: 2,
          externalSync: {
            autoReloadWhenClean: false,
            notifyOnExternalChange: false,
            notificationLevel: "silent",
            echoSuppressionMs: 500,
            dedupDebounceMs: 200,
          },
        },
      });
      expect(result.externalSync.autoReloadWhenClean).toBe(false);
      expect(result.externalSync.notifyOnExternalChange).toBe(false);
      expect(result.externalSync.notificationLevel).toBe("silent");
      expect(result.externalSync.echoSuppressionMs).toBe(500);
      expect(result.externalSync.dedupDebounceMs).toBe(200);
    });

    it("settingsVersion=2 かつ externalSync=null → デフォルト externalSync を補完", () => {
      const result = migrateSettings({
        drawio: { settingsVersion: 2, externalSync: null },
      });
      expect(result.externalSync).toEqual(DEFAULT_EXTERNAL_SYNC_SETTINGS);
    });

    it("externalSync.notificationLevel が無効値 → デフォルトを返す", () => {
      const result = migrateSettings({
        drawio: {
          settingsVersion: 2,
          externalSync: { notificationLevel: "unknown" },
        },
      });
      expect(result.externalSync.notificationLevel).toBe(
        DEFAULT_EXTERNAL_SYNC_SETTINGS.notificationLevel,
      );
    });

    it.each(["silent", "statusbar", "notice", "banner"] as const)(
      "externalSync.notificationLevel '%s' が採用される",
      (level) => {
        const result = migrateSettings({
          drawio: {
            settingsVersion: 2,
            externalSync: { notificationLevel: level },
          },
        });
        expect(result.externalSync.notificationLevel).toBe(level);
      },
    );

    it("externalSync.echoSuppressionMs が非数値 → デフォルト値", () => {
      const result = migrateSettings({
        drawio: {
          settingsVersion: 2,
          externalSync: { echoSuppressionMs: "500" },
        },
      });
      expect(result.externalSync.echoSuppressionMs).toBe(
        DEFAULT_EXTERNAL_SYNC_SETTINGS.echoSuppressionMs,
      );
    });

    it("externalSync.dedupDebounceMs が非数値 → デフォルト値", () => {
      const result = migrateSettings({
        drawio: {
          settingsVersion: 2,
          externalSync: { dedupDebounceMs: "100" },
        },
      });
      expect(result.externalSync.dedupDebounceMs).toBe(
        DEFAULT_EXTERNAL_SYNC_SETTINGS.dedupDebounceMs,
      );
    });
  });

  describe("settingsVersion の出力固定", () => {
    it("出力の settingsVersion は常に 2", () => {
      expect(migrateSettings(null).settingsVersion).toBe(2);
      expect(migrateSettings({}).settingsVersion).toBe(2);
      expect(migrateSettings({ drawio: { settingsVersion: 1 } }).settingsVersion).toBe(2);
      expect(migrateSettings({ drawio: { settingsVersion: 2 } }).settingsVersion).toBe(2);
      expect(migrateSettings({ drawio: { settingsVersion: 99 } }).settingsVersion).toBe(2);
    });
  });
});
