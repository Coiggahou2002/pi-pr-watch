# pi-pr-watch

**Follow the GitHub PRs mentioned in your Pi conversation—not just the current branch.**

Automatically finds PR URLs in the active session, queries their state through GitHub CLI, and shows a compact widget below the input editor. No prompt, model tool call, or manual tracking command is required.

```text
> …
─────────────────────────────────────────────────────
owner/backend#123 · 开放 · CI ✓ · 待审核
owner/frontend#45 · 已合并
```

## Install

Requires Node.js 22+, the Earendil distribution of Pi (tested with **1.5.0**), and an authenticated GitHub CLI:

```sh
gh auth status
# If needed: gh auth login
pi install git:github.com/Coiggahou2002/pi-pr-watch
```

Run `/reload` in an existing Pi session, or restart Pi. Existing PR links in that session are discovered automatically. Compatibility with other Pi distributions has not been verified.

Try without installing:

```sh
pi -e git:github.com/Coiggahou2002/pi-pr-watch
```

## Behavior

- Finds full `github.com/OWNER/REPO/pull/NUMBER` URLs in finalized user/assistant text, tool results (including `gh pr create` output), and user shell output. Markdown links, `/files`, query strings, and fragments are normalized and deduplicated.
- Restores from the **active session branch**, including old messages and compaction/branch summaries; it does not scan other sessions or infer a PR from the current Git branch.
- A newly discovered PR is queried immediately, independently of the agent. Existing PRs refresh every **60 seconds** while the session remains open.
- Shows open/draft/merged/closed state, combined CI state, and GitHub's aggregate review decision. An empty review decision is **审核未知**, not an invented approval or required review.
- Queries at most three PRs concurrently, with a 15-second subprocess timeout and bounded output.
- Keeps the **20 most recently discovered distinct PRs**. Shows the newest three in the widget, plus an overflow count; `/prs` shows all tracked PRs and full URLs.
- With no links, shows no widget and makes no GitHub calls. There are no background queries outside TUI mode.
- Cancels the old watcher on reload, session shutdown/replacement, or `/tree`. Late results cannot update another session/branch, even if cancellation is ignored.

The widget uses its own key and coexists with [`pi-current-task`](https://github.com/Coiggahou2002/pi-current-task) and the standard Pi footer. Labels are currently Chinese. Long rows use terminal-column-aware truncation.

## Commands

| Command        | Action                                                                                                                        |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `/prs`         | Open a full text snapshot with statuses, URLs, last successful update time, and errors. Edits to this snapshot are discarded. |
| `/prs refresh` | Request a refresh now; simultaneous requests are coalesced.                                                                   |
| `/prs hide`    | Hide the widget without stopping tracking or polling.                                                                         |
| `/prs show`    | Show the widget.                                                                                                              |
| `/prs help`    | Show command help.                                                                                                            |

Visibility resets to shown on a new/resumed/reloaded session. Tracking is reconstructed from conversation history, not a separate database. Status caches are in memory and are queried again after restart. Old merged/closed PRs remain visible until they fall out of the 20-PR tracking limit.

## Failure handling

Missing `gh`, missing authentication, insufficient repository/check permissions, rate limits, malformed responses, timeouts, and network failures are shown as **查询失败**, never “closed” or “no CI”. Use `/prs` for details. If a refresh fails after a success, the previous status stays visible with **更新失败（旧状态）** until a refresh succeeds.

“No CI” means no effective reported checks (neutral/skipped checks do not count as failures). Unknown or unsupported check states are reported as unknown rather than green. A CI failure is not a claim about mergeability. The review field is GitHub's aggregate decision, not a count of unresolved threads or a list of reviewers.

## Security and privacy

- **Read-only:** only `gh pr view URL --json state,isDraft,reviewDecision,statusCheckRollup`. No comments, labels, merges, webhooks, automatic remediation, or Git writes.
- Uses `gh`'s existing authentication. Does not read/store tokens or install a separate credential store.
- No model calls, context injection, telemetry, daemon, or additional service. It sends only discovered canonical PR URLs to GitHub through `gh`; conversation bodies are not uploaded.
- Does not parse system prompts, hidden reasoning, tool arguments, images, or arbitrary tool metadata. It scans visible text, so links in quoted examples or file-reading output can also be discovered.
- Restricts automatic queries to **github.com**. Enterprise/custom hosts, bare `#123`, and `owner/repo#123` references are not supported in this first version.
- Pi extensions run with your user permissions. Review the code before installing.

## Development

```sh
git clone https://github.com/Coiggahou2002/pi-pr-watch.git
cd pi-pr-watch
npm ci
npm run check
npm test
pi -e ./extensions/pr-watch/index.ts
```

Strict TypeScript; tests cover URL discovery, untrusted CLI output validation, both GitHub check formats, query errors, concurrency, stale responses, tracking limits, terminal widths, and lifecycle integration through Pi's real loader and a fixture `gh` subprocess. CI runs Node.js 22 and 24.

Real GitHub/TUI smoke-tested with open and merged public PRs, in fullscreen (100 columns) and regular (40 columns) modes, alongside `pi-current-task`, including hide/show behavior.

This repository contains one plugin. Other personal plugins live in sibling repositories.

## Uninstall

```sh
pi remove git:github.com/Coiggahou2002/pi-pr-watch
```

Run `/reload` or restart Pi.

## License

MIT
