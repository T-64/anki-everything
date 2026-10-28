import { useRef, useState, type PointerEvent } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { copy } from "../i18n";
import { useBack } from "../back";
import { rectFrom, type CropRect } from "../crop";

/** 全屏裁剪：在照片上拖出要放到卡片上的区域。返回键 = 取消 */
export function Crop({ image, initial, onDone, onCancel }: { image: string; initial: CropRect | null; onDone: (rect: CropRect | null) => void; onCancel: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [rect, setRect] = useState<CropRect | null>(initial);
  const [draft, setDraft] = useState<CropRect | null>(null);
  useBack(() => {
    onCancel();
    return true;
  });
  const point = (event: PointerEvent) => {
    const bounds = box.current!.getBoundingClientRect();
    return { x: (event.clientX - bounds.left) / bounds.width, y: (event.clientY - bounds.top) / bounds.height };
  };
  const shown = draft ?? rect;
  return (
    <motion.div className="crop" role="dialog" aria-modal="true" aria-label={copy.crop.title} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="crop-bar">
        <button className="float-button" aria-label={copy.common.cancel} onClick={onCancel}>
          <X />
        </button>
        <p className="crop-hint">{copy.crop.hint}</p>
      </div>
      <div className="crop-stage">
        <div
          ref={box}
          className="crop-frame"
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            start.current = point(event);
          }}
          onPointerMove={(event) => start.current && setDraft(rectFrom(start.current, point(event)))}
          onPointerUp={(event) => {
            if (start.current) {
              const next = rectFrom(start.current, point(event));
              if (next) setRect(next);
            }
            start.current = null;
            setDraft(null);
          }}
        >
          <img src={image} alt="" draggable={false} />
          {shown && <div className="crop-rect" style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, width: `${shown.width * 100}%`, height: `${shown.height * 100}%` }} />}
        </div>
      </div>
      <div className="crop-actions">
        <button className="ghost" onClick={() => setRect(null)} disabled={!rect}>
          {copy.crop.reset}
        </button>
        <button className="primary" onClick={() => onDone(rect)}>
          {copy.crop.done}
        </button>
      </div>
    </motion.div>
  );
}
