import { createHash } from 'node:crypto';
import type { CharacterSession, DutyLog } from '../../api/types';
import { ensure, snapshot } from '../validation';

export interface DutyEntry { characterId: string; jobId: string; session: CharacterSession; started: number; creditedUntil: number; sequence: number; endedAt?: number; endReason?: DutyLog['reason'] }
/** Runtime-only service: an old persisted record can never resume duty after restart. */
export class DutyTracker {
  readonly entries = new Map<string, Map<string, DutyEntry>>();
  constructor(readonly maxConcurrent: number, readonly maxGapMs: number, private readonly monotonic: () => number) {}
  get(character: string, jobId: string): DutyEntry | null { return this.entries.get(character)?.get(jobId) ?? null; }
  start(session: CharacterSession, jobId: string): void {
    const entries = this.entries.get(session.characterId) ?? new Map<string, DutyEntry>();
    if (entries.has(jobId)) return;
    ensure(entries.size < this.maxConcurrent, 'Concurrent duty limit reached');
    const now = this.monotonic();
    entries.set(jobId, { characterId: session.characterId, jobId, session: snapshot(session), started: now, creditedUntil: now, sequence: 0 });
    this.entries.set(session.characterId, entries);
  }
  elapsed(entry: DutyEntry, end = this.monotonic()): number { return Math.floor(Math.max(0, Math.min(end - entry.creditedUntil, this.maxGapMs))); }
  remove(character: string, jobId: string): void { const entries = this.entries.get(character); entries?.delete(jobId); if (!entries?.size) this.entries.delete(character); }
  log(entry: DutyEntry, reason: DutyLog['reason'], at: number, end = this.monotonic()): DutyLog {
    return { id: createHash('sha256').update(JSON.stringify([entry.session.sessionId, entry.jobId, entry.sequence])).digest('hex'), sessionId: entry.session.sessionId,
      jobId: entry.jobId, milliseconds: this.elapsed(entry, end), reason, at };
  }
}
