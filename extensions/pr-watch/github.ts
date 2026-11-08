import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PullRequest } from "./links.ts";

const QUERY_TIMEOUT_MS = 15000;
const MAX_QUERY_BYTES = 256 * 1024;
const MAX_ERROR_LENGTH = 500;

export interface PrStatus {
  state: "OPEN" | "CLOSED" | "MERGED";
  draft: boolean;
  checks: "passing" | "failing" | "pending" | "none" | "unknown";
  review: "approved" | "changes" | "required" | "unknown";
}

export interface PullRequestClient {
  fetch(pr: PullRequest, signal: AbortSignal): Promise<PrStatus>;
}

function checkState(value: unknown): PrStatus["checks"] {
  if (typeof value !== "object" || value === null)
    throw new Error("Invalid GitHub check object.");
  if ("state" in value) {
    switch (value.state) {
      case "SUCCESS":
        return "passing";
      case "ERROR":
      case "FAILURE":
        return "failing";
      case "PENDING":
      case "EXPECTED":
        return "pending";
      default:
        return "unknown";
    }
  }
  if (!("status" in value)) throw new Error("GitHub check has no status.");
  if (
    value.status === "QUEUED" ||
    value.status === "IN_PROGRESS" ||
    value.status === "WAITING" ||
    value.status === "PENDING" ||
    value.status === "REQUESTED"
  )
    return "pending";
  if (value.status !== "COMPLETED" || !("conclusion" in value))
    return "unknown";
  switch (value.conclusion) {
    case "SUCCESS":
      return "passing";
    case "NEUTRAL":
    case "SKIPPED":
      return "none";
    case "FAILURE":
    case "CANCELLED":
    case "TIMED_OUT":
    case "ACTION_REQUIRED":
    case "STARTUP_FAILURE":
    case "STALE":
      return "failing";
    default:
      return "unknown";
  }
}

export function parsePrStatus(value: unknown): PrStatus {
  if (
    typeof value !== "object" ||
    value === null ||
    !("state" in value) ||
    (value.state !== "OPEN" &&
      value.state !== "CLOSED" &&
      value.state !== "MERGED") ||
    !("isDraft" in value) ||
    typeof value.isDraft !== "boolean" ||
    !("statusCheckRollup" in value) ||
    (value.statusCheckRollup !== null &&
      !Array.isArray(value.statusCheckRollup)) ||
    !("reviewDecision" in value)
  )
    throw new Error("Invalid gh pr view response.");
  const checks: unknown[] = value.statusCheckRollup ?? [];
  const states = checks.map(checkState);
  const summary = states.includes("failing")
    ? "failing"
    : states.includes("pending")
      ? "pending"
      : states.includes("unknown")
        ? "unknown"
        : states.includes("passing")
          ? "passing"
          : "none";
  let review: PrStatus["review"];
  switch (value.reviewDecision) {
    case "APPROVED":
      review = "approved";
      break;
    case "CHANGES_REQUESTED":
      review = "changes";
      break;
    case "REVIEW_REQUIRED":
      review = "required";
      break;
    case "":
    case null:
      review = "unknown";
      break;
    default:
      throw new Error("Unknown GitHub review decision.");
  }
  return { state: value.state, draft: value.isDraft, checks: summary, review };
}

export class GhPullRequestClient implements PullRequestClient {
  constructor(
    private readonly exec: ExtensionAPI["exec"],
    private readonly cwd: string,
  ) {}

  async fetch(pr: PullRequest, signal: AbortSignal): Promise<PrStatus> {
    const result = await this.exec(
      "gh",
      [
        "pr",
        "view",
        pr.url,
        "--json",
        "state,isDraft,reviewDecision,statusCheckRollup",
      ],
      {
        cwd: this.cwd,
        signal,
        timeout: QUERY_TIMEOUT_MS,
        maxBuffer: MAX_QUERY_BYTES,
      },
    );
    signal.throwIfAborted();
    if (result.code !== 0 || result.killed || result.truncated) {
      throw new Error(
        result.stderr.trim().slice(0, MAX_ERROR_LENGTH) ||
          "gh 查询失败（超时、输出过大或命令不可用）。",
      );
    }
    const value: unknown = JSON.parse(result.stdout);
    return parsePrStatus(value);
  }
}
