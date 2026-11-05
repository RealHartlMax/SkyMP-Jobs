import type { CharacterState } from '../api/types';
import { characterId, ensure, snapshot } from '../core/validation';
import type { JobsPersistenceV1 } from './contract';
import { emptyState, migrateState } from './state';

/** Shared per-character queue; failed operations never poison subsequent operations. */
export class CharacterRepository {
  private readonly pending = new Map<string, Promise<unknown>>();
  constructor(readonly store: JobsPersistenceV1) {
    ensure(store.apiVersion === 1 && typeof store.load === 'function' && typeof store.compareAndSet === 'function' && typeof store.flush === 'function', 'Persistence API v1 required');
  }
  run<T>(character: string, work: () => Promise<T>): Promise<T> {
    characterId(character);
    const previous = this.pending.get(character) ?? Promise.resolve();
    const result = previous.catch(() => {}).then(work);
    this.pending.set(character, result);
    const release = () => { if (this.pending.get(character) === result) this.pending.delete(character); };
    void result.then(release, release); return result;
  }
  async read(character: string): Promise<CharacterState> {
    characterId(character);
    const raw = await this.store.load(character);
    return snapshot(raw === null ? emptyState(character) : migrateState(raw, character));
  }
  /** Caller holds run(character). Re-read each time so another host writer cannot be overwritten. */
  async mutate<T>(character: string, change: (draft: CharacterState) => T | Promise<T>, beforeSave: () => void = () => {}): Promise<{ value: T; state: CharacterState }> {
    const raw = await this.store.load(character), previous = raw === null ? emptyState(character) : migrateState(raw, character);
    const draft = structuredClone(previous), value = await change(draft);
    draft.revision = previous.revision + 1;
    migrateState(draft, character);
    beforeSave();
    await this.store.compareAndSet(character, raw === null ? null : previous.revision, draft);
    return { value, state: snapshot(draft) };
  }
  async drain(): Promise<void> { await Promise.allSettled([...this.pending.values()]); await this.store.flush(); }
}
