import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { extractPullRequests, type PullRequest } from "./links.ts";
import { MAX_TRACKED_PRS } from "./watcher.ts";

export const TRACKING_ENTRY = "pi-pr-watch/tracking";
export interface TrackingEvent {
  version: 1;
  action: "watch" | "unwatch";
  urls: string[];
  reason: string;
}

export function parseTrackingEvent(value: unknown): TrackingEvent {
  if (
    typeof value !== "object" ||
    value === null ||
    !("version" in value) ||
    value.version !== 1 ||
    !("action" in value) ||
    (value.action !== "watch" && value.action !== "unwatch") ||
    !("urls" in value) ||
    !Array.isArray(value.urls) ||
    !("reason" in value) ||
    typeof value.reason !== "string"
  ) {
    throw new Error("Invalid pi-pr-watch activity entry (expected version 1).");
  }
  const urls: string[] = [];
  const entries: unknown[] = value.urls;
  for (const item of entries) {
    if (typeof item !== "string") throw new Error("Invalid tracked PR URL.");
    const pr = extractPullRequests(item)[0];
    if (!pr || pr.url !== item)
      throw new Error("Tracked PR URL must be canonical.");
    urls.push(item);
  }
  return { version: 1, action: value.action, urls, reason: value.reason };
}

/** Only explicit activity/manual events are authoritative. Mentioned links are not imported. */
export function restoreTrackedPrs(
  branch: readonly SessionEntry[],
): PullRequest[] {
  const tracked = new Map<string, PullRequest>();
  for (const entry of branch) {
    if (entry.type !== "custom" || entry.customType !== TRACKING_ENTRY)
      continue;
    const event = parseTrackingEvent(entry.data);
    for (const url of event.urls) {
      const pr = extractPullRequests(url)[0];
      if (!pr) throw new Error("Invalid tracked PR invariant.");
      if (event.action === "unwatch") tracked.delete(pr.key);
      else if (!tracked.has(pr.key)) tracked.set(pr.key, pr);
      while (tracked.size > MAX_TRACKED_PRS) {
        const oldest = tracked.keys().next().value;
        if (oldest !== undefined) tracked.delete(oldest);
      }
    }
  }
  return [...tracked.values()];
}
