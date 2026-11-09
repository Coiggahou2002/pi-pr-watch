import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { test } from "node:test";
import { GhActivityResolver } from "../extensions/pr-watch/activity.ts";

const run = promisify(execFile);

test("real git metadata resolves explicit and default pushes; rejects multi-target and fork collisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-pr-push-"));
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const git = (args: string[]) => run("git", args, { cwd: dir, env });
  try {
    await git(["init", "-b", "feature"]);
    await git(["config", "user.name", "Test"]);
    await git(["config", "user.email", "test@example.com"]);
    await writeFile(join(dir, "test.txt"), "fixture");
    await git(["add", "test.txt"]);
    await git(["commit", "-m", "fixture"]);
    await git(["remote", "add", "origin", "git@github.com:owner/repo.git"]);
    await git(["update-ref", "refs/remotes/origin/feature", "HEAD"]);
    await git(["branch", "--set-upstream-to=origin/feature", "feature"]);
    let headOwner = "owner/repo";
    let ambiguous = false;
    const backend = new GhActivityResolver(async (command, args, options) => {
      if (command === "gh") {
        assert.deepEqual(args, [
          "pr",
          "list",
          "--repo",
          "https://github.com/owner/repo",
          "--head",
          "feature",
          "--state",
          "open",
          "--json",
          "url,headRefName,headRepository",
        ]);
        const entry = {
          url: "https://github.com/owner/repo/pull/42",
          headRefName: "feature",
          headRepository: { nameWithOwner: headOwner },
        };
        return {
          stdout: JSON.stringify(ambiguous ? [entry, entry] : [entry]),
          stderr: "",
          code: 0,
          killed: false,
          truncated: false,
        };
      }
      assert.equal(command, "git");
      try {
        const result = await run(command, args, {
          cwd: options?.cwd,
          env,
          signal: options?.signal,
        });
        return { ...result, code: 0, killed: false, truncated: false };
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === 1
        )
          return {
            stdout: "",
            stderr: "",
            code: 1,
            killed: false,
            truncated: false,
          };
        throw error;
      }
    });
    const signal = new AbortController().signal;
    for (const intent of [
      { kind: "push", cwd: dir },
      { kind: "push", cwd: dir, remote: "origin", refspec: "HEAD:feature" },
    ] satisfies Parameters<typeof backend.prepare>[0][]) {
      const prepared = await backend.prepare(intent, signal);
      assert.deepEqual(prepared.push, {
        repo: "https://github.com/owner/repo",
        branch: "feature",
      });
      assert.equal(
        (await backend.finish(intent, prepared, "", false, signal))[0]?.key,
        "owner/repo#42",
      );
      headOwner = "other/fork";
      assert.deepEqual(
        await backend.finish(intent, prepared, "", false, signal),
        [],
      );
      headOwner = "owner/repo";
      ambiguous = true;
      assert.deepEqual(
        await backend.finish(intent, prepared, "", false, signal),
        [],
      );
      ambiguous = false;
    }
    await git([
      "config",
      "--add",
      "remote.origin.pushurl",
      "git@github.com:owner/repo.git",
    ]);
    await git([
      "config",
      "--add",
      "remote.origin.pushurl",
      "git@github.com:other/repo.git",
    ]);
    assert.deepEqual(
      await backend.prepare(
        { kind: "push", cwd: dir, remote: "origin", refspec: "HEAD" },
        signal,
      ),
      {},
    );
    await git(["config", "--unset-all", "remote.origin.pushurl"]);
    await git(["config", "remote.origin.push", "refs/heads/*:refs/heads/*"]);
    assert.deepEqual(
      await backend.prepare({ kind: "push", cwd: dir }, signal),
      {},
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
