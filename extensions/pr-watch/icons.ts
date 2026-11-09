import { rgbColor, type Color } from "@earendil-works/pi-tui";
import type { PrRow } from "./watcher.ts";

export const ICON_PREFERENCE_ENTRY = "pi-pr-watch/icons";
export type IconMode = "auto" | "nerd" | "unicode";
export type PrVisualState =
  "open" | "merged" | "closed" | "draft" | "loading" | "error";

// Nerd Fonts Octicons: https://github.com/ryanoasis/nerd-fonts/blob/master/glyphnames.json
const NERD_ICONS: Record<PrVisualState, string> = {
  open: "\uf407",
  merged: "\uf419",
  closed: "\uf4dc",
  draft: "\uf4dd",
  loading: "…",
  error: "!",
};
const UNICODE_ICONS: Record<PrVisualState, string> = {
  open: "○",
  merged: "◆",
  closed: "×",
  draft: "◌",
  loading: "…",
  error: "!",
};

// GitHub-style state colors, with separate light/dark variants for legibility.
const STATE_COLORS: Record<"dark" | "light", Record<PrVisualState, Color>> = {
  dark: {
    open: rgbColor(63, 185, 80),
    merged: rgbColor(163, 113, 247),
    closed: rgbColor(248, 81, 73),
    draft: rgbColor(145, 152, 161),
    loading: rgbColor(145, 152, 161),
    error: rgbColor(210, 153, 34),
  },
  light: {
    open: rgbColor(26, 127, 55),
    merged: rgbColor(130, 80, 223),
    closed: rgbColor(209, 36, 47),
    draft: rgbColor(101, 109, 118),
    loading: rgbColor(101, 109, 118),
    error: rgbColor(154, 103, 0),
  },
};

export function parseIconMode(value: unknown): IconMode {
  if (value === "auto" || value === "nerd" || value === "unicode") return value;
  throw new Error("图标模式必须是 auto、nerd 或 unicode。");
}

export function parseIconPreference(value: unknown): IconMode {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("mode" in value)
  ) {
    throw new Error(
      "Invalid pi-pr-watch icon preference (expected version 1).",
    );
  }
  return parseIconMode(value.mode);
}

export function visualState(row: PrRow): PrVisualState {
  if (!row.status) return row.error ? "error" : "loading";
  if (row.status.state === "MERGED") return "merged";
  if (row.status.state === "CLOSED") return "closed";
  return row.status.draft ? "draft" : "open";
}

export function iconGlyph(state: PrVisualState, mode: IconMode): string {
  // Terminal protocols do not reliably report installed font glyphs. Never guess PUA support.
  return (mode === "nerd" ? NERD_ICONS : UNICODE_ICONS)[state];
}

export function stateColor(
  state: PrVisualState,
  appearance: "dark" | "light",
): Color {
  return STATE_COLORS[appearance][state];
}
