import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ActivityObserver } from "./activity.ts";

const USER_RESULT_POLL_MS = 250;

/** User ! commands are persisted directly by Pi and need not emit agent message_end. */
export class UserBashScanner {
  private readonly seen = new Set<string>();
  private readonly pending = new Map<
    string,
    { id: string; remaining: number; ambiguous: boolean }
  >();
  private timer: ReturnType<typeof setInterval> | undefined;
  private nextId = 0;
  private stopped = false;
  private scanning = false;

  constructor(
    private readonly observer: ActivityObserver,
    private readonly branch: () => readonly SessionEntry[],
  ) {
    for (const entry of branch()) this.seen.add(entry.id);
  }

  async before(
    command: string,
    cwd: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (this.stopped) return;
    await this.scan();
    const previous = this.pending.get(command);
    if (previous) {
      previous.remaining++;
      previous.ambiguous = true;
      this.observer.cancel(previous.id);
      return;
    }
    const pending = {
      id: `user:${++this.nextId}`,
      remaining: 1,
      ambiguous: false,
    };
    this.pending.set(command, pending);
    const found = await this.observer.before(pending.id, command, cwd, signal);
    if (!found && !pending.ambiguous && this.pending.get(command) === pending)
      this.pending.delete(command);
    if (this.pending.size && !this.timer && !this.stopped) {
      this.timer = setInterval(() => {
        void this.scan();
      }, USER_RESULT_POLL_MS);
      this.timer.unref();
    }
  }

  async scan(): Promise<void> {
    if (this.stopped || this.scanning) return;
    this.scanning = true;
    try {
      for (const entry of this.branch()) {
        if (this.stopped) return;
        if (this.seen.has(entry.id)) continue;
        this.seen.add(entry.id);
        if (
          entry.type !== "message" ||
          entry.message.role !== "bashExecution" ||
          entry.message.excludeFromContext
        )
          continue;
        const message = entry.message;
        const pending = this.pending.get(message.command);
        if (!pending) continue;
        pending.remaining--;
        if (pending.remaining === 0) this.pending.delete(message.command);
        if (!pending.ambiguous)
          await this.observer.after(
            pending.id,
            message.cancelled ? undefined : message.exitCode,
            message.output,
            message.truncated,
          );
      }
    } finally {
      this.scanning = false;
      if (!this.pending.size && this.timer) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    }
  }

  dispose(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    for (const pending of this.pending.values())
      this.observer.cancel(pending.id);
    this.pending.clear();
  }
}
