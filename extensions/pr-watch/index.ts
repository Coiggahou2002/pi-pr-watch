import {
  isToolCallEventType,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { GhPullRequestClient } from "./github.ts";
import { extractPullRequests, type PullRequest } from "./links.ts";
import { ActivityObserver, GhActivityResolver } from "./activity.ts";
import { TRACKING_ENTRY, restoreTrackedPrs } from "./tracking.ts";
import { UserBashScanner } from "./user-bash.ts";
import { PrWatcher } from "./watcher.ts";
import { detailsText, renderPrs } from "./widget.ts";
import {
  ICON_PREFERENCE_ENTRY,
  parseIconMode,
  parseIconPreference,
  type IconMode,
} from "./icons.ts";

const WIDGET_KEY = "pi-pr-watch";
const HELP =
  "/prs 查看全部；/prs watch <URL> 关注；/prs unwatch <URL或owner/repo#编号> 取消；refresh 刷新；hide/show 隐藏/显示；icons auto|nerd|unicode 切换图标。";

export default function prWatch(pi: ExtensionAPI): void {
  let watcher: PrWatcher | undefined;
  let visible = true;
  let iconMode: IconMode = "auto";
  let observer: ActivityObserver | undefined;
  let userScanner: UserBashScanner | undefined;

  function follow(prs: PullRequest[], reason: string): void {
    if (!watcher) return;
    const known = new Set(watcher.snapshot.map((row) => row.pr.key));
    const added = prs.filter((pr) => !known.has(pr.key));
    if (added.length) {
      pi.appendEntry(TRACKING_ENTRY, {
        version: 1,
        action: "watch",
        urls: added.map((pr) => pr.url),
        reason,
      });
      watcher.add(added);
    }
    void watcher.refresh();
  }

  function render(ctx: ExtensionContext): void {
    if (ctx.mode !== "tui") return;
    const rows = watcher?.snapshot ?? [];
    if (!visible || rows.length === 0) {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
      return;
    }
    ctx.ui.setWidget(
      WIDGET_KEY,
      (_tui, theme) => ({
        render: (width) =>
          renderPrs(watcher?.snapshot ?? [], width, theme, iconMode),
        invalidate() {},
      }),
      { placement: "belowEditor" },
    );
  }

  function restore(ctx: ExtensionContext): void {
    userScanner?.dispose();
    userScanner = undefined;
    observer?.dispose();
    observer = undefined;
    watcher?.dispose();
    watcher = undefined;
    if (ctx.mode !== "tui") return;
    ctx.ui.setWidget(WIDGET_KEY, undefined);
    const branch = ctx.sessionManager.getBranch();
    let savedMode: IconMode | undefined;
    for (let index = branch.length - 1; index >= 0; index--) {
      const entry = branch[index];
      if (
        entry?.type === "custom" &&
        entry.customType === ICON_PREFERENCE_ENTRY
      ) {
        savedMode = parseIconPreference(entry.data);
        break;
      }
    }
    iconMode =
      savedMode ?? parseIconMode(process.env.PI_PR_WATCH_ICONS ?? "auto");
    watcher = new PrWatcher(new GhPullRequestClient(pi.exec, ctx.cwd), () =>
      render(ctx),
    );
    observer = new ActivityObserver(
      new GhActivityResolver(pi.exec),
      (prs, reason) => follow(prs, reason),
      (error) =>
        ctx.ui.notify(
          `PR 自动识别未完成：${error instanceof Error ? error.message : String(error)}`,
          "warning",
        ),
    );
    userScanner = new UserBashScanner(observer, () =>
      ctx.sessionManager.getBranch(),
    );
    watcher.add(restoreTrackedPrs(branch));
    render(ctx);
    watcher.startPolling();
    void watcher.refresh();
  }

  pi.on("session_start", (_event, ctx) => {
    visible = true;
    restore(ctx);
  });
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("tool_call", async (event, ctx) => {
    if (isToolCallEventType("bash", event))
      await observer?.before(
        event.toolCallId,
        event.input.command,
        ctx.cwd,
        ctx.signal,
        true,
      );
  });
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "bash") return;
    const data = event.structuredContent;
    const code =
      typeof data === "object" &&
      data !== null &&
      "exit_code" in data &&
      typeof data.exit_code === "number"
        ? data.exit_code
        : event.isError
          ? undefined
          : 0;
    const truncated =
      typeof data === "object" &&
      data !== null &&
      "truncated" in data &&
      data.truncated === true;
    const output = event.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    await observer?.after(event.toolCallId, code, output, truncated);
  });
  pi.on("tool_execution_end", (event) => {
    observer?.cancel(event.toolCallId);
  });
  pi.on("user_bash", async (event, ctx) => {
    if (!event.excludeFromContext)
      await userScanner?.before(event.command, event.cwd, ctx.signal);
  });
  pi.on("message_end", async (event) => {
    if (event.message.role === "bashExecution") await userScanner?.scan();
  });
  pi.on("session_shutdown", (_event, ctx) => {
    userScanner?.dispose();
    userScanner = undefined;
    observer?.dispose();
    observer = undefined;
    watcher?.dispose();
    watcher = undefined;
    if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
  });

  pi.registerCommand("prs", {
    description:
      "当前关注的 PR；watch / unwatch / refresh / hide / show / icons",
    getArgumentCompletions(prefix) {
      const items = [
        "watch ",
        "unwatch ",
        "refresh",
        "hide",
        "show",
        "help",
        "icons",
        "icons auto",
        "icons nerd",
        "icons unicode",
      ]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    async handler(args, ctx) {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("PR widget 仅在 TUI 模式运行。", "info");
        return;
      }
      const text = args.trim();
      const watchCommand = /^(watch|unwatch)\s+(.+)$/u.exec(text);
      if (watchCommand) {
        try {
          const target = watchCommand[2]?.trim() ?? "";
          if (watchCommand[1] === "watch") {
            const prs = extractPullRequests(target);
            if (prs.length !== 1 || /\s/u.test(target))
              throw new Error("请提供一个完整的 GitHub PR URL。");
            follow(prs, "manual");
          } else {
            const key =
              extractPullRequests(target)[0]?.key ?? target.toLowerCase();
            const row = watcher?.snapshot.find((row) => row.pr.key === key);
            if (!row) throw new Error("此 PR 不在当前关注列表中。");
            pi.appendEntry(TRACKING_ENTRY, {
              version: 1,
              action: "unwatch",
              urls: [row.pr.url],
              reason: "manual",
            });
            observer?.unwatch(key);
            watcher?.remove(key);
          }
        } catch (error) {
          ctx.ui.notify(
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
        return;
      }
      if (/^icons(?:\s|$)/u.test(text)) {
        const value = text.slice("icons".length).trim();
        if (!value) {
          ctx.ui.notify(
            `图标模式：${iconMode}。auto 使用兼容符号；nerd 需要 Nerd Font。`,
            "info",
          );
          return;
        }
        try {
          const mode = parseIconMode(value);
          pi.appendEntry(ICON_PREFERENCE_ENTRY, { version: 1, mode });
          iconMode = mode;
          render(ctx);
          ctx.ui.notify(
            mode === "nerd"
              ? "已启用 Nerd Font 图标；若显示方框，请切换终端字体或使用 /prs icons unicode。"
              : "已启用兼容 Unicode 图标。",
            "info",
          );
        } catch (error) {
          ctx.ui.notify(
            error instanceof Error ? error.message : String(error),
            "error",
          );
        }
        return;
      }
      switch (text) {
        case "hide":
          visible = false;
          render(ctx);
          return;
        case "show":
          visible = true;
          render(ctx);
          return;
        case "refresh":
          await watcher?.refresh();
          return;
        case "": {
          const rows = watcher?.snapshot ?? [];
          const text = rows.length
            ? detailsText(rows)
            : "当前没有关注的 PR。成功的 gh 操作会自动加入，也可使用 /prs watch <URL>。";
          await ctx.ui.editor("会话 PR 状态（修改不保存）", text);
          return;
        }
        default:
          ctx.ui.notify(HELP, "info");
      }
    },
  });
}
