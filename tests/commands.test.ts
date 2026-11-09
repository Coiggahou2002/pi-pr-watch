import assert from "node:assert/strict";
import { test } from "node:test";
import { analyzeCommand } from "../extensions/pr-watch/commands.ts";

const cwd = "/project";

test("recognizes supported gh activity, explicit identities and static cwd changes", () => {
  assert.deepEqual(
    analyzeCommand(
      'cd "../work tree" && gh pr edit 42 --repo owner/repo --title "new title"',
      cwd,
    ),
    {
      kind: "gh",
      action: "edit",
      target: "42",
      repo: "owner/repo",
      cwd: "/work tree",
    },
  );
  assert.deepEqual(analyzeCommand("gh -R owner/repo pr ready --undo", cwd), {
    kind: "gh",
    action: "ready",
    repo: "owner/repo",
    cwd,
  });
  assert.deepEqual(analyzeCommand("gh pr create -tTitle -bBody --draft", cwd), {
    kind: "gh",
    action: "create",
    cwd,
  });
  assert.equal(analyzeCommand("gh pr checks 42 --watch", cwd)?.kind, "gh");
  assert.equal(
    analyzeCommand("gh pr checkout https://github.com/o/r/pull/1", cwd)?.kind,
    "gh",
  );
});

test("subcommand-specific flag arity cannot confuse comment bodies with PR identity", () => {
  for (const command of [
    "gh pr review -a 42",
    "gh pr review -r 42",
    "gh pr merge -m 42",
    "gh pr merge -r 42",
    'gh pr close -c "closing comment" 42',
    'gh pr reopen --comment "another branch" 42',
  ]) {
    const intent = analyzeCommand(command, cwd);
    assert.ok(intent?.kind === "gh");
    assert.equal(intent.target, "42", command);
  }
  const implicit = analyzeCommand(
    'gh pr close --comment "not a PR target"',
    cwd,
  );
  assert.ok(implicit?.kind === "gh");
  assert.equal(implicit.target, undefined);
});

test("mere mentions, read-only commands, dry-runs, help and non-watching checks are not activity", () => {
  for (const command of [
    "gh pr list",
    "gh pr view 42",
    "gh pr checks 42",
    "gh pr checks 42 -w",
    "gh pr checks 42 --watch=false",
    "gh pr create --dry-run",
    "gh pr edit --help",
    "echo 'gh pr edit 42'",
    "cat example.md",
    "git push --dry-run origin HEAD",
    "git push --all",
    "git push --delete origin branch",
    "git push origin one two",
  ]) {
    assert.equal(analyzeCommand(command, cwd), undefined, command);
  }
});

test("compound, dynamic, masked failures and unknown flags fail closed without executing expansions", () => {
  for (const command of [
    "gh pr edit 42; true",
    "gh pr edit 42 || true",
    "gh pr edit 42 && echo ok",
    "gh pr edit 42 | cat",
    "gh pr edit $PR",
    'gh pr edit "$(printf 42)"',
    "gh pr edit `printf 42`",
    "gh pr edit {1,2}",
    "gh pr edit 42 > output",
    "gh pr edit 42\necho ok",
    "gh pr edit 42 --new-unknown-flag 2",
    "GH_REPO=o/r gh pr edit 42",
    "cd ~ && gh pr edit 42",
  ]) {
    assert.equal(analyzeCommand(command, cwd), undefined, command);
  }
});

test("recognizes a single git push and git -C without guessing refspec semantics", () => {
  assert.deepEqual(
    analyzeCommand("git -C ../repo push -u origin HEAD:feature", cwd),
    { kind: "push", cwd: "/repo", remote: "origin", refspec: "HEAD:feature" },
  );
  assert.deepEqual(analyzeCommand("git push", cwd), { kind: "push", cwd });
  assert.deepEqual(
    analyzeCommand("git push --force-with-lease origin feature", cwd),
    { kind: "push", cwd, remote: "origin", refspec: "feature" },
  );
});
