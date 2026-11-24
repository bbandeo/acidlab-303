import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

interface ShellProps {
  title: string;
  footer: string;
  onBack: () => void;
  onClose: () => void;
  children: ComponentChildren;
}

/** Pantalla aparte del aparato: cubre el panel, con ← / ✕ arriba y el nombre del banco abajo. */
export function MenuShell({ title, footer, onBack, onClose, children }: ShellProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, [title]);
  return (
    <div class="menu" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={root}
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } }}>
      <div class="m-head">
        <button class="m-icon" aria-label="Volver" onClick={onBack}>←</button>
        <span class="m-title">{title}</span>
        <button class="m-icon" aria-label="Cerrar menú" onClick={onClose}>✕</button>
      </div>
      <div class="m-body">{children}</div>
      <div class="m-foot"><span>ACIDLAB 303</span><span class="m-foot-name">{footer}</span></div>
    </div>
  );
}

/** Entrada del menú raíz: título, subtítulo y ›, o un valor a la derecha. */
export function MenuItem({ label, sub, value, onClick }: { label: string; sub: string; value?: string; onClick: () => void }) {
  return (
    <button class="m-item" onClick={onClick}>
      <span class="m-item-text"><span class="m-item-label">{label}</span><span class="m-sub">{sub}</span></span>
      {value ? <span class="m-value">{value}</span> : <span class="m-chev" aria-hidden="true">›</span>}
    </button>
  );
}

/** Fila parámetro → valor; tocarla avanza al siguiente valor. */
export function ValueRow({ label, value, onClick, onPrev, plain }: {
  label: string; value: string; onClick: () => void; onPrev?: () => void; plain?: boolean;
}) {
  return (
    <button class="m-row" aria-label={`${label}: ${value}`} onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") { e.preventDefault(); onClick(); }
        if (e.key === "ArrowLeft" && onPrev) { e.preventDefault(); onPrev(); }
      }}>
      <span class="m-row-label">{label}</span>
      <span class={plain ? "m-row-value plain" : "m-row-value"}>{value}</span>
    </button>
  );
}

/** Acción de archivo: título y detalle en dos líneas. */
export function ActionRow({ label, sub, onClick, disabled }: { label: string; sub?: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button class="m-action" disabled={disabled} onClick={onClick}>
      <span class="m-item-text">
        <span class="m-action-label">{label}</span>
        {sub && <span class="m-sub">{sub}</span>}
      </span>
      <span class="m-chev" aria-hidden="true">›</span>
    </button>
  );
}

export function MenuNote({ children, warn }: { children: ComponentChildren; warn?: boolean }) {
  return <p class={warn ? "m-note warn" : "m-note"}>{children}</p>;
}

export function PrimaryButton({ children, onClick, disabled, type = "button" }: {
  children: ComponentChildren; onClick?: () => void; disabled?: boolean; type?: "button" | "submit";
}) {
  return <button class="m-primary" type={type} disabled={disabled} onClick={onClick}>{children}</button>;
}
