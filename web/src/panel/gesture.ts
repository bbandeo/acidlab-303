// Gestos del panel: arrastre vertical (perillas, BPM, LEN, pasos) y doble toque.

export const THEMES = [
  { id: "mate", label: "PLÁSTICO MATE", color: "#151515" },
  { id: "grafito", label: "GRAFITO", color: "#26272a" },
  { id: "negro", label: "NEGRO PURO", color: "#000000" },
] as const;
export type ThemeId = (typeof THEMES)[number]["id"];

export function isTheme(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

interface DragHandlers {
  /** dy > 0 cuando el dedo sube. */
  move: (dy: number) => void;
  end: (cancelled: boolean) => void;
}

/**
 * Sigue un puntero desde pointerdown hasta que se suelta. Escucha en window para no perder
 * el gesto cuando el dedo sale del control.
 */
export function trackDrag(e: PointerEvent, { move, end }: DragHandlers): void {
  e.preventDefault();
  const id = e.pointerId;
  const y0 = e.clientY;
  const onMove = (ev: PointerEvent) => { if (ev.pointerId === id) move(y0 - ev.clientY); };
  const finish = (ev: PointerEvent) => {
    if (ev.pointerId !== id) return;
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", finish);
    end(ev.type === "pointercancel");
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", finish);
  window.addEventListener("pointercancel", finish);
}

/** Arrastre de un valor entero: `px` píxeles por unidad, acotado a [min, max]. */
export function dragValue(
  e: PointerEvent,
  opts: { value: number; min: number; max: number; px: number; step?: number },
  preview: (value: number) => void,
  done: (value: number | null) => void,
): void {
  const step = opts.step ?? 1;
  let last = opts.value;
  trackDrag(e, {
    move: (dy) => {
      const next = Math.min(opts.max, Math.max(opts.min, opts.value + Math.round(dy / opts.px) * step));
      if (next === last) return;
      last = next;
      preview(next);
    },
    end: (cancelled) => done(cancelled || last === opts.value ? null : last),
  });
}

/** Teclas de flecha para controles role="slider". Devuelve el nuevo valor o null. */
export function sliderKey(key: string, value: number, min: number, max: number, step = 1): number | null {
  const offsets: Record<string, number> = {
    ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step,
    PageUp: step * 10, PageDown: -step * 10, Home: min - value, End: max - value,
  };
  if (!Object.hasOwn(offsets, key)) return null;
  return Math.min(max, Math.max(min, value + offsets[key]!));
}
