import type { Theme } from "@earendil-works/pi-coding-agent";
import {
  stripTerminalSequences,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { PrRow } from "./watcher.ts";

const MAX_WIDGET_ROWS = 3;
const CHECK_LABELS = {
  passing: "CI ✓",
  failing: "CI ✗",
  pending: "CI 等待",
  none: "无 CI",
  unknown: "CI 未知",
};
const REVIEW_LABELS = {
  approved: "已批准",
  changes: "需修改",
  required: "待审核",
  unknown: "审核未知",
};

export function statusText(row: PrRow): string {
  let text: string;
  if (!row.status) text = row.error ? "查询失败" : "查询中";
  else if (row.status.state === "MERGED") text = "已合并";
  else if (row.status.state === "CLOSED") text = "已关闭";
  else
    text = `${row.status.draft ? "草稿" : "开放"} · ${CHECK_LABELS[row.status.checks]} · ${REVIEW_LABELS[row.status.review]}`;
  return row.status && row.error ? `${text} · 更新失败（旧状态）` : text;
}

export function renderPrs(
  rows: readonly PrRow[],
  width: number,
  theme: Pick<Theme, "fg">,
): string[] {
  if (width <= 0) return [];
  const lines = rows.slice(0, MAX_WIDGET_ROWS).map((row) => {
    const label = truncateToWidth(
      row.pr.key,
      Math.max(1, Math.floor(width * 0.45)),
      "…",
    );
    const color =
      row.error || row.status?.checks === "failing"
        ? "warning"
        : row.status?.state === "MERGED"
          ? "success"
          : "muted";
    return truncateToWidth(
      theme.fg("accent", label) + theme.fg(color, ` · ${statusText(row)}`),
      width,
      "…",
    );
  });
  if (rows.length > MAX_WIDGET_ROWS)
    lines.push(
      truncateToWidth(
        theme.fg(
          "dim",
          `另有 ${rows.length - MAX_WIDGET_ROWS} 个 PR · /prs 查看全部`,
        ),
        width,
        "…",
      ),
    );
  return lines;
}

export function detailsText(rows: readonly PrRow[]): string {
  return rows
    .map((row) => {
      const error = row.error
        ? `\n${stripTerminalSequences(row.error).replace(/\p{Cc}/gu, " ")}`
        : "";
      const updated =
        row.updatedAt === undefined
          ? "尚未成功查询"
          : `更新于 ${new Date(row.updatedAt).toISOString()}`;
      return `${row.pr.key} · ${statusText(row)}\n${row.pr.url}\n${updated}${error}`;
    })
    .join("\n\n");
}
