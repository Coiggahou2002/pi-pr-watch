import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getOsc8LinkAtColumn,
  stripTerminalSequences,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  iconGlyph,
  stateColor,
  type IconMode,
} from "../extensions/pr-watch/icons.ts";
import { extractPullRequests } from "../extensions/pr-watch/links.ts";
import type { PrRow } from "../extensions/pr-watch/watcher.ts";
import {
  detailsText,
  renderPrs,
  statusText,
} from "../extensions/pr-watch/widget.ts";

const pr = extractPullRequests("https://github.com/owner/repository/pull/1")[0];
assert.ok(pr);
const row: PrRow = {
  pr,
  status: {
    state: "OPEN",
    draft: false,
    checks: "passing",
    review: "required",
  },
};
const theme: Pick<Theme, "fg" | "style" | "appearance"> = {
  fg: (_color, text) => text,
  style: (text) => text,
  appearance: "dark",
};

test("widget fits narrow terminals and bounds displayed rows", () => {
  for (const mode of ["auto", "nerd", "unicode"] satisfies IconMode[]) {
    for (const width of [0, 1, 5, 20, 40, 80, 120]) {
      const lines = renderPrs(
        Array.from({ length: 8 }, () => row),
        width,
        theme,
        mode,
      );
      assert.ok(lines.length <= 4);
      for (const line of lines) assert.ok(visibleWidth(line) <= width);
    }
  }
  assert.deepEqual(renderPrs([], 80, theme), []);
});

test("state icons are always paired with text and use independent state colors", () => {
  const colors: unknown[] = [];
  const recordingTheme: Pick<Theme, "fg" | "style" | "appearance"> = {
    ...theme,
    style(text, options) {
      colors.push(options.fg);
      return text;
    },
  };
  const failing: PrRow = {
    ...row,
    status: {
      state: "OPEN",
      draft: false,
      checks: "failing",
      review: "required",
    },
  };
  const line = renderPrs([failing], 120, recordingTheme, "nerd")[0] ?? "";
  assert.ok(stripTerminalSequences(line).startsWith(iconGlyph("open", "nerd")));
  assert.match(line, /开放.*CI ✗/);
  assert.deepEqual(colors, [stateColor("open", "dark")]);
  const merged: PrRow = {
    ...row,
    status: { state: "MERGED", draft: true, checks: "none", review: "unknown" },
  };
  const mergedLine = renderPrs([merged], 120, recordingTheme, "nerd")[0] ?? "";
  assert.ok(
    stripTerminalSequences(mergedLine).startsWith(iconGlyph("merged", "nerd")),
  );
  assert.match(mergedLine, /已合并/);
  renderPrs([merged], 120, { ...recordingTheme, appearance: "light" }, "nerd");
  assert.deepEqual(colors.slice(1), [
    stateColor("merged", "dark"),
    stateColor("merged", "light"),
  ]);
  assert.doesNotMatch(
    renderPrs([row], 120, theme).join(""),
    /[\uE000-\uF8FF]/u,
  );
});

test("icon and truncated label link to the canonical PR URL, without leaking into status text", () => {
  for (const mode of ["auto", "nerd", "unicode"] satisfies IconMode[]) {
    for (const width of [20, 40, 120]) {
      const line = renderPrs([row], width, theme, mode)[0] ?? "";
      assert.equal(getOsc8LinkAtColumn(line, 0), pr.url);
      assert.equal(getOsc8LinkAtColumn(line, 3), pr.url);
      const plain = stripTerminalSequences(line);
      const separator = plain.indexOf(" · ");
      if (separator !== -1)
        assert.equal(
          getOsc8LinkAtColumn(
            line,
            visibleWidth(plain.slice(0, separator)) + 1,
          ),
          undefined,
        );
      assert.ok(visibleWidth(line) <= width);
    }
  }
});

test("unverified links collapse into a count and never crowd verified PRs out", () => {
  const badPr = extractPullRequests("https://github.com/o/first/pull/1")[0];
  assert.ok(badPr);
  const unverified = Array.from({ length: 6 }, () => ({
    pr: badPr,
    error: "not found or no access",
  }));
  const lines = renderPrs([...unverified, row], 120, theme);
  assert.equal(lines.length, 2);
  assert.match(stripTerminalSequences(lines[0] ?? ""), /owner\/repository#1/);
  assert.match(lines[1] ?? "", /6 个链接未验证/);
  assert.doesNotMatch(lines.join(""), /o\/first|查询失败|不存在/);
  assert.match(detailsText(unverified), /o\/first#1.*查询失败/);
  const onlyFailures = renderPrs(unverified, 120, theme);
  assert.equal(onlyFailures.length, 1);
  assert.match(onlyFailures[0] ?? "", /6 个链接未验证.*\/prs/);
  const stale = renderPrs(
    [{ ...row, error: "network failure" }, ...unverified],
    120,
    theme,
  );
  assert.match(stale[0] ?? "", /旧状态/);
  for (const width of [1, 20, 40]) {
    for (const line of renderPrs([...unverified, row], width, theme))
      assert.ok(visibleWidth(line) <= width);
  }
});

test("failure is not closed; cached green status is clearly stale", () => {
  assert.equal(statusText({ pr, error: "403" }), "查询失败");
  assert.match(statusText({ ...row, error: "403" }), /旧状态/);
  assert.match(statusText({ pr }), /查询中/);
  assert.equal(
    statusText({
      ...row,
      status: {
        ...row.status,
        state: "MERGED",
        draft: false,
        checks: "none",
        review: "unknown",
      },
    }),
    "已合并",
  );
  assert.match(
    detailsText([{ ...row, error: "\x1b[31mfailed\x07" }]),
    /failed/,
  );
  assert.doesNotMatch(
    detailsText([{ ...row, error: "\x1b[31mfailed\x07" }]),
    /\x1b|\x07/,
  );
  assert.match(
    detailsText([row]),
    /https:\/\/github.com\/owner\/repository\/pull\/1/,
  );
});
