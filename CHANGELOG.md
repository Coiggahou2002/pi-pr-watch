# Changelog

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
