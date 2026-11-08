import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GhPullRequestClient,
  parsePrStatus,
} from "../extensions/pr-watch/github.ts";
import { extractPullRequests } from "../extensions/pr-watch/links.ts";

const base = {
  state: "OPEN",
  isDraft: false,
  reviewDecision: "REVIEW_REQUIRED",
  statusCheckRollup: [],
};

test("parses PR states, draft and review decisions conservatively", () => {
  assert.deepEqual(parsePrStatus(base), {
    state: "OPEN",
    draft: false,
    checks: "none",
    review: "required",
  });
  for (const state of ["MERGED", "CLOSED"])
    assert.equal(parsePrStatus({ ...base, state }).state, state);
  assert.equal(
    parsePrStatus({ ...base, isDraft: true, reviewDecision: "APPROVED" })
      .review,
    "approved",
  );
  assert.equal(
    parsePrStatus({ ...base, reviewDecision: "CHANGES_REQUESTED" }).review,
    "changes",
  );
  assert.equal(
    parsePrStatus({ ...base, reviewDecision: "", statusCheckRollup: null })
      .review,
    "unknown",
  );
});

test("aggregates both CheckRun and StatusContext results, never treating absent checks as green", () => {
  const result = (statusCheckRollup: unknown[]) =>
    parsePrStatus({ ...base, statusCheckRollup }).checks;
  assert.equal(
    result([
      { state: "SUCCESS" },
      { status: "COMPLETED", conclusion: "SUCCESS" },
    ]),
    "passing",
  );
  assert.equal(
    result([{ state: "SUCCESS" }, { status: "IN_PROGRESS" }]),
    "pending",
  );
  assert.equal(
    result([{ state: "FAILURE" }, { status: "IN_PROGRESS" }]),
    "failing",
  );
  assert.equal(
    result([{ status: "COMPLETED", conclusion: "TIMED_OUT" }]),
    "failing",
  );
  assert.equal(
    result([{ status: "COMPLETED", conclusion: "NEUTRAL" }]),
    "none",
  );
  assert.equal(result([{ status: "COMPLETED", conclusion: null }]), "unknown");
});

test("invalid JSON shapes fail loudly", () => {
  for (const value of [
    null,
    {},
    [],
    { ...base, isDraft: "false" },
    { ...base, state: "UNKNOWN" },
    { ...base, reviewDecision: 10 },
    { ...base, statusCheckRollup: [{}] },
    { ...base, statusCheckRollup: "green" },
  ]) {
    assert.throws(() => parsePrStatus(value));
  }
});

test("gh adapter uses only read-only argv, bounded output and cancellation", async () => {
  const pr = extractPullRequests("https://github.com/o/r/pull/1")[0];
  assert.ok(pr);
  const signal = new AbortController().signal;
  const client = new GhPullRequestClient(async (command, args, options) => {
    assert.equal(command, "gh");
    assert.deepEqual(args, [
      "pr",
      "view",
      pr.url,
      "--json",
      "state,isDraft,reviewDecision,statusCheckRollup",
    ]);
    assert.equal(options?.signal, signal);
    assert.equal(options?.cwd, "/tmp");
    assert.ok(options?.maxBuffer);
    assert.ok(options?.timeout);
    return {
      stdout: JSON.stringify(base),
      stderr: "",
      code: 0,
      killed: false,
      truncated: false,
    };
  }, "/tmp");
  assert.equal((await client.fetch(pr, signal)).state, "OPEN");
  for (const override of [
    { code: 1, stderr: "not found or no access" },
    { killed: true },
    { truncated: true },
    { stdout: "invalid json" },
  ]) {
    const broken = new GhPullRequestClient(
      async () => ({
        stdout: JSON.stringify(base),
        stderr: "",
        code: 0,
        killed: false,
        truncated: false,
        ...override,
      }),
      "/tmp",
    );
    await assert.rejects(broken.fetch(pr, signal));
  }
});
