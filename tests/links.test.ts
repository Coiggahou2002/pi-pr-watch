import assert from "node:assert/strict";
import { test } from "node:test";
import {
  extractPullRequests,
  messageTexts,
} from "../extensions/pr-watch/links.ts";

const url = "https://github.com/Owner/Repo/pull/42";

test("discovers, canonicalizes and deduplicates PR links in markdown and gh output", () => {
  const found = extractPullRequests(
    `[PR](${url}/files#diff-abc).\n${url}?x=1\nhttps://github.com/owner/repo/pull/42\nhttp://github.com/Other/project/pull/2,`,
  );
  assert.equal(found.length, 2);
  assert.equal(found[0]?.key, "owner/repo#42");
  assert.equal(found[0]?.url, "https://github.com/owner/repo/pull/42");
  assert.equal(found[1]?.key, "other/project#2");
});

test("rejects issues, fake hosts, credentials, enterprise hosts and nonnumeric PR IDs", () => {
  for (const value of [
    "https://github.com/o/r/issues/1",
    "https://github.com.evil/o/r/pull/1",
    "https://github.com@evil/o/r/pull/1",
    "https://user:pass@github.com/o/r/pull/1",
    "https://enterprise.test/o/r/pull/1",
    "https://github.com/o/r/pull/0",
    "https://github.com/o/r/pull/12abc",
    "https://github.com/o/r/pull/99999999999999999999",
  ]) {
    assert.deepEqual(extractPullRequests(value), [], value);
  }
});

test("reads visible user, assistant, tool and bash text, not reasoning or images", () => {
  assert.deepEqual(messageTexts({ role: "user", content: url }), [url]);
  assert.deepEqual(
    messageTexts({
      role: "assistant",
      content: [
        { type: "text", text: url },
        { type: "thinking", thinking: url },
        { type: "toolCall", arguments: { url } },
      ],
    }),
    [url],
  );
  assert.deepEqual(
    messageTexts({
      role: "toolResult",
      content: [{ type: "text", text: url }],
    }),
    [url],
  );
  assert.deepEqual(messageTexts({ role: "bashExecution", output: url }), [url]);
  for (const value of [
    null,
    {},
    { role: "system", content: url },
    { role: "user", content: [{ type: "image", data: url }] },
  ]) {
    assert.deepEqual(messageTexts(value), []);
  }
});
