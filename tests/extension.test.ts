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
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  type MessageEndEvent,
} from "@earendil-works/pi-coding-agent";

test("real Pi loader, gh subprocess, session restore, live links, branch navigation and widget placement", async () => {
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
      `#!/usr/bin/env node\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nfs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args)+'\\n');\nif(args[0]!=='pr'||args[1]!=='view') process.exit(99);\nconsole.log(JSON.stringify({state:'OPEN',isDraft:false,reviewDecision:'APPROVED',statusCheckRollup:[]}));\n`,
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
    loaded.runtime.appendEntry = (type, data) => {
      session.appendCustomEntry(type, data);
    };
    const first = session.appendMessage({
      role: "user",
      content: "看一下 https://github.com/o/first/pull/1",
      timestamp: Date.now(),
    });
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
    runner.onError((error) => errors.push(error.error));
    await runner.emit({ type: "session_start", reason: "startup" });
    await assert.rejects(readFile(log, "utf8"), { code: "ENOENT" });
    runner.setUIContext(
      {
        ...runner.getUIContext(),
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
    await runner.emit({ type: "session_start", reason: "resume" });
    const command = runner.getCommand("prs");
    assert.ok(command);
    await command.handler("refresh", runner.createCommandContext());
    await command.handler("", runner.createCommandContext());
    assert.match(snapshot, /o\/first#1/);
    assert.match(snapshot, /已批准/);
    await command.handler("icons", runner.createCommandContext());
    assert.match(notices.at(-1) ?? "", /unicode/);
    await command.handler("icons nerd", runner.createCommandContext());
    const saved = session.getLeafId();
    await command.handler("icons invalid", runner.createCommandContext());
    assert.equal(session.getLeafId(), saved);
    assert.match(notices.at(-1) ?? "", /必须/);
    await runner.emit({ type: "session_start", reason: "reload" });
    await command.handler("icons", runner.createCommandContext());
    assert.match(notices.at(-1) ?? "", /nerd/);

    const message: MessageEndEvent["message"] = {
      role: "toolResult",
      toolName: "bash",
      toolCallId: "test",
      content: [{ type: "text", text: "https://github.com/o/second/pull/2" }],
      isError: false,
      timestamp: Date.now(),
    };
    session.appendMessage(message);
    await runner.emitMessageEnd({ type: "message_end", message });
    await command.handler("refresh", runner.createCommandContext());
    await delay(100);
    await command.handler("", runner.createCommandContext());
    assert.match(snapshot, /o\/second#2/);
    assert.match(snapshot, /o\/first#1/);
    const oldLeaf = session.getLeafId();
    assert.ok(oldLeaf);
    session.branch(first);
    await runner.emit({
      type: "session_tree",
      newLeafId: first,
      oldLeafId: oldLeaf,
    });
    await command.handler("refresh", runner.createCommandContext());
    await command.handler("", runner.createCommandContext());
    assert.match(snapshot, /o\/first#1/);
    assert.doesNotMatch(snapshot, /o\/second#2/);
    await command.handler("icons", runner.createCommandContext());
    assert.match(notices.at(-1) ?? "", /unicode/);
    assert.ok(placements.length > 0);
    assert.ok(placements.every((value) => value === "belowEditor"));
    assert.deepEqual(errors, []);
    const calls = (await readFile(log, "utf8")).trim().split("\n");
    assert.ok(calls.length >= 3);
    for (const line of calls) assert.match(line, /^\["pr","view",/);
    await runner.emit({ type: "session_shutdown", reason: "quit" });
    runner = undefined;
  } finally {
    if (runner) await runner.emit({ type: "session_shutdown", reason: "quit" });
    if (path === undefined) delete process.env.PATH;
    else process.env.PATH = path;
    if (originalIcons === undefined) delete process.env.PI_PR_WATCH_ICONS;
    else process.env.PI_PR_WATCH_ICONS = originalIcons;
    await rm(dir, { recursive: true, force: true });
  }
});
