export interface PullRequest {
  readonly key: string;
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
  readonly url: string;
}

/** Only github.com PR URLs; canonical URLs never contain credentials, query strings or commands. */
export function extractPullRequests(text: string): PullRequest[] {
  const pattern =
    /https?:\/\/github\.com\/([a-z\d-]{1,39})\/([a-z\d_.-]{1,100})\/pull\/([1-9]\d*)(?=$|[\s/?#<>"'`)\].,;:!，。；：！？）])/gi;
  const found = new Map<string, PullRequest>();
  for (const match of text.matchAll(pattern)) {
    const [, owner, repo, digits] = match;
    if (!owner || !repo || !digits) continue;
    const number = Number(digits);
    if (!Number.isSafeInteger(number)) continue;
    const key = `${owner}/${repo}#${number}`.toLowerCase();
    found.set(key, {
      key,
      owner,
      repo,
      number,
      url: `https://github.com/${owner}/${repo}/pull/${number}`,
    });
  }
  return [...found.values()];
}

/** Deliberately ignore system prompts, reasoning, tool arguments, images and arbitrary metadata. */
export function messageTexts(message: unknown): string[] {
  if (typeof message !== "object" || message === null || !("role" in message))
    return [];
  if (message.role === "bashExecution") {
    return "output" in message && typeof message.output === "string"
      ? [message.output]
      : [];
  }
  if (
    typeof message.role !== "string" ||
    !["user", "assistant", "toolResult", "custom"].includes(message.role) ||
    !("content" in message)
  )
    return [];
  if (typeof message.content === "string") return [message.content];
  if (!Array.isArray(message.content)) return [];
  const blocks: unknown[] = message.content;
  return blocks.flatMap((block) =>
    typeof block === "object" &&
    block !== null &&
    "type" in block &&
    block.type === "text" &&
    "text" in block &&
    typeof block.text === "string"
      ? [block.text]
      : [],
  );
}
