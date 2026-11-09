import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { analyzeCommand, type ActivityIntent } from "./commands.ts";
import { extractPullRequests, type PullRequest } from "./links.ts";

const LOOKUP_TIMEOUT_MS = 10000;
const MAX_LOOKUP_BYTES = 128 * 1024;
export interface PreparedActivity {
  pr?: PullRequest;
  push?: { repo: string; branch: string };
}
export interface ActivityResolver {
  prepare(
    intent: ActivityIntent,
    signal: AbortSignal,
  ): Promise<PreparedActivity>;
  finish(
    intent: ActivityIntent,
    prepared: PreparedActivity,
    output: string,
    truncated: boolean,
    signal: AbortSignal,
  ): Promise<PullRequest[]>;
}

function githubRepo(remote: string): string | undefined {
  const ssh =
    /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/u.exec(
      remote,
    );
  if (ssh?.[1] && ssh[2]) return `https://github.com/${ssh[1]}/${ssh[2]}`;
  try {
    const url = new URL(remote);
    if (
      url.hostname !== "github.com" ||
      url.port ||
      !["https:", "http:"].includes(url.protocol)
    )
      return undefined;
    const path = url.pathname.replace(/\.git$/u, "").replace(/\/$/u, "");
    if (!/^\/[^/]+\/[^/]+$/u.test(path)) return undefined;
    return `https://github.com${path}`;
  } catch {
    return undefined;
  } // A normal git remote name is not a URL.
}

export class GhActivityResolver implements ActivityResolver {
  constructor(private readonly exec: ExtensionAPI["exec"]) {}
  private async query(
    command: string,
    args: string[],
    cwd: string,
    signal: AbortSignal,
    optional = false,
  ): Promise<string | undefined> {
    const result = await this.exec(command, args, {
      cwd,
      signal,
      timeout: LOOKUP_TIMEOUT_MS,
      maxBuffer: MAX_LOOKUP_BYTES,
    });
    signal.throwIfAborted();
    if (optional && result.code === 1 && !result.killed && !result.truncated)
      return undefined;
    if (result.code !== 0 || result.killed || result.truncated)
      throw new Error(
        `${command} PR 目标解析失败。可用 /prs watch <URL> 手动关注。`,
      );
    return result.stdout.trim();
  }

