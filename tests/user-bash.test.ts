import assert from "node:assert/strict";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { ActivityObserver } from "../extensions/pr-watch/activity.ts";
import { extractPullRequests } from "../extensions/pr-watch/links.ts";
import { UserBashScanner } from "../extensions/pr-watch/user-bash.ts";

const pr = extractPullRequests("https://github.com/o/active/pull/42")[0];
assert.ok(pr);
const command = "gh pr ready 42";
function result(session: SessionManager): void {
  session.appendMessage({
    role: "bashExecution",
    command,
    output: "",
    exitCode: 0,
    cancelled: false,
    truncated: false,
    timestamp: Date.now(),
  });
}

test("user commands are discovered from new stable session entry IDs without message_end", async () => {
  const session = SessionManager.inMemory();
  result(session);
  const followed: string[] = [];
  const observer = new ActivityObserver(
    {
      async prepare() {
        return { pr };
      },
      async finish() {
        return [pr];
      },
    },
    (_prs, reason) => followed.push(reason),
    (error) => assert.fail(String(error)),
  );
  const scanner = new UserBashScanner(observer, () => session.getBranch());
  try {
    await scanner.before(command, "/tmp");
    result(session);
    for (let attempt = 0; attempt < 30 && !followed.length; attempt++)
      await delay(20);
    assert.deepEqual(followed, ["gh:ready"]);
    await scanner.scan();
    assert.equal(followed.length, 1);
  } finally {
    scanner.dispose();
    observer.dispose();
  }
});

test("concurrent identical user commands are ambiguous and must not be guessed", async () => {
  const session = SessionManager.inMemory();
  const observer = new ActivityObserver(
    {
      async prepare() {
        return { pr };
      },
      async finish() {
        return [pr];
      },
    },
    () => assert.fail("ambiguous match"),
    (error) => assert.fail(String(error)),
  );
  const scanner = new UserBashScanner(observer, () => session.getBranch());
  try {
    await scanner.before(command, "/tmp");
    await scanner.before(command, "/tmp");
    result(session);
    result(session);
    await scanner.scan();
    scanner.dispose();
    result(session);
    await scanner.scan();
  } finally {
    scanner.dispose();
    observer.dispose();
  }
});
