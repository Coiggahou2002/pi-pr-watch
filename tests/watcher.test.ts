import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { PrStatus } from "../extensions/pr-watch/github.ts";
import { extractPullRequests } from "../extensions/pr-watch/links.ts";
import { MAX_TRACKED_PRS, PrWatcher } from "../extensions/pr-watch/watcher.ts";

const status: PrStatus = {
  state: "OPEN",
  draft: false,
  checks: "passing",
  review: "approved",
};
const prs = (n: number) =>
  extractPullRequests(`https://github.com/o/r/pull/${n}`);

test("empty sessions make no requests; links deduplicate and tracking is bounded", async () => {
  let calls = 0;
  const watch = new PrWatcher(
    {
      async fetch() {
        calls++;
        return status;
      },
    },
    () => {},
  );
  await watch.refresh();
  assert.equal(calls, 0);
  assert.equal(watch.add(prs(1)), true);
  assert.equal(watch.add(prs(1)), false);
  for (let n = 2; n <= MAX_TRACKED_PRS + 2; n++) watch.add(prs(n));
  assert.equal(watch.snapshot.length, MAX_TRACKED_PRS);
  assert.equal(watch.snapshot[0]?.pr.number, MAX_TRACKED_PRS + 2);
  await watch.refresh();
  assert.equal(calls, MAX_TRACKED_PRS);
  watch.dispose();
});

test("refresh has bounded concurrency and picks up newly discovered PRs during a refresh", async () => {
  let active = 0;
  let peak = 0;
  const queried = new Set<number>();
  const watch = new PrWatcher(
    {
      async fetch(pr) {
        active++;
        peak = Math.max(peak, active);
        queried.add(pr.number);
        await delay(5);
        active--;
        return status;
      },
    },
    () => {},
  );
  for (let n = 1; n <= 6; n++) watch.add(prs(n));
  const running = watch.refresh();
  watch.add(prs(7));
  void watch.refresh();
  await running;
  for (let attempts = 0; attempts < 30 && !queried.has(7); attempts++)
    await delay(5);
  assert.ok(queried.has(7));
  assert.ok(peak <= 3);
  watch.dispose();
});

test("failed refresh retains the previous status and explicitly marks it stale", async () => {
  let fail = false;
  const watch = new PrWatcher(
    {
      async fetch() {
        if (fail) throw new Error("403 no access");
        return status;
      },
    },
    () => {},
  );
  watch.add(prs(1));
  await watch.refresh();
  fail = true;
  await watch.refresh();
  assert.equal(watch.snapshot[0]?.status?.checks, "passing");
  assert.match(watch.snapshot[0]?.error ?? "", /403/);
  fail = false;
  await watch.refresh();
  assert.equal(watch.snapshot[0]?.error, undefined);
  watch.dispose();
});

test("polling refreshes automatically and stops after disposal", async () => {
  let calls = 0;
  const watch = new PrWatcher(
    {
      async fetch() {
        calls++;
        return status;
      },
    },
    () => {},
  );
  watch.add(prs(1));
  watch.startPolling(5);
  for (let attempts = 0; attempts < 30 && calls < 2; attempts++) await delay(5);
  assert.ok(calls >= 2);
  watch.dispose();
  const stoppedAt = calls;
  await delay(20);
  assert.equal(calls, stoppedAt);
});

test("disposed watchers never publish a late response, even if the client ignores cancellation", async () => {
  let finish: (value: PrStatus) => void = () => assert.fail("not initialized");
  const response = new Promise<PrStatus>((resolve) => {
    finish = resolve;
  });
  let updates = 0;
  const watch = new PrWatcher(
    {
      async fetch() {
        return response;
      },
    },
    () => {
      updates++;
    },
  );
  watch.add(prs(1));
  const running = watch.refresh();
  const count = updates;
  watch.dispose();
  finish(status);
  await running;
  assert.equal(updates, count);
  assert.equal(watch.snapshot[0]?.status, undefined);
  assert.equal(watch.add(prs(2)), false);
});
