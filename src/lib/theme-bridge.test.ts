import { describe, it, expect } from "vitest";
import { resolveBridgeTheme } from "./theme-bridge";
import type { Theme } from "./theme";

const LIGHT: Theme = "light";
const DARK: Theme = "dark";

describe("resolveBridgeTheme", () => {
  describe("auto: Obsidian 現在テーマに追従", () => {
    it("auto + obsidian=light → setTheme=light, uiVariant なし", () => {
      expect(resolveBridgeTheme("auto", LIGHT)).toEqual({ setTheme: "light" });
    });

    it("auto + obsidian=dark → setTheme=dark, uiVariant なし", () => {
      expect(resolveBridgeTheme("auto", DARK)).toEqual({ setTheme: "dark" });
    });
  });

  describe("light: 常に light テーマ", () => {
    it("light + obsidian=light → setTheme=light, uiVariant なし", () => {
      expect(resolveBridgeTheme("light", LIGHT)).toEqual({ setTheme: "light" });
    });

    it("light + obsidian=dark → setTheme=light, uiVariant なし (obsidian テーマは無視)", () => {
      expect(resolveBridgeTheme("light", DARK)).toEqual({ setTheme: "light" });
    });
  });

  describe("dark: dark テーマ + uiVariant=dark", () => {
    it("dark + obsidian=light → setTheme=dark, uiVariant=dark", () => {
      expect(resolveBridgeTheme("dark", LIGHT)).toEqual({ setTheme: "dark", uiVariant: "dark" });
    });

    it("dark + obsidian=dark → setTheme=dark, uiVariant=dark", () => {
      expect(resolveBridgeTheme("dark", DARK)).toEqual({ setTheme: "dark", uiVariant: "dark" });
    });
  });

  describe("kennedy: light ベース + uiVariant=kennedy", () => {
    it("kennedy + obsidian=light → setTheme=light, uiVariant=kennedy", () => {
      expect(resolveBridgeTheme("kennedy", LIGHT)).toEqual({
        setTheme: "light",
        uiVariant: "kennedy",
      });
    });

    it("kennedy + obsidian=dark → setTheme=light, uiVariant=kennedy (obsidian テーマは無視)", () => {
      expect(resolveBridgeTheme("kennedy", DARK)).toEqual({
        setTheme: "light",
        uiVariant: "kennedy",
      });
    });
  });

  describe("min: light ベース + uiVariant=min", () => {
    it("min + obsidian=light → setTheme=light, uiVariant=min", () => {
      expect(resolveBridgeTheme("min", LIGHT)).toEqual({ setTheme: "light", uiVariant: "min" });
    });

    it("min + obsidian=dark → setTheme=light, uiVariant=min", () => {
      expect(resolveBridgeTheme("min", DARK)).toEqual({ setTheme: "light", uiVariant: "min" });
    });
  });

  describe("atlas: light ベース + uiVariant=atlas", () => {
    it("atlas + obsidian=light → setTheme=light, uiVariant=atlas", () => {
      expect(resolveBridgeTheme("atlas", LIGHT)).toEqual({ setTheme: "light", uiVariant: "atlas" });
    });

    it("atlas + obsidian=dark → setTheme=light, uiVariant=atlas", () => {
      expect(resolveBridgeTheme("atlas", DARK)).toEqual({ setTheme: "light", uiVariant: "atlas" });
    });
  });

  describe("uiVariant の有無の対称性", () => {
    it("auto / light は uiVariant を持たない", () => {
      expect(resolveBridgeTheme("auto", LIGHT).uiVariant).toBeUndefined();
      expect(resolveBridgeTheme("auto", DARK).uiVariant).toBeUndefined();
      expect(resolveBridgeTheme("light", LIGHT).uiVariant).toBeUndefined();
      expect(resolveBridgeTheme("light", DARK).uiVariant).toBeUndefined();
    });

    it("dark / kennedy / min / atlas は uiVariant を持つ", () => {
      expect(resolveBridgeTheme("dark", LIGHT).uiVariant).toBe("dark");
      expect(resolveBridgeTheme("kennedy", LIGHT).uiVariant).toBe("kennedy");
      expect(resolveBridgeTheme("min", LIGHT).uiVariant).toBe("min");
      expect(resolveBridgeTheme("atlas", LIGHT).uiVariant).toBe("atlas");
    });
  });

  describe("setTheme の値域", () => {
    it("setTheme は常に 'light' または 'dark'", () => {
      const themes = ["auto", "light", "dark", "kennedy", "min", "atlas"] as const;
      const obsidianThemes: Theme[] = ["light", "dark"];
      for (const setting of themes) {
        for (const obsidian of obsidianThemes) {
          const result = resolveBridgeTheme(setting, obsidian);
          expect(["light", "dark"]).toContain(result.setTheme);
        }
      }
    });
  });
});
