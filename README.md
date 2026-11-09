# pi-pr-watch

**Show the PRs this Pi session is actually working on—not every PR it happens to mention.**

Observes successful GitHub CLI operations and attributable Git pushes, maintains a session-scoped watch list, and displays a compact widget below the editor. The plugin itself only performs read-only lookups; it never runs a mutation on your behalf.

```text
> …
─────────────────────────────────────────────────────
○ owner/backend#123 · 开放 · CI ✓ · 待审核
◆ owner/frontend#45 · 已合并
```

## Install

Requires Node.js 22+, the Earendil distribution of Pi (tested with **1.5.0**), Git, and authenticated GitHub CLI:

```sh
gh auth status
# If needed: gh auth login
pi install git:github.com/Coiggahou2002/pi-pr-watch
```

Run `/reload` in an existing session, or restart Pi. Try without installing with `pi -e git:github.com/Coiggahou2002/pi-pr-watch`.

### Upgrading from 0.2.x

The watch policy changed intentionally. Old links found in conversation text are **not** imported as active work. Your list may become empty after upgrading; add any PR you still want with `/prs watch <URL>`, or let a new qualifying operation enroll it. Icon preferences remain intact.

## What counts as active work?

| Evidence                                              | Enrollment                                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Successful `gh pr create`                             | Its unique PR URL from that command's output                                                        |
| Successful `gh pr checkout / edit / comment / review` | The PR resolved for that operation                                                                  |
| Successful `gh pr ready / reopen / merge / close`     | The PR resolved before the operation; terminal results remain visible                               |
| `gh pr checks --watch`                                | An explicitly watched PR, even when the checks exit with failure (code 1)                           |
| Successful `git push` with one attributable branch    | An unambiguous open PR whose **head repository and head branch** match the pushed repository/branch |
| `/prs watch <URL>`                                    | Explicit manual interest, including read-only monitoring                                            |

Mere URLs in chat, files, search results, examples, tool output, or summaries do **not** enroll PRs. Neither do `gh pr list`, `gh pr view`, single-shot checks, `checks --web`, help, dry runs, failed mutations, or cancelled/blocked calls. A CI-watching command is explicit interest, not a claim that its CI passed.

### Command observation, not shell interception

For the standard local `bash` tool, the plugin observes tool calls/results. For user `!` commands, it observes their start and reads new, stable session entry IDs until the matching shell result is recorded (Pi need not emit an agent `message_end` for user shell commands). `!!` commands excluded from context are not followed automatically.

It does **not** replace the shell tool, change PATH, install a global `gh` wrapper, rewrite argv, execute shell expansions, or retry mutations. Identity lookups before an operation are bounded to 10 seconds; lookup failures cannot block the original command. A successful operation that cannot be resolved may show a warning with the manual-watch fallback.

The accepted shell subset is deliberately conservative:

- A single, literal `gh pr …` or `git push …` command; quoted static arguments are supported.
- Static leading `cd path &&` chains, and `git -C path`.
- Known flags with **per-subcommand arity**: for example, `review -r` is boolean, while `create -r` consumes a reviewer. Explicit PR numbers, URLs, branches, and `--repo/-R` are resolved by `gh`.
- No pipelines, redirections, semicolons, trailing `&&` commands, `|| true`, substitutions, environment assignments, multiline commands, glob/brace expansion, aliases, absolute CLI paths, `gh api`, or unknown flags. Unprovable cases are skipped rather than guessed. Quoted multiline/brace-containing bodies are also conservatively skipped; a body file is a useful alternative.
- Overlapping observed bash-tool commands that could share a working directory invalidate context-dependent enrollment; use explicit manual watch if necessary. The command's own unique create URL remains attributable.
- Assumes standard local execution with a stable workspace. Custom remote shell backends and out-of-band branch/repository changes are not inferred; use `/prs watch` for those workflows.

### Git push identity

The resolver reads the local branch, Git's push-remote mapping, push URL, and relevant push configuration **before** the push. It supports ordinary `simple`, `current`, and `upstream` defaults, explicit single refspecs, and `-u origin HEAD[:branch]`. After success it queries the pushed repository, filters by head branch **and head repository**, and refuses ambiguous matches.

Mirror/matching/multi-ref pushes, deletions, multiple push URLs, unsupported refspec/configuration, and cross-fork PR base discovery are not inferred. For a fork workflow where the PR targets a different repository, explicitly watch its URL. A branch name alone is never treated as PR identity.

## Watch list and display

