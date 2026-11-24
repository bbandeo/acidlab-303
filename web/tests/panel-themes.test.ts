import { expect, it } from "vitest";
import { getPanelTheme, PANEL_THEMES, resolvePanelTheme } from "../src/panel/themes";

it("maps each of the six handoff models to its exact finish and opening view", () => {
  expect(PANEL_THEMES.map(({ id, finish, unified, opensFile }) => [id, finish, unified, opensFile])).toEqual([
    ["1a", "mate", false, false], ["1b", "grafito", false, false], ["1c", "negro", false, false],
    ["2a", "mate", true, false], ["2b", "mate", true, true], ["2c", "grafito", true, false],
  ]);
});

it("honors direct preview links and remembers an existing material preference", () => {
  expect(resolvePanelTheme("2c", "1a")).toBe("2c");
  expect(resolvePanelTheme("2f", "negro")).toBe("1c");
  expect(resolvePanelTheme(null, "2b")).toBe("2b");
  expect(resolvePanelTheme(null, null)).toBe("2a");
  expect(getPanelTheme("2b").opensFile).toBe(true);
});
