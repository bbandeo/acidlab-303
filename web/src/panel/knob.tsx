import { useId, useRef } from "preact/hooks";
import { dragValue, sliderKey } from "./gesture";

interface Props {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  /** Valor al que vuelve con doble toque. */
  initial: number;
  preview: (value: number) => void;
  commit: (value: number) => void;
  cancel: () => void;
}

const DOUBLE_TAP_MS = 320;

export function format(value: number, min: number): string {
  return min < 0 && value > 0 ? `+${value}` : String(value);
}

export function Knob({ label, value, min, max, step, unit, initial, preview, commit, cancel }: Props) {
  const id = useId();
  const lastTap = useRef(0);
  const ratio = (value - min) / (max - min);
  const text = format(value, min);

  return (
    <div class="knob">
      <span class="k-label" id={id}>{label}</span>
      <div
        class="k-dial"
        style={{ "--angle": `${-135 + ratio * 270}deg`, "--arc": `${ratio * 270}deg` }}
        role="slider"
        tabIndex={0}
        aria-labelledby={id}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={`${text} ${unit}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.focus({ preventScroll: true });
          let moved = false;
          dragValue(e, { value, min, max, step, px: 160 / ((max - min) / step) }, (next) => {
            moved = true;
            preview(next);
          }, (next) => {
            if (next !== null) {
              lastTap.current = 0;
              return commit(next);
            }
            cancel();
            if (moved) return;
            const now = Date.now();
            if (now - lastTap.current < DOUBLE_TAP_MS) {
              lastTap.current = 0;
              if (value !== initial) commit(initial);
            } else lastTap.current = now;
          });
        }}
        onKeyDown={(e) => {
          const next = sliderKey(e.key, value, min, max, step);
          if (next === null) return;
          e.preventDefault();
          if (next !== value) commit(next);
        }}
      >
        <span class="k-ticks" aria-hidden="true" />
        <span class="k-ring" aria-hidden="true" />
        <span class="k-skirt" aria-hidden="true" />
        <span class="k-cap" aria-hidden="true"><span class="k-cap-inner" /><span class="k-pointer" /></span>
        <span class="k-val" aria-hidden="true">{text}</span>
      </div>
      <span class="k-text" aria-hidden="true">{text} {unit}</span>
    </div>
  );
}
