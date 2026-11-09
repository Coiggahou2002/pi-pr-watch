import { resolve } from "node:path";
import { parse } from "shell-quote";

export type GhAction =
  | "create"
  | "checkout"
  | "edit"
  | "comment"
  | "review"
  | "ready"
  | "reopen"
  | "merge"
  | "close"
  | "checks";
export type ActivityIntent =
  | {
      kind: "gh";
      action: GhAction;
      cwd: string;
      target?: string;
      repo?: string;
    }
  | { kind: "push"; cwd: string; remote?: string; refspec?: string };

const BODY_FLAGS = ["--body", "-b", "--body-file", "-F"];
// Arity is per subcommand: e.g. review -r is boolean, create -r takes a reviewer.
const GH_FLAGS: Record<
  GhAction,
  { values: readonly string[]; booleans: readonly string[] }
> = {
  create: {
    values: [
      ...BODY_FLAGS,
      "--title",
      "-t",
      "--base",
      "-B",
      "--head",
      "-H",
      "--assignee",
      "-a",
      "--reviewer",
      "-r",
      "--label",
      "-l",
      "--milestone",
      "-m",
      "--project",
      "-p",
      "--template",
      "-T",
      "--recover",
      "--attach",
    ],
    booleans: [
      "--draft",
      "-d",
      "--fill",
      "-f",
      "--fill-first",
      "--fill-verbose",
      "--no-maintainer-edit",
      "--web",
      "-w",
      "--editor",
      "-e",
    ],
  },
  edit: {
    values: [
      ...BODY_FLAGS,
      "--title",
      "-t",
      "--base",
      "-B",
      "--milestone",
      "-m",
      "--add-assignee",
      "--remove-assignee",
      "--add-label",
      "--remove-label",
      "--add-project",
      "--remove-project",
      "--add-reviewer",
      "--remove-reviewer",
      "--attach",
    ],
    booleans: ["--remove-milestone"],
  },
  comment: {
    values: [...BODY_FLAGS, "--attach"],
    booleans: [
      "--edit-last",
      "--create-if-none",
      "--delete-last",
      "--editor",
      "-e",
      "--web",
      "-w",
      "--yes",
    ],
  },
  review: {
    values: BODY_FLAGS,
    booleans: ["--approve", "-a", "--comment", "-c", "--request-changes", "-r"],
  },
  merge: {
    values: [
      ...BODY_FLAGS,
      "--subject",
      "-t",
      "--author-email",
      "-A",
      "--match-head-commit",
    ],
    booleans: [
      "--admin",
      "--auto",
      "--disable-auto",
      "--delete-branch",
      "-d",
      "--merge",
      "-m",
      "--rebase",
      "-r",
      "--squash",
      "-s",
    ],
  },
  close: { values: ["--comment", "-c"], booleans: ["--delete-branch", "-d"] },
  reopen: { values: ["--comment", "-c"], booleans: [] },
  ready: { values: [], booleans: ["--undo"] },
  checkout: {
    values: ["--branch", "-b", "--worktree"],
    booleans: ["--detach", "--force", "-f", "--recurse-submodules"],
  },
  checks: {
    values: ["--interval", "-i", "--jq", "-q", "--json", "--template", "-t"],
    booleans: ["--watch", "--fail-fast", "--required", "--web", "-w"],
  },
};
function flagKind(
  action: GhAction,
  name: string,
): "value" | "boolean" | undefined {
  if (
    name === "--repo" ||
    name === "-R" ||
    GH_FLAGS[action].values.includes(name)
  )
    return "value";
  if (GH_FLAGS[action].booleans.includes(name)) return "boolean";
  return undefined;
}
const PUSH_FLAGS = new Set([
  "-u",
  "--set-upstream",
  "--force",
  "-f",
  "--force-with-lease",
  "--force-if-includes",
  "--no-verify",
  "--atomic",
  "--quiet",
  "-q",
  "--verbose",
  "-v",
  "--progress",
  "--porcelain",
  "--follow-tags",
]);

