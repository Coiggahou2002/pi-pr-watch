import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { GhPullRequestClient } from "./github.ts";
import { extractPullRequests, messageTexts } from "./links.ts";
import { PrWatcher } from "./watcher.ts";
import { detailsText, renderPrs } from "./widget.ts";

const WIDGET_KEY = "pi-pr-watch";
const HELP =
  "/prs 查看全部；/prs refresh 刷新；/prs hide 隐藏；/prs show 显示。";

export default function prWatch(pi: ExtensionAPI): void {
  let watcher: PrWatcher | undefined;
  let visible = true;

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
        render: (width) => renderPrs(watcher?.snapshot ?? [], width, theme),
        invalidate() {},
      }),
      { placement: "belowEditor" },
    );
  }

  function restore(ctx: ExtensionContext): void {
    watcher?.dispose();
    watcher = undefined;
    if (ctx.mode !== "tui") return;
    watcher = new PrWatcher(new GhPullRequestClient(pi.exec, ctx.cwd), () =>
      render(ctx),
    );
    const texts: string[] = [];
    for (const entry of ctx.sessionManager.getBranch()) {
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
    description: "会话内 PR 状态；refresh / hide / show",
    getArgumentCompletions(prefix) {
      const items = ["refresh", "hide", "show", "help"]
        .filter((value) => value.startsWith(prefix))
        .map((value) => ({ value, label: value }));
      return items.length ? items : null;
    },
    async handler(args, ctx) {
      if (ctx.mode !== "tui") {
        if (ctx.hasUI) ctx.ui.notify("PR widget 仅在 TUI 模式运行。", "info");
        return;
      }
      switch (args.trim()) {
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
