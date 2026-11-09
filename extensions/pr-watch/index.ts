import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { GhPullRequestClient } from "./github.ts";
import { extractPullRequests, messageTexts } from "./links.ts";
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
  "/prs 查看全部；/prs refresh 刷新；/prs hide 隐藏；/prs show 显示；/prs icons auto|nerd|unicode 切换图标。";

export default function prWatch(pi: ExtensionAPI): void {
  let watcher: PrWatcher | undefined;
  let visible = true;
  let iconMode: IconMode = "auto";

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
    const texts: string[] = [];
    for (const entry of branch) {
      if (entry.type === "message") texts.push(...messageTexts(entry.message));
      else if (entry.type === "custom_message")
        texts.push(...messageTexts({ role: "custom", content: entry.content }));
      else if (entry.type === "compaction" || entry.type === "branch_summary")
        texts.push(entry.summary);
    }
    watcher.add(texts.flatMap(extractPullRequests));
    render(ctx);
    watcher.startPolling();
    void watcher.refresh();
  }

  pi.on("session_start", (_event, ctx) => {
    visible = true;
    restore(ctx);
  });
  pi.on("session_tree", (_event, ctx) => restore(ctx));
  pi.on("message_end", (event, ctx) => {
    if (watcher?.add(messageTexts(event.message).flatMap(extractPullRequests)))
      void watcher.refresh();
    render(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    watcher?.dispose();
    watcher = undefined;
    if (ctx.mode === "tui") ctx.ui.setWidget(WIDGET_KEY, undefined);
  });

  pi.registerCommand("prs", {
    description: "会话内 PR 状态；refresh / hide / show / icons",
    getArgumentCompletions(prefix) {
      const items = [
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
            : "当前会话尚未发现 GitHub PR 链接。";
          await ctx.ui.editor("会话 PR 状态（修改不保存）", text);
          return;
        }
        default:
          ctx.ui.notify(HELP, "info");
      }
    },
  });
}
