import assert from "node:assert/strict";
import {
  chmod,
  mkdtemp,
  mkdir,
  rm,
  writeFile,
  readFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";

test("real Pi lifecycle observes activity, not mentions; persists explicit watch/unwatch and isolates branches", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pi-pr-watch-test-"));
  const path = process.env.PATH;
  const originalIcons = process.env.PI_PR_WATCH_ICONS;
  process.env.PI_PR_WATCH_ICONS = "unicode";
  let runner: ExtensionRunner | undefined;
  try {
    await mkdir(join(dir, "bin"));
    const log = join(dir, "calls.jsonl");
    const fixture = join(dir, "bin", "gh");
    await writeFile(
      fixture,
      `#!/usr/bin/env node\nconst fs=require('node:fs');const args=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');\nif(args[0]!=='pr'||args[1]!=='view')process.exit(99);\nconst fields=args[args.indexOf('--json')+1];const target=args[2];\nif(fields==='url')console.log(JSON.stringify({url:target.startsWith('https://')?target:'https://github.com/o/active/pull/'+(/^\\d+$/.test(target)?target:'42')}));\nelse console.log(JSON.stringify({state:'OPEN',isDraft:false,reviewDecision:'APPROVED',statusCheckRollup:[]}));\n`,
    );
    await chmod(fixture, 0o755);
    process.env.PATH = `${join(dir, "bin")}:${path ?? ""}`;
    const cwd = resolve(".");
    const loaded = await discoverAndLoadExtensions(
      [resolve("extensions/pr-watch/index.ts")],
      cwd,
      dir,
    );
    assert.deepEqual(loaded.errors, []);
    const session = SessionManager.create(cwd, join(dir, "sessions"));
    session.appendMessage({
      role: "user",
      content: "仅仅提到 https://github.com/o/first/pull/1",
      timestamp: Date.now(),
    });
    loaded.runtime.appendEntry = (type, data) => {
      session.appendCustomEntry(type, data);
    };
    const models = await ModelRuntime.create({
      authPath: join(dir, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(dir, "models.json"),
      refreshOnCreate: false,
    });
    runner = new ExtensionRunner(
      loaded.extensions,
      loaded.runtime,
      cwd,
      session,
      new ModelRegistry(models),
    );
    let snapshot = "";
    const notices: string[] = [];
    const placements: (string | undefined)[] = [];
    const errors: string[] = [];
    function bindUI(target: ExtensionRunner): void {
      target.onError((error) => errors.push(error.error));
      target.setUIContext(
        {
          ...target.getUIContext(),
          notify(message) {
            notices.push(message);
          },
          setWidget(_key, content, options) {
            if (content !== undefined) placements.push(options?.placement);
          },
          async editor(_title, text) {
            snapshot = text ?? "";
            return undefined;
          },
        },
        "tui",
      );
    }
    await runner.emit({ type: "session_start", reason: "startup" });
    await assert.rejects(readFile(log, "utf8"), { code: "ENOENT" });
    bindUI(runner);
    await runner.emit({ type: "session_start", reason: "resume" });
    const command = runner.getCommand("prs");
    assert.ok(command);
    await command.handler("", runner.createCommandContext());
    assert.match(snapshot, /没有关注/);
    await runner.emitMessageEnd({
      type: "message_end",
      message: {
        role: "toolResult",
        toolName: "read",
        toolCallId: "source",
        content: [
          { type: "text", text: "https://github.com/o/examples/pull/2" },
        ],
        isError: false,
        timestamp: Date.now(),
      },
    });
    await assert.rejects(readFile(log, "utf8"), { code: "ENOENT" });

    const activeRunner = runner;
    async function action(
      id: string,
      text: string,
      code: number,
      output = "",
    ): Promise<void> {
      await activeRunner.emitToolCall({
        type: "tool_call",
        toolName: "bash",
        toolCallId: id,
        input: { command: text },
      });
      await activeRunner.emitToolResult({
        type: "tool_result",
        toolName: "bash",
        toolCallId: id,
        input: { command: text },
        content: [{ type: "text", text: output }],
        details: undefined,
        isError: code !== 0,
        structuredContent: { exit_code: code, truncated: false },
      });
    }
    await action(
      "view",
      "gh pr view 42",
      0,
      "https://github.com/o/active/pull/42",
    );
    await assert.rejects(readFile(log, "utf8"), { code: "ENOENT" });
    await action(
      "create",
      'gh pr create --title "new" --body "private body not saved"',
      0,
      "https://github.com/o/active/pull/42",
    );
    const firstWatch = session.getLeafId();
    assert.ok(firstWatch);
    await command.handler("refresh", runner.createCommandContext());
    await command.handler("", runner.createCommandContext());
    assert.match(snapshot, /o\/active#42.*已批准/);
    assert.doesNotMatch(snapshot, /first|examples/);
    assert.doesNotMatch(
      JSON.stringify(session.getEntries()),
      /private body not saved/,
    );
    await action("fail", 'gh pr edit 99 --title "new"', 1);
    await command.handler("", runner.createCommandContext());
    assert.doesNotMatch(snapshot, /#99/);
    await action(
      "watch-failing-ci",
      "gh pr checks 77 --watch",
      1,
      "checks failed",
    );
    await command.handler("refresh", runner.createCommandContext());
    await command.handler("", runner.createCommandContext());
    assert.match(snapshot, /#77/);

    const userCommand = "gh pr ready 88";
    assert.equal(
      await runner.emitUserBash({
        type: "user_bash",
        command: userCommand,
        cwd,
        excludeFromContext: false,
      }),
      undefined,
      "observation must not replace the shell backend",
    );
    const executed = {
      role: "bashExecution",
      command: userCommand,
      output: "",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      timestamp: Date.now(),
    } satisfies Parameters<typeof session.appendMessage>[0];
    session.appendMessage(executed);
    await runner.emitMessageEnd({ type: "message_end", message: executed });
    await command.handler("", runner.createCommandContext());
    assert.match(snapshot, /#88/);
    await runner.emitUserBash({
      type: "user_bash",
      command: "gh pr ready 999",
      cwd,
      excludeFromContext: true,
    });
    session.appendMessage({
      role: "bashExecution",
      command: "gh pr ready 999",
      output: "",
      exitCode: 0,
      cancelled: false,
      truncated: false,
      excludeFromContext: true,
      timestamp: Date.now(),
    });
    await command.handler("", runner.createCommandContext());
    assert.doesNotMatch(snapshot, /#999/);
    assert.doesNotMatch(await readFile(log, "utf8"), /"999"/);
    await command.handler(
      "watch https://github.com/manual/repo/pull/9",
      runner.createCommandContext(),
    );
    await command.handler("", runner.createCommandContext());
    assert.match(snapshot, /manual\/repo#9/);
    await command.handler(
      "unwatch manual/repo#9",
      runner.createCommandContext(),
    );
    await command.handler("", runner.createCommandContext());
    assert.doesNotMatch(snapshot, /manual\/repo#9/);
    await command.handler("icons nerd", runner.createCommandContext());
    const oldLeaf = session.getLeafId();
    assert.ok(oldLeaf);
    await runner.emit({ type: "session_start", reason: "reload" });
    await command.handler("icons", runner.createCommandContext());
    assert.match(notices.at(-1) ?? "", /nerd/);
    session.branch(firstWatch);
    await runner.emit({
      type: "session_tree",
      newLeafId: firstWatch,
      oldLeafId: oldLeaf,
    });
    await command.handler("refresh", runner.createCommandContext());
    await command.handler("", runner.createCommandContext());
    assert.match(snapshot, /#42/);
    assert.doesNotMatch(snapshot, /#77|#88|manual/);
    await command.handler("icons", runner.createCommandContext());
    assert.match(notices.at(-1) ?? "", /unicode/);

    session.appendMessage({
      role: "user",
      content: "继续",
      timestamp: Date.now(),
    });
    const file = session.getSessionFile();
    assert.ok(file);
    await runner.emit({ type: "session_shutdown", reason: "quit" });
    runner = undefined;
    const reopened = SessionManager.open(file);
    const resumed = await discoverAndLoadExtensions(
      [resolve("extensions/pr-watch/index.ts")],
      cwd,
      dir,
    );
    assert.deepEqual(resumed.errors, []);
    resumed.runtime.appendEntry = (type, data) => {
      reopened.appendCustomEntry(type, data);
    };
    runner = new ExtensionRunner(
      resumed.extensions,
      resumed.runtime,
      cwd,
      reopened,
      new ModelRegistry(models),
    );
    bindUI(runner);
    await runner.emit({ type: "session_start", reason: "resume" });
    const resumedCommand = runner.getCommand("prs");
    assert.ok(resumedCommand);
    await resumedCommand.handler("refresh", runner.createCommandContext());
    await resumedCommand.handler("", runner.createCommandContext());
    assert.match(snapshot, /#42/);
    assert.doesNotMatch(snapshot, /#77|#88|manual|first|examples/);
    assert.ok(placements.length > 0);
    assert.ok(placements.every((value) => value === "belowEditor"));
    assert.deepEqual(errors, []);
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    for (const line of calls) assert.match(line, /^\["pr","view",/);
  } finally {
    if (runner) await runner.emit({ type: "session_shutdown", reason: "quit" });
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
    if (originalIcons === undefined) delete process.env.PI_PR_WATCH_ICONS;
    else process.env.PI_PR_WATCH_ICONS = originalIcons;
    await rm(dir, { recursive: true, force: true });
  }
});
