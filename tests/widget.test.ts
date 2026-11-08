import assert from "node:assert/strict";
import { test } from "node:test";
import { visibleWidth } from "@earendil-works/pi-tui";
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
const theme = { fg: (_color: string, text: string) => text };

test("widget fits narrow terminals and bounds displayed rows", () => {
  for (const width of [0, 1, 5, 20, 40, 80, 120]) {
    const lines = renderPrs(
      Array.from({ length: 8 }, () => row),
      width,
      theme,
    );
    assert.ok(lines.length <= 4);
    for (const line of lines) assert.ok(visibleWidth(line) <= width);
  }
  assert.deepEqual(renderPrs([], 80, theme), []);
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
