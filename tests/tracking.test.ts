import assert from "node:assert/strict";
import { test } from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import {
  TRACKING_ENTRY,
  parseTrackingEvent,
  restoreTrackedPrs,
} from "../extensions/pr-watch/tracking.ts";

const url = "https://github.com/o/active/pull/42";

test("mentions and legacy session text are not activity; watch/unwatch follow the active branch", () => {
  const session = SessionManager.inMemory();
  session.appendMessage({ role: "user", content: url, timestamp: Date.now() });
  assert.deepEqual(restoreTrackedPrs(session.getBranch()), []);
  const first = session.appendCustomEntry(TRACKING_ENTRY, {
    version: 1,
    action: "watch",
    urls: [url],
    reason: "gh:edit",
  });
  assert.equal(restoreTrackedPrs(session.getBranch())[0]?.url, url);
  session.appendCustomEntry(TRACKING_ENTRY, {
    version: 1,
    action: "unwatch",
    urls: [url],
    reason: "manual",
  });
  assert.deepEqual(restoreTrackedPrs(session.getBranch()), []);
  session.branch(first);
  assert.equal(restoreTrackedPrs(session.getBranch())[0]?.url, url);
});

test("tracking entries reject malformed state and noncanonical URLs", () => {
  const valid = { version: 1, action: "watch", urls: [url], reason: "manual" };
  assert.deepEqual(parseTrackingEvent(valid), valid);
  for (const value of [
    null,
    {},
    { ...valid, version: 2 },
    { ...valid, action: "guess" },
    { ...valid, urls: [1] },
    { ...valid, urls: [url + "?token=secret"] },
    { ...valid, urls: ["https://evil.com"] },
  ])
    assert.throws(() => parseTrackingEvent(value));
});
