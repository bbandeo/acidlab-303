import { useState } from "preact/hooks";

interface Props {
  label: string;
  min: number;
  max: number;
  value: number;
  commit: (value: number) => void;
}

export function NumberInput({ label, min, max, value, commit }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return <input
    aria-label={label} type="number" inputMode="numeric" min={min} max={max} step="any"
    value={draft ?? value}
    onInput={(e) => setDraft(e.currentTarget.value)}
    onBlur={(e) => {
      const n = e.currentTarget.valueAsNumber;
      setDraft(null);
      if (Number.isFinite(n)) commit(Math.min(max, Math.max(min, Math.round(n))));
    }}
    onKeyDown={(e) => {
      if (e.key !== "Enter" && e.key !== "Escape") return;
      e.preventDefault();
      if (e.key === "Escape") e.currentTarget.value = String(value);
      e.currentTarget.blur();
    }}
  />;
}