function ghAction(value: string | undefined): value is GhAction {
  return (
    value !== undefined &&
    [
      "create",
      "checkout",
      "edit",
      "comment",
      "review",
      "ready",
      "reopen",
      "merge",
      "close",
      "checks",
    ].includes(value)
  );
}

/** A deliberately small, static shell subset. Unknown syntax is not evidence. */
export function analyzeCommand(
  command: string,
  initialCwd: string,
): ActivityIntent | undefined {
  // shell-quote is a tokenizer, not a shell AST. Reject constructs it cannot prove safe.
  if (/[\r\n`{}]/u.test(command) || command.includes("$(")) return undefined;
  let tokens;
  try {
    tokens = parse(command, () => {
      throw new Error("Dynamic expansion");
    });
  } catch {
    return undefined;
  } // Unsupported shell syntax, not an execution error.
  const segments: string[][] = [[]];
  for (const token of tokens) {
    if (typeof token === "string") segments.at(-1)?.push(token);
    else if ("op" in token && token.op === "&&") segments.push([]);
    else return undefined;
  }
  let cwd = initialCwd;
  for (const segment of segments.slice(0, -1)) {
    const path =
      segment.length === 3 && segment[1] === "--"
        ? segment[2]
        : segment.length === 2
          ? segment[1]
          : undefined;
    if (
      segment[0] !== "cd" ||
      !path ||
      path.startsWith("-") ||
      path.startsWith("~")
    )
      return undefined;
    cwd = resolve(cwd, path);
  }
  const args = [...(segments.at(-1) ?? [])];
  const executable = args.shift();
  if (executable === "git") {
    while (args[0] === "-C") {
      args.shift();
      const path = args.shift();
      if (!path || path.startsWith("~")) return undefined;
      cwd = resolve(cwd, path);
    }
    if (args.shift() !== "push") return undefined;
    const positional: string[] = [];
    let endFlags = false;
    for (const arg of args) {
      if (arg === "--") {
        endFlags = true;
        continue;
      }
      if (!endFlags && arg.startsWith("-")) {
        const name = arg.split("=")[0] ?? "";
        if (
          !PUSH_FLAGS.has(name) ||
          (arg.includes("=") && name !== "--force-with-lease")
        )
          return undefined;
      } else positional.push(arg);
    }
    if (positional.length > 2) return undefined;
    return {
      kind: "push",
      cwd,
      ...(positional[0] ? { remote: positional[0] } : {}),
      ...(positional[1] ? { refspec: positional[1] } : {}),
    };
  }
  if (executable !== "gh") return undefined;
  let repo: string | undefined;
  while (args[0] === "-R" || args[0] === "--repo") {
    args.shift();
    repo = args.shift();
    if (!repo) return undefined;
  }
  if (args.shift() !== "pr") return undefined;
  const action = args.shift();
  if (!ghAction(action)) return undefined;
  let target: string | undefined;
  let watch = false;
  let endFlags = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === undefined) return undefined;
    if (arg === "--") {
      endFlags = true;
      continue;
    }
    if (!endFlags && arg.startsWith("-")) {
      const equals = arg.indexOf("=");
      let name = equals < 0 ? arg : arg.slice(0, equals);
      let value = equals < 0 ? undefined : arg.slice(equals + 1);
      if (
        !arg.startsWith("--") &&
        arg.length > 2 &&
        flagKind(action, arg.slice(0, 2)) === "value"
      ) {
        name = arg.slice(0, 2);
        value = arg.slice(2);
      }
      if (flagKind(action, name) === "value") {
        value ??= args[++index];
        if (value === undefined) return undefined;
        if (name === "--repo" || name === "-R") repo = value;
      } else if (flagKind(action, name) === "boolean") {
        if (value !== undefined && value !== "true" && value !== "false")
          return undefined;
        if (name === "--watch") watch = value !== "false";
      } else return undefined;
    } else {
      if (target !== undefined || arg.startsWith("-")) return undefined;
      target = arg;
    }
  }
  if (action === "checks" && !watch) return undefined;
  if (action === "create" && target !== undefined) return undefined;
  return {
    kind: "gh",
    action,
    cwd,
    ...(target ? { target } : {}),
    ...(repo ? { repo } : {}),
  };
}
