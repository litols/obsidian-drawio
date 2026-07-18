/**
 * 画像プレビューの座標変換純関数群。
 * ImagePreview はホイール / ピンチ / ドラッグ / ズームボタンをこれらの関数にマップし、
 * 結果の ZoomPanState を CSS transform (translate + scale) として適用する。
 */

export interface Size {
  width: number;
  height: number;
}

export interface ZoomPanState {
  /** clamp 範囲 [MIN_SCALE, MAX_SCALE] */
  scale: number;
  translateX: number;
  translateY: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 10;

export function clampScale(scale: number): number {
  if (Number.isNaN(scale)) return MIN_SCALE;
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/**
 * content 全体が container に収まる倍率を求め、中央寄せした状態を返す。
 * content または container のサイズが 0 以下のときは等倍・原点の state を返す。
 */
export function fitToContainer(content: Size, container: Size): ZoomPanState {
  if (content.width <= 0 || content.height <= 0 || container.width <= 0 || container.height <= 0) {
    return { scale: 1, translateX: 0, translateY: 0 };
  }
  const scale = clampScale(
    Math.min(container.width / content.width, container.height / content.height),
  );
  const scaledWidth = content.width * scale;
  const scaledHeight = content.height * scale;
  return {
    scale,
    translateX: (container.width - scaledWidth) / 2,
    translateY: (container.height - scaledHeight) / 2,
  };
}

/**
 * 指定した原点 (origin) を不変点として factor 倍ズームする。
 * origin はコンテナ座標系。clamp により有効倍率が変わった場合は
 * 実際に適用された倍率比で translate を補正するため、原点は常に不変。
 */
export function zoomAt(
  state: ZoomPanState,
  factor: number,
  originX: number,
  originY: number,
): ZoomPanState {
  const nextScale = clampScale(state.scale * factor);
  const appliedFactor = nextScale / state.scale;
  return {
    scale: nextScale,
    translateX: originX - (originX - state.translateX) * appliedFactor,
    translateY: originY - (originY - state.translateY) * appliedFactor,
  };
}

export function panBy(state: ZoomPanState, dx: number, dy: number): ZoomPanState {
  return {
    scale: state.scale,
    translateX: state.translateX + dx,
    translateY: state.translateY + dy,
  };
}
