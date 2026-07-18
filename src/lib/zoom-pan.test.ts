import { describe, it, expect } from "vitest";
import {
  MIN_SCALE,
  MAX_SCALE,
  clampScale,
  fitToContainer,
  zoomAt,
  panBy,
  type ZoomPanState,
} from "./zoom-pan";

describe("clampScale", () => {
  it("範囲内はそのまま", () => {
    expect(clampScale(1)).toBe(1);
    expect(clampScale(2.5)).toBe(2.5);
  });

  it("下限でクランプ", () => {
    expect(clampScale(0.01)).toBe(MIN_SCALE);
  });

  it("上限でクランプ", () => {
    expect(clampScale(1000)).toBe(MAX_SCALE);
  });

  it("非有限値は下限を返す", () => {
    expect(clampScale(Number.NaN)).toBe(MIN_SCALE);
    expect(clampScale(Number.POSITIVE_INFINITY)).toBe(MAX_SCALE);
  });
});

describe("fitToContainer", () => {
  it("横長 content は幅基準でフィットし中央寄せされる", () => {
    const state = fitToContainer({ width: 200, height: 100 }, { width: 100, height: 100 });
    expect(state.scale).toBeCloseTo(0.5);
    // scaledWidth = 100 → 水平は余白 0、垂直は (100-50)/2 = 25
    expect(state.translateX).toBeCloseTo(0);
    expect(state.translateY).toBeCloseTo(25);
  });

  it("content が container より小さいときも収まる倍率 (拡大) を返す", () => {
    const state = fitToContainer({ width: 50, height: 50 }, { width: 100, height: 100 });
    expect(state.scale).toBeCloseTo(2);
  });

  it("サイズ 0 は等倍・原点を返す", () => {
    expect(fitToContainer({ width: 0, height: 100 }, { width: 100, height: 100 })).toEqual({
      scale: 1,
      translateX: 0,
      translateY: 0,
    });
    expect(fitToContainer({ width: 100, height: 100 }, { width: 0, height: 0 })).toEqual({
      scale: 1,
      translateX: 0,
      translateY: 0,
    });
  });
});

describe("zoomAt", () => {
  const base: ZoomPanState = { scale: 1, translateX: 0, translateY: 0 };

  it("原点はズーム後も同じ画面座標に写像される (不変性)", () => {
    const originX = 40;
    const originY = 60;
    // 原点直下の content 座標: (screen - translate) / scale
    const contentX = (originX - base.translateX) / base.scale;
    const contentY = (originY - base.translateY) / base.scale;
    const next = zoomAt(base, 2, originX, originY);
    // ズーム後に同じ content 座標が写る画面位置
    const screenX = next.translateX + contentX * next.scale;
    const screenY = next.translateY + contentY * next.scale;
    expect(screenX).toBeCloseTo(originX);
    expect(screenY).toBeCloseTo(originY);
  });

  it("clamp 上限に達しても原点不変 (適用倍率で translate 補正)", () => {
    const start: ZoomPanState = { scale: 8, translateX: 10, translateY: 20 };
    const originX = 100;
    const next = zoomAt(start, 4, originX, 0);
    expect(next.scale).toBe(MAX_SCALE);
    const contentX = (originX - start.translateX) / start.scale;
    const screenX = next.translateX + contentX * next.scale;
    expect(screenX).toBeCloseTo(originX);
  });

  it("factor でスケールが増減する", () => {
    expect(zoomAt(base, 1.5, 0, 0).scale).toBeCloseTo(1.5);
    expect(zoomAt(base, 0.5, 0, 0).scale).toBeCloseTo(0.5);
  });
});

describe("panBy", () => {
  it("translate に加算しスケールは不変", () => {
    const state: ZoomPanState = { scale: 2, translateX: 10, translateY: 20 };
    const next = panBy(state, 5, -8);
    expect(next).toEqual({ scale: 2, translateX: 15, translateY: 12 });
  });
});