  async prepare(
    intent: ActivityIntent,
    signal: AbortSignal,
  ): Promise<PreparedActivity> {
    if (intent.kind === "gh") {
      if (intent.action === "create") return {};
      const args = [
        "pr",
        "view",
        ...(intent.target ? [intent.target] : []),
        ...(intent.repo ? ["--repo", intent.repo] : []),
        "--json",
        "url",
      ];
      const raw = await this.query("gh", args, intent.cwd, signal);
      const value: unknown = JSON.parse(raw ?? "null");
      if (
        typeof value !== "object" ||
        value === null ||
        !("url" in value) ||
        typeof value.url !== "string"
      )
        throw new Error("Invalid PR identity response.");
      const prs = extractPullRequests(value.url);
      if (prs.length !== 1 || !prs[0])
        throw new Error("PR identity is not a supported GitHub URL.");
      return { pr: prs[0] };
    }
    // Resolve before push, while branch/upstream identity still belongs to this operation.
    const branch = await this.query(
      "git",
      ["symbolic-ref", "--quiet", "--short", "HEAD"],
      intent.cwd,
      signal,
    );
    if (!branch) return {};
    const mode =
      (await this.query(
        "git",
        ["config", "--get", "push.default"],
        intent.cwd,
        signal,
        true,
      )) ?? "simple";
    if (!intent.refspec && !["simple", "current", "upstream"].includes(mode))
      return {};
    const mapping = intent.remote
      ? undefined
      : await this.query(
          "git",
          [
            "for-each-ref",
            "--format=%(push:remotename)",
            `refs/heads/${branch}`,
          ],
          intent.cwd,
          signal,
        );
    const remote = intent.remote ?? mapping;
    if (!remote) return {};
    const mirror = await this.query(
      "git",
      ["config", "--bool", "--get", `remote.${remote}.mirror`],
      intent.cwd,
      signal,
      true,
    );
    if (mirror === "true") return {};
    const configuredRefs = await this.query(
      "git",
      ["config", "--get-all", `remote.${remote}.push`],
      intent.cwd,
      signal,
      true,
    );
    if (configuredRefs && !intent.refspec) return {}; // Matching/multi-ref pushes are not attributable to one PR.
    let destination: string | undefined;
    if (intent.refspec) {
      const ref = intent.refspec.replace(/^\+/u, "");
      const parts = ref.split(":");
      if (
        parts.length > 2 ||
        !parts[0] ||
        parts[0].includes("*") ||
        parts[0].startsWith("refs/tags/")
      )
        return {};
      destination =
        parts.length === 2 ? parts[1] : parts[0] === "HEAD" ? branch : parts[0];
    } else if (mode === "upstream") {
      const upstream = await this.query(
        "git",
        [
          "for-each-ref",
          "--format=%(upstream:remotename)%00%(upstream:remoteref)",
          `refs/heads/${branch}`,
        ],
        intent.cwd,
        signal,
      );
      const [upstreamRemote, upstreamRef] = (upstream ?? "").split("\0");
      if (upstreamRemote !== remote) return {};
      destination = upstreamRef;
    } else destination = branch;
    if (
      !destination ||
      (destination.startsWith("refs/") &&
        !destination.startsWith("refs/heads/"))
    )
      return {};
    destination = destination.replace(/^refs\/heads\//u, "");
    await this.query(
      "git",
      ["check-ref-format", "--branch", destination],
      intent.cwd,
      signal,
    );
    const directRepo = githubRepo(remote);
    const urls = directRepo
      ? [remote]
      : ((
          await this.query(
            "git",
            ["remote", "get-url", "--push", "--all", remote],
            intent.cwd,
            signal,
          )
        )?.split("\n") ?? []);
    if (urls.length !== 1 || !urls[0]) return {};
    const repo = githubRepo(urls[0]);
    return repo ? { push: { repo, branch: destination } } : {};
  }

  async finish(
    intent: ActivityIntent,
    prepared: PreparedActivity,
    output: string,
    truncated: boolean,
    signal: AbortSignal,
  ): Promise<PullRequest[]> {
    if (intent.kind === "gh") {
      if (intent.action !== "create") return prepared.pr ? [prepared.pr] : [];
      if (truncated) return [];
      const prs = extractPullRequests(output);
      return prs.length === 1 ? prs : [];
    }
    if (!prepared.push) return [];
    const raw = await this.query(
      "gh",
      [
        "pr",
        "list",
        "--repo",
        prepared.push.repo,
        "--head",
        prepared.push.branch,
        "--state",
        "open",
        "--json",
        "url,headRefName,headRepository",
      ],
      intent.cwd,
      signal,
    );
    const value: unknown = JSON.parse(raw ?? "null");
    if (!Array.isArray(value))
      throw new Error("Invalid pushed-branch PR response.");
    const entries: unknown[] = value;
    const matches: PullRequest[] = [];
    for (const entry of entries) {
      if (
        typeof entry !== "object" ||
        entry === null ||
        !("url" in entry) ||
        typeof entry.url !== "string" ||
        !("headRefName" in entry) ||
        typeof entry.headRefName !== "string" ||
        !("headRepository" in entry)
      )
        throw new Error("Invalid pushed-branch PR identity.");
      const head = entry.headRepository;
      if (head === null) continue;
      if (
        typeof head !== "object" ||
        !("nameWithOwner" in head) ||
        typeof head.nameWithOwner !== "string"
      )
        throw new Error("Invalid pushed-branch head repository.");
      const expectedRepo = prepared.push.repo
        .replace("https://github.com/", "")
        .toLowerCase();
      if (
        entry.headRefName !== prepared.push.branch ||
        head.nameWithOwner.toLowerCase() !== expectedRepo
      )
        continue;
      const pr = extractPullRequests(entry.url)[0];
      if (pr && `${pr.owner}/${pr.repo}`.toLowerCase() === expectedRepo)
        matches.push(pr);
    }
    return matches.length === 1 ? matches : []; // Never choose among ambiguous head identities.
  }
}

interface PendingActivity {
  intent: ActivityIntent;
  prepared?: PreparedActivity;
  error?: unknown;
  ambiguous: boolean;
  sequence: number;
}
export class ActivityObserver {
  private readonly running = new Map<string, string | undefined>();
  private readonly pending = new Map<string, PendingActivity>();
  private readonly controller = new AbortController();
  private readonly unwatched = new Map<string, number>();
  private sequence = 0;
  constructor(
    private readonly resolver: ActivityResolver,
    private readonly follow: (prs: PullRequest[], reason: string) => void,
    private readonly report: (error: unknown) => void,
  ) {}

