import assert from "node:assert/strict";
import { test } from "node:test";
import { colorToHex } from "@earendil-works/pi-tui";
import {
  iconGlyph,
  parseIconMode,
  parseIconPreference,
  stateColor,
  visualState,
  type PrVisualState,
} from "../extensions/pr-watch/icons.ts";
import { extractPullRequests } from "../extensions/pr-watch/links.ts";

const pr = extractPullRequests("https://github.com/o/r/pull/1")[0];
assert.ok(pr);

test("auto is font-safe; nerd uses the authoritative Octicons codepoints", () => {
  for (const state of [
    "open",
    "merged",
    "closed",
    "draft",
    "loading",
    "error",
  ] satisfies PrVisualState[]) {
    assert.equal(iconGlyph(state, "auto"), iconGlyph(state, "unicode"));
    assert.doesNotMatch(iconGlyph(state, "auto"), /[\uE000-\uF8FF]/u);
  }
  assert.equal(iconGlyph("open", "nerd").codePointAt(0), 0xf407);
  assert.equal(iconGlyph("merged", "nerd").codePointAt(0), 0xf419);
  assert.equal(iconGlyph("closed", "nerd").codePointAt(0), 0xf4dc);
  assert.equal(iconGlyph("draft", "nerd").codePointAt(0), 0xf4dd);
  assert.equal(
    new Set(
      ["open", "merged", "closed", "draft"].map((state) =>
        iconGlyph(parseVisualState(state), "unicode"),
      ),
    ).size,
    4,
  );
});

function parseVisualState(value: string): PrVisualState {
  if (
    value === "open" ||
    value === "merged" ||
    value === "closed" ||
    value === "draft"
  )
    return value;
  throw new Error("unexpected test state");
}

test("terminal states outrank draft; an error with no cached result isn't a closed PR", () => {
  assert.equal(visualState({ pr }), "loading");
  assert.equal(visualState({ pr, error: "403" }), "error");
  for (const state of ["OPEN", "MERGED", "CLOSED"] satisfies (
    "OPEN" | "MERGED" | "CLOSED"
  )[]) {
    const status = {
      state,
      draft: true,
      checks: "none",
      review: "unknown",
    } satisfies NonNullable<Parameters<typeof visualState>[0]["status"]>;
    assert.equal(
      visualState({ pr, status }),
      state === "OPEN" ? "draft" : state.toLowerCase(),
    );
    assert.equal(
      visualState({ pr, status, error: "stale" }),
      state === "OPEN" ? "draft" : state.toLowerCase(),
    );
  }
});

test("merged is purple, open green, closed red, and draft gray in both themes", () => {
  assert.equal(colorToHex(stateColor("merged", "dark")), "#a371f7");
  assert.equal(colorToHex(stateColor("merged", "light")), "#8250df");
  assert.equal(colorToHex(stateColor("open", "light")), "#1a7f37");
  assert.equal(colorToHex(stateColor("closed", "light")), "#d1242f");
  assert.equal(colorToHex(stateColor("draft", "light")), "#656d76");
});

test("mode and versioned session preferences reject malformed settings", () => {
  for (const mode of ["auto", "nerd", "unicode"]) {
    assert.equal(parseIconMode(mode), mode);
    assert.equal(parseIconPreference({ version: 1, mode }), mode);
  }
  for (const value of ["", "emoji", "nerd extra", null, 1])
    assert.throws(() => parseIconMode(value));
  for (const value of [
    null,
    {},
    { version: 2, mode: "nerd" },
    { version: 1, mode: "bad" },
  ])
    assert.throws(() => parseIconPreference(value));
});
