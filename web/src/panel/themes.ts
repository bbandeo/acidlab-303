import { isTheme, type ThemeId } from "./gesture";

export const PANEL_THEMES = [
  { id: "1a", label: "Plástico mate", finish: "mate", unified: false, opensFile: false },
  { id: "1b", label: "Grafito anodizado", finish: "grafito", unified: false, opensFile: false },
  { id: "1c", label: "Negro puro", finish: "negro", unified: false, opensFile: false },
  { id: "2a", label: "Mate unificado", finish: "mate", unified: true, opensFile: false },
  { id: "2b", label: "Mate · Archivo", finish: "mate", unified: true, opensFile: true },
  { id: "2c", label: "Grafito compacto", finish: "grafito", unified: true, opensFile: false },
] as const satisfies readonly {
  id: string; label: string; finish: ThemeId; unified: boolean; opensFile: boolean;
}[];

export type PanelTheme = (typeof PANEL_THEMES)[number]["id"];

export function getPanelTheme(id: PanelTheme) {
  return PANEL_THEMES.find((theme) => theme.id === id)!;
}

export function resolvePanelTheme(query: string | null, saved: string | null): PanelTheme {
  const direct = PANEL_THEMES.find((theme) => theme.id === query)?.id;
  const preference = PANEL_THEMES.find((theme) => theme.id === saved)?.id;
  const legacy = isTheme(saved) ? PANEL_THEMES.find((theme) => !theme.unified && theme.finish === saved)?.id : undefined;
  return direct ?? preference ?? legacy ?? "2a";
}