  async before(
    id: string,
    command: string,
    cwd: string,
    signal?: AbortSignal,
    observeUnknown = false,
  ): Promise<boolean> {
    if (this.controller.signal.aborted) return false;
    const intent = analyzeCommand(command, cwd);
    if (!intent && !observeUnknown) return false;
    const scope = intent?.cwd;
    let overlapping = false;
    for (const [otherId, otherScope] of this.running) {
      if (
        scope === undefined ||
        otherScope === undefined ||
        scope === otherScope
      ) {
        overlapping = true;
        const other = this.pending.get(otherId);
        if (other) other.ambiguous = true;
      }
    }
    this.running.set(id, scope);
    if (!intent) return false;
    const pending: PendingActivity = {
      intent,
      ambiguous: overlapping,
      sequence: ++this.sequence,
    };
    this.pending.set(id, pending);
    try {
      pending.prepared = await this.resolver.prepare(
        intent,
        signal
          ? AbortSignal.any([signal, this.controller.signal])
          : this.controller.signal,
      );
    } catch (error) {
      pending.error = error;
    } // Discovery failure must never block the user's command.
    return !this.controller.signal.aborted && this.pending.get(id) === pending;
  }
  async after(
    id: string,
    exitCode: number | undefined,
    output: string,
    truncated: boolean,
  ): Promise<void> {
    const pending = this.pending.get(id);
    this.pending.delete(id);
    this.running.delete(id);
    if (!pending || this.controller.signal.aborted) return;
    const checksFailed =
      pending.intent.kind === "gh" &&
      pending.intent.action === "checks" &&
      exitCode === 1;
    if (exitCode !== 0 && !checksFailed) return;
    if (
      pending.ambiguous &&
      !(pending.intent.kind === "gh" && pending.intent.action === "create")
    ) {
      this.report(
        new Error(
          "命令存在并行执行，无法保证工作目录身份稳定；请用 /prs watch <URL> 明确关注。",
        ),
      );
      return;
    }
    if (pending.error) {
      this.report(pending.error);
      return;
    }
    if (!pending.prepared) return;
    try {
      const prs = await this.resolver.finish(
        pending.intent,
        pending.prepared,
        output,
        truncated,
        this.controller.signal,
      );
      const eligible = prs.filter(
        (pr) => (this.unwatched.get(pr.key) ?? -1) < pending.sequence,
      );
      if (!this.controller.signal.aborted && eligible.length)
        this.follow(
          eligible,
          pending.intent.kind === "push"
            ? "git:push"
            : `gh:${pending.intent.action}`,
        );
    } catch (error) {
      if (!this.controller.signal.aborted) this.report(error);
    }
  }
  unwatch(key: string): void {
    this.unwatched.set(key, this.sequence);
  }
  cancel(id: string): void {
    this.pending.delete(id);
    this.running.delete(id);
  }
  dispose(): void {
    this.controller.abort();
    this.pending.clear();
    this.running.clear();
    this.unwatched.clear();
  }
}
