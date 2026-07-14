import type { SignalEvent, WorkerSnapshot, WorkerState } from "./types.js";

export class SignalLog {
  private readonly events: SignalEvent[] = [];
  private readonly snapshots = new Map<string, WorkerSnapshot>();

  append(event: SignalEvent): void { this.events.push(event); }
  eventsFor(workerId: string): SignalEvent[] { return this.events.filter((event) => event.workerId === workerId); }
  all(): SignalEvent[] { return [...this.events]; }

  setSnapshot(snapshot: WorkerSnapshot): void { this.snapshots.set(snapshot.id, { ...snapshot, fallbackTrail: [...snapshot.fallbackTrail], activeTools: [...snapshot.activeTools] }); }
  updateSnapshot(id: string, patch: Partial<WorkerSnapshot>): WorkerSnapshot {
    const current = this.snapshots.get(id);
    if (!current) throw new Error(`dteam: unknown worker ${id}`);
    const next = { ...current, ...patch, fallbackTrail: patch.fallbackTrail ?? current.fallbackTrail, activeTools: patch.activeTools ?? current.activeTools };
    this.snapshots.set(id, next);
    return next;
  }
  snapshot(id: string): WorkerSnapshot | undefined { const item = this.snapshots.get(id); return item ? { ...item, fallbackTrail: [...item.fallbackTrail], activeTools: [...item.activeTools] } : undefined; }
  snapshotsList(): WorkerSnapshot[] { return [...this.snapshots.values()].map((item) => ({ ...item, fallbackTrail: [...item.fallbackTrail], activeTools: [...item.activeTools] })); }
  setState(id: string, state: WorkerState): WorkerSnapshot { return this.updateSnapshot(id, { state }); }
}
