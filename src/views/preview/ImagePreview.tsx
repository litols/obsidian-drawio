import * as React from "react";
import { t } from "../../lib/i18n";
import { fitToContainer, zoomAt, panBy, type ZoomPanState, type Size } from "../../lib/zoom-pan";

export interface ImagePreviewProps {
  /** vault リソース URL (app.vault.getResourcePath)。バージョンクエリ付きなので src 差し替えで再描画 */
  src: string;
  /** ダブルクリックでの編集モード遷移 (要件 3.1) */
  onRequestEdit: () => void;
  /** 画像 decode 失敗時のフォールバック通知 (要件 1.5) */
  onError?: () => void;
  /** プレビュー背景色 (設定 previewBackground、要件 6.6) */
  background?: string;
}

const IDENTITY: ZoomPanState = { scale: 1, translateX: 0, translateY: 0 };
// ホイールズームの 1 ノッチあたりの倍率、ボタンズームの 1 クリックあたりの倍率
const WHEEL_ZOOM_FACTOR = 1.1;
const BUTTON_ZOOM_FACTOR = 1.2;

/**
 * svg / png の内包画像を vault リソース URL 直接指定で表示し、
 * ホイール / ピンチ / ドラッグ / ズームボタンで拡大縮小・パンできる読み取り専用ビュー。
 * 座標変換は zoom-pan 純関数に委譲し CSS transform で適用する (要件 1.2, 2.1-2.3, 2.5)。
 */
export const ImagePreview: React.FC<ImagePreviewProps> = ({
  src,
  onRequestEdit,
  onError,
  background,
}) => {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const [state, setState] = React.useState<ZoomPanState>(IDENTITY);
  // native wheel リスナ / ポインタハンドラから最新 state を参照するための ref
  const stateRef = React.useRef(state);
  stateRef.current = state;
  const dragRef = React.useRef<{ x: number; y: number } | null>(null);

  const contentSize = React.useCallback((): Size => {
    const img = imgRef.current;
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      return { width: img.naturalWidth, height: img.naturalHeight };
    }
    const rect = img?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }, []);

  const containerSize = React.useCallback((): Size => {
    const rect = containerRef.current?.getBoundingClientRect();
    return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
  }, []);

  const fit = React.useCallback((): void => {
    setState(fitToContainer(contentSize(), containerSize()));
  }, [contentSize, containerSize]);

  const reset = React.useCallback((): void => {
    const c = containerSize();
    const s = contentSize();
    // 100%: 等倍で中央寄せ
    setState({
      scale: 1,
      translateX: (c.width - s.width) / 2,
      translateY: (c.height - s.height) / 2,
    });
  }, [contentSize, containerSize]);

  const zoomFromCenter = React.useCallback(
    (factor: number): void => {
      const c = containerSize();
      setState(zoomAt(stateRef.current, factor, c.width / 2, c.height / 2));
    },
    [containerSize],
  );

  // 初期表示は図全体がビューに収まるフィット表示 (要件 2.3)。画像 decode 完了時に実行。
  const handleImgLoad = React.useCallback((): void => fit(), [fit]);

  // wheel は React の passive リスナだと preventDefault できないため native 非 passive で登録。
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const originX = e.clientX - rect.left;
      const originY = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        // 修飾キー + ホイール / ピンチ (ctrlKey 付き wheel) → 原点ズーム (要件 2.1)
        const factor = e.deltaY < 0 ? WHEEL_ZOOM_FACTOR : 1 / WHEEL_ZOOM_FACTOR;
        setState(zoomAt(stateRef.current, factor, originX, originY));
      } else {
        // 通常ホイール → スクロールでパン (要件 2.2)
        setState(panBy(stateRef.current, -e.deltaX, -e.deltaY));
      }
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => container.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setState(panBy(stateRef.current, dx, dy));
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  return (
    <div className="drawio-image-preview">
      <div
        ref={containerRef}
        className="drawio-image-preview-viewport"
        style={background ? { background } : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
        onDoubleClick={onRequestEdit}
      >
        <img
          ref={imgRef}
          className="drawio-image-preview-img"
          src={src}
          onLoad={handleImgLoad}
          onError={onError}
          draggable={false}
          alt=""
          style={{
            transform: `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`,
            transformOrigin: "0 0",
          }}
        />
      </div>
      <div className="drawio-image-preview-toolbar">
        <button
          type="button"
          aria-label={t("preview.zoom.in")}
          onClick={() => zoomFromCenter(BUTTON_ZOOM_FACTOR)}
        >
          +
        </button>
        <button
          type="button"
          aria-label={t("preview.zoom.out")}
          onClick={() => zoomFromCenter(1 / BUTTON_ZOOM_FACTOR)}
        >
          −
        </button>
        <button type="button" aria-label={t("preview.zoom.fit")} onClick={fit}>
          ⤢
        </button>
        <button type="button" aria-label={t("preview.zoom.reset")} onClick={reset}>
          100%
        </button>
      </div>
    </div>
  );
};
