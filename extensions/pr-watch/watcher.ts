import type { PullRequestClient, PrStatus } from "./github.ts";
import type { PullRequest } from "./links.ts";

export const MAX_TRACKED_PRS = 20;
const REFRESH_INTERVAL_MS = 60000;
const QUERY_CONCURRENCY = 3;

export interface PrRow {
  readonly pr: PullRequest;
  readonly status?: PrStatus;
  readonly error?: string;
  readonly updatedAt?: number;
}

export class PrWatcher {
  private readonly rows = new Map<string, PrRow>();
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setInterval> | undefined;
  private inFlight: Promise<void> | undefined;
  private again = false;

  constructor(
    private readonly client: PullRequestClient,
    private readonly changed: () => void,
  ) {}

  get snapshot(): PrRow[] {
    return [...this.rows.values()].reverse();
  }

  add(prs: readonly PullRequest[]): boolean {
    if (this.controller.signal.aborted) return false;
    let added = false;
    for (const pr of prs) {
      if (this.rows.has(pr.key)) continue;
      this.rows.set(pr.key, { pr });
      added = true;
      while (this.rows.size > MAX_TRACKED_PRS) {
        const oldest = this.rows.keys().next().value;
        if (oldest !== undefined) this.rows.delete(oldest);
      }
    }
    if (added) this.changed();
    return added;
  }

  startPolling(intervalMs = REFRESH_INTERVAL_MS): void {
    if (this.timer || this.controller.signal.aborted) return;
    this.timer = setInterval(() => {
      void this.refresh();
    }, intervalMs);
    this.timer.unref();
  }

  refresh(): Promise<void> {
    if (this.controller.signal.aborted || !this.rows.size)
      return Promise.resolve();
    if (this.inFlight) {
      this.again = true;
      return this.inFlight;
    }
    const run = this.runRefresh();
    this.inFlight = run;
    void run.finally(() => {
      this.inFlight = undefined;
      if (this.again && !this.controller.signal.aborted) {
        this.again = false;
        void this.refresh();
      }
    });
    return run;
  }

  private async runRefresh(): Promise<void> {
    const work = this.snapshot;
    let index = 0;
    const worker = async (): Promise<void> => {
      while (!this.controller.signal.aborted) {
        const row = work[index++];
        if (!row) return;
        let next: PrRow;
        try {
          const status = await this.client.fetch(
            row.pr,
            this.controller.signal,
          );
          next = { pr: row.pr, status, updatedAt: Date.now() };
        } catch (error) {
          next = {
            ...row,
            error: error instanceof Error ? error.message : String(error),
          };
        }
        if (
          !this.controller.signal.aborted &&
          this.rows.get(row.pr.key) === row
        ) {
          this.rows.set(row.pr.key, next);
          this.changed();
        }
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(QUERY_CONCURRENCY, work.length) }, worker),
    );
  }

  dispose(): void {
    this.controller.abort();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
