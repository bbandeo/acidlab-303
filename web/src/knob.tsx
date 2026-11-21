import { NumberInput } from "./number-input";
import { useId, useRef } from "preact/hooks";
import { TONE_CONTROLS, type ToneKey } from "./project";

interface Props {
  control: ToneKey;
  value: number;
  preview: (value: number) => void;
  commit: (value: number) => void;
  cancel: () => void;
}

export function Knob({ control, value, preview, commit, cancel }: Props) {
  const { label, min, max, step, unit } = TONE_CONTROLS[control];
  const id = useId();
  const drag = useRef<{ id: number; y: number; initial: number; value: number } | null>(null);
  const bound = (v: number) => Math.min(max, Math.max(min, v));
  const angle = -135 + (value - min) / (max - min) * 270;

  return (
    <div class="knob">
      <div
        class="knob-face"
        style={{ "--angle": `${angle}deg` }}
        role="slider"
        tabIndex={0}
        aria-labelledby={id}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${value} ${unit}`}
        onPointerDown={(e) => {
          if (drag.current || e.button !== 0) return;
          e.currentTarget.focus({ preventScroll: true });
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { id: e.pointerId, y: e.clientY, initial: value, value };
          preview(value);
        }}
        onPointerMove={(e) => {
          const gesture = drag.current;
          if (gesture?.id !== e.pointerId) return;
          gesture.value = bound(gesture.initial + Math.round((gesture.y - e.clientY) / 150 * (max - min) / step) * step);
          preview(gesture.value);
        }}
        onPointerUp={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          const { initial, value: next } = drag.current;
          drag.current = null;
          if (initial === next) cancel();
          else commit(next);
        }}
        onLostPointerCapture={(e) => {
          if (drag.current?.id !== e.pointerId) return;
          drag.current = null;
          cancel();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape" && drag.current) {
            const pointerId = drag.current.id;
            drag.current = null;
            e.currentTarget.releasePointerCapture(pointerId);
            cancel();
            return;
          }
          if (drag.current) return;
          const offsets: Record<string, number> = {
            ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step,
            PageUp: step * 10, PageDown: -step * 10, Home: min - value, End: max - value,
          };
          if (!Object.hasOwn(offsets, e.key)) return;
          e.preventDefault();
          commit(bound(value + offsets[e.key]!));
        }}
      >
        <span class="dial" aria-hidden="true" />
      </div>
      <span class="knob-label" id={id}>{label}</span>
      <div class="knob-number">
        <NumberInput label={`${label} (${unit})`} min={min} max={max} value={value} commit={commit} />
        <span aria-hidden="true">{unit}</span>
      </div>
    </div>
  );
}
