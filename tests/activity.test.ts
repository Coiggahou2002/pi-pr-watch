import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ActivityObserver,
  GhActivityResolver,
  type ActivityResolver,
  type PreparedActivity,
} from "../extensions/pr-watch/activity.ts";
import { extractPullRequests } from "../extensions/pr-watch/links.ts";

const pr = extractPullRequests("https://github.com/o/active/pull/42")[0];
assert.ok(pr);
const resolver: ActivityResolver = {
  async prepare() {
    return { pr };
  },
  async finish(_intent, prepared) {
    return prepared.pr ? [prepared.pr] : [];
  },
};

test("only successful actions or explicitly watched failing checks enroll a PR", async () => {
  const followed: string[] = [];
  const errors: unknown[] = [];
  const observer = new ActivityObserver(
    resolver,
    (_prs, reason) => followed.push(reason),
    (error) => errors.push(error),
  );
  assert.equal(await observer.before("view", "gh pr view 42", "/tmp"), false);
  await observer.before("fail", "gh pr edit 42 --title new", "/tmp");
  await observer.after("fail", 1, "", false);
  assert.equal(followed.length, 0);
  await observer.before("ok", "gh pr edit 42 --title new", "/tmp");
  await observer.after("ok", 0, "", false);
  await observer.before("checks", "gh pr checks 42 --watch", "/tmp");
  await observer.after("checks", 1, "checks failed", false);
  assert.deepEqual(followed, ["gh:edit", "gh:checks"]);
  assert.deepEqual(errors, []);
  observer.dispose();
});

test("blocked/aborted calls and session replacement cannot enroll from stale lookups", async () => {
  let finish: (value: PreparedActivity) => void = () =>
    assert.fail("not started");
  const pending = new Promise<PreparedActivity>((resolve) => {
    finish = resolve;
  });
  const observer = new ActivityObserver(
    {
      ...resolver,
      async prepare() {
        return pending;
      },
    },
    () => assert.fail("stale enrollment"),
    () => assert.fail("cancelled work must not notify"),
  );
  const before = observer.before("old", "gh pr merge 42", "/tmp");
  observer.dispose();
  finish({ pr });
  assert.equal(await before, false);
  await observer.after("old", 0, "", false);
  const blocked = new ActivityObserver(
    resolver,
    () => assert.fail("blocked enrollment"),
    (error) => assert.fail(String(error)),
  );
  await blocked.before("blocked", "gh pr ready 42", "/tmp");
  blocked.cancel("blocked");
  await blocked.after("blocked", 0, "", false);
  blocked.dispose();
});

test("manual unwatch fences an older in-flight completion, but permits new operations", async () => {
  let finish: () => void = () => assert.fail("not started");
  const response = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const followed: string[] = [];
  const observer = new ActivityObserver(
    {
      ...resolver,
      async finish() {
        await response;
        return [pr];
      },
    },
    (_prs, reason) => followed.push(reason),
    (error) => assert.fail(String(error)),
  );
  await observer.before("old", "gh pr ready 42", "/tmp");
  const after = observer.after("old", 0, "", false);
  observer.unwatch(pr.key);
  finish();
  await after;
  assert.equal(followed.length, 0);
  await observer.before("new", "gh pr ready 42", "/tmp");
  await observer.after("new", 0, "", false);
  assert.deepEqual(followed, ["gh:ready"]);
  observer.dispose();
});

test("lookup errors don't throw from the pre-execution hook or block the original action", async () => {
  const errors: unknown[] = [];
  const observer = new ActivityObserver(
    {
      ...resolver,
      async prepare() {
        throw new Error("offline");
      },
    },
    () => assert.fail("unresolved enrollment"),
    (error) => errors.push(error),
  );
  assert.equal(
    await observer.before("x", "gh pr edit 42 --title new", "/tmp"),
    true,
  );
  await observer.after("x", 0, "", false);
  assert.match(String(errors[0]), /offline/);
  observer.dispose();
});

test("overlapping bash commands invalidate context-dependent identity instead of guessing", async () => {
  const followed: string[] = [];
  const errors: unknown[] = [];
  const observer = new ActivityObserver(
    resolver,
    (_prs, reason) => followed.push(reason),
    (error) => errors.push(error),
  );
  await observer.before(
    "edit",
    "gh pr edit --title new",
    "/tmp",
    undefined,
    true,
  );
  await observer.before(
    "switch",
    "git checkout other",
    "/tmp",
    undefined,
    true,
  );
  await observer.after("edit", 0, "", false);
  await observer.after("switch", 0, "", false);
  assert.deepEqual(followed, []);
  assert.match(String(errors[0]), /并行/);
  await observer.before("after", "gh pr ready 42", "/tmp", undefined, true);
  await observer.after("after", 0, "", false);
  assert.deepEqual(followed, ["gh:ready"]);
  observer.dispose();
});

test("implicit PR identity is resolved before a merge/checkout can change the branch", async () => {
  const calls: string[][] = [];
  const backend = new GhActivityResolver(async (_command, args) => {
    calls.push(args);
    return {
      stdout: JSON.stringify({ url: pr.url }),
      stderr: "",
      code: 0,
      killed: false,
      truncated: false,
    };
  });
  const intent = {
    kind: "gh",
    action: "merge",
    cwd: "/tmp",
  } satisfies Parameters<typeof backend.prepare>[0];
  const prepared = await backend.prepare(intent, new AbortController().signal);
  const result = await backend.finish(
    intent,
    prepared,
    "https://github.com/wrong/branch/pull/99",
    false,
    new AbortController().signal,
  );
  assert.equal(result[0]?.url, pr.url);
  assert.deepEqual(calls, [["pr", "view", "--json", "url"]]);
});

test("create uses only the successful command's unique untruncated PR URL", async () => {
  const backend = new GhActivityResolver(async () =>
    assert.fail("create needs no identity lookup"),
  );
  const intent = {
    kind: "gh",
    action: "create",
    cwd: "/tmp",
  } satisfies Parameters<typeof backend.prepare>[0];
  const signal = new AbortController().signal;
  assert.deepEqual(await backend.finish(intent, {}, pr.url, true, signal), []);
  assert.deepEqual(
    await backend.finish(
      intent,
      {},
      `${pr.url}\nhttps://github.com/o/other/pull/2`,
      false,
      signal,
    ),
    [],
  );
  assert.equal(
    (await backend.finish(intent, {}, pr.url, false, signal))[0]?.url,
    pr.url,
  );
});
