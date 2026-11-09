# Changelog

## 0.3.0

- Replace mention-based discovery with successful gh PR operations, explicit CI watching, and attributable git pushes. Old incidental links are intentionally not imported.
- Resolve implicit identities before branch-changing operations and validate push head repository/branch identity without choosing ambiguous matches.
- Add conservative static shell analysis with per-subcommand flag arity; unsupported commands are left unchanged and not guessed.
- Add `/prs watch` and `/prs unwatch`, persisted as branch-aware session activity events.
- Observe user `!` completion through stable session entries, without replacing the shell backend; exclude private `!!` commands.
- Fence stale/overlapping command lookups and keep icon preferences, hyperlinks, status polling, and error details.

## 0.2.1

- Prioritize previously verified PRs over pending links in the widget.
- Fold failed first lookups into one unverified-link notice, instead of letting test examples and inaccessible repositories crowd out real PRs.
- Preserve full error details in `/prs`, retries, and explicit stale markers for previously successful queries.

## 0.2.0

- Add distinct Open, Merged, Closed, and Draft icons, with green/purple/red/gray colors in light and dark themes.
- Add safe Unicode defaults and optional Nerd Fonts Octicons via `/prs icons auto|nerd|unicode` or `PI_PR_WATCH_ICONS`.
- Persist icon overrides in the session and restore the active branch's preference.
- Make PR icons and names real OSC 8 links to canonical GitHub PR URLs, including truncated labels.
- Verify fullscreen mouse clicks reach the platform browser launcher with the correct PR URL.

## 0.1.0

- Discover GitHub PR links from active-branch conversation text and tool output.
- Query PR state, checks, and review decisions automatically through read-only GitHub CLI calls.
- Show a bounded widget below the editor, with `/prs` details, refresh, hide, and show.
- Refresh every minute, preserve stale statuses explicitly on errors, and cancel work on session/branch changes.
