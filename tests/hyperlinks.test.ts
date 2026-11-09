import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { TuiAltScreen, type Terminal } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { extractPullRequests } from "../extensions/pr-watch/links.ts";
import { renderPrs } from "../extensions/pr-watch/widget.ts";

test("a real fullscreen TUI mouse click dispatches the correct PR URL to its browser opener", async () => {
  let input: (data: string) => void = () => assert.fail("terminal not started");
  const terminal: Terminal = {
    columns: 100,
    rows: 10,
    kittyProtocolActive: false,
    start(onInput) {
      input = onInput;
    },
    stop() {},
    async drainInput() {},
    write() {},
    moveBy() {},
    hideCursor() {},
    showCursor() {},
    clearLine() {},
    clearFromCursor() {},
    clearScreen() {},
    setTitle() {},
    setProgress() {},
    setProgramStatus() {},
  };
  const opened: string[] = [];
  const tui = new TuiAltScreen(terminal, false, undefined, {
    mouse: true,
    copyOnSelect: false,
    openUrl: (url) => {
      opened.push(url);
    },
  });
  const theme: Pick<Theme, "fg" | "style" | "appearance"> = {
    fg: (_color, text) => text,
    style: (text) => text,
    appearance: "dark",
  };
  const prs = extractPullRequests(
    "https://github.com/owner/first/pull/1 https://github.com/other/second/pull/2",
  );
  tui.addChild({
    render: (width) =>
      renderPrs(
        prs.map((pr) => ({ pr })),
        width,
        theme,
      ),
    invalidate() {},
  });
  try {
    tui.start();
    for (
      let attempt = 0;
      attempt < 30 &&
      !tui.getScreenLines().some((line) => line.includes("/pull/2"));
      attempt++
    )
      await delay(5);
    assert.equal(
      opened.length,
      0,
      "rendering/hovering must not open a browser",
    );
    for (const pr of prs) {
      const row = tui
        .getScreenLines()
        .findIndex((line) => line.includes(pr.url));
      assert.ok(row >= 0);
      input(`\x1b[<0;3;${row + 1}M`);
      input(`\x1b[<0;3;${row + 1}m`);
    }
    assert.deepEqual(
      opened,
      prs.map((pr) => pr.url),
    );
  } finally {
    tui.stop();
  }
});