- Durable watch/unwatch events contain canonical PR URLs and a short reason (`manual`, `gh:edit`, `git:push`, etc.), not copied command bodies or credentials. They live in Pi custom session entries and follow the **active branch** across reload, resume, fork, and `/tree`.
- `/prs unwatch` removes a PR, including pending status responses. A later qualifying operation or explicit watch can enroll it again.
- Keeps the latest **20 distinct enrollments**, queries at most three concurrently, and refreshes every **60 seconds**. PR-status subprocesses have a 15-second timeout and bounded output.
- Shows at most three PR rows plus one summary row. Previously successful lookups have priority; failed first lookups collapse into “N 个链接未验证”. `/prs` exposes full URLs, errors, and last successful update times.
- Failed refreshes retain the prior status with **更新失败（旧状态）**. Missing permissions, authentication, rate limits, network errors, and malformed data never imply a closed PR or green CI.
- Unknown review decisions/check states stay unknown. The review field is GitHub's aggregate decision, not an unresolved-thread count. Neutral/skipped checks do not count as failures.
- No watch list means no widget and no polling queries. CLI identity lookups occur only for qualifying observed operations. Nothing runs outside TUI mode.
- Session/branch replacement cancels lookups, shell-result scanning, and polling. Late responses cannot enroll a PR in another session. Concurrent identical user shell commands are deliberately treated as ambiguous.

The widget has its own key and coexists with [`pi-current-task`](https://github.com/Coiggahou2002/pi-current-task) and Pi's standard footer. Long rows are terminal-column-aware. Labels are currently Chinese.

## Icons and clickable PR links

| State  | Color  | Unicode default | Nerd Fonts Octicon                 |
| ------ | ------ | --------------- | ---------------------------------- |
| Open   | Green  | `○`             | `git-pull-request` (U+F407)        |
| Merged | Purple | `◆`             | `git-merge` (U+F419)               |
| Closed | Red    | `×`             | `git-pull-request-closed` (U+F4DC) |
| Draft  | Gray   | `◌`             | `git-pull-request-draft` (U+F4DD)  |

Colors adapt to light/dark themes; text labels remain alongside icons. `auto` defaults to compatible Unicode symbols because terminals cannot reliably report font glyph coverage. For GitHub-style glyphs, select a current **Nerd Font Mono** in your terminal, then run `/prs icons nerd`. If they appear as boxes, use `/prs icons unicode`. Codepoints follow [Nerd Fonts' Octicons mapping](https://github.com/ryanoasis/nerd-fonts/blob/master/glyphnames.json).

Icon overrides persist in the current session/branch. For a default across new sessions, use `PI_PR_WATCH_ICONS=nerd pi` (or `auto`/`unicode`); a saved preference takes precedence.

**The icon and PR name are OSC 8 hyperlinks**, including truncated names. Fullscreen Pi opens them with a normal left click through its existing system-browser opener. In regular mode your terminal may require Cmd/Ctrl-click. Unsupported terminals may show plain text; `/prs` always provides the full URL. Hovering does not open anything.

## Commands

| Command                                   | Action                                                  |
| ----------------------------------------- | ------------------------------------------------------- |
| `/prs`                                    | Full text snapshot; edits to the snapshot are discarded |
| `/prs watch <URL>`                        | Explicitly follow a PR                                  |
| `/prs unwatch <URL or owner/repo#number>` | Stop following a tracked PR                             |
| `/prs refresh`                            | Refresh now; simultaneous refreshes are coalesced       |
| `/prs hide` / `/prs show`                 | Hide/show the widget; hidden PRs still refresh          |
| `/prs icons auto\|nerd\|unicode`          | Set icon mode; omit the value to inspect it             |
| `/prs help`                               | Command help                                            |

Visibility resets to shown on session start. Status caches are in memory and are re-queried after restart. Merged/closed PRs remain until unwatch or eviction by the tracking limit.

## Security and limitations

- Automatic API calls are read-only `gh pr view` and `gh pr list`, plus read-only local Git metadata commands. Mutations are only commands **you or the agent already chose to run**. No automatic comments, labels, merges, remediation, or Git writes.
- Uses existing `gh` credentials, without reading/storing tokens. No model calls, context injection, telemetry, daemon, or new external service. Original commands remain subject to Pi's normal session recording; the plugin does not duplicate their bodies into activity records.
- Only **github.com** identities are supported. Enterprise/custom hosts and bare `#123` manual references are not supported.
- Session entries follow normal Pi durability: a brand-new empty session is not written to disk until a conversation message exists, and `--no-session` is not durable.
- Extensions run with your user permissions. Review source before installing. Other Pi distributions have not been verified.

## Development

```sh
npm ci
npm run check
npm test
pi -e ./extensions/pr-watch/index.ts
```

Strict TypeScript. Tests cross the real Pi loader/event/session boundary and real Git metadata; fixture CLI subprocesses verify that the plugin issues only read-only queries. They cover activity-vs-mention policy, exit codes, implicit identity, shell ambiguity, fork collisions, watch/unwatch persistence, stale requests, icons, layout and mouse-link dispatch. CI runs Node.js 22/24.

Real Pi + GitHub smoke test: a historical URL and `!gh pr view` do not enroll; `!gh pr checks --watch` does; unwatch survives reload and explicit watch restores the widget. Previous UI checks also covered regular/fullscreen layouts, narrow terminals, coexistence with `pi-current-task`, icon switching and browser-launch dispatch (with the launcher intercepted, not an actual browser window).

## Uninstall

`pi remove git:github.com/Coiggahou2002/pi-pr-watch`, then `/reload` or restart Pi. Historical custom entries remain in their sessions but are no longer acted on.

## License

MIT
