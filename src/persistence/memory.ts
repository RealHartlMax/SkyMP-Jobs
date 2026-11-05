import type { CharacterState } from '../api/types';
import { ensure } from '../core/validation';
import type { JobsPersistenceV1 } from './contract';
import { migrateState } from './state';

/** Test/development only. Creating another instance loses all records. */
export class InMemoryJobsPersistence implements JobsPersistenceV1 {
  readonly apiVersion = 1 as const;
  readonly mode = 'memory-test-only';
  readonly durableCommitAcknowledged = false;
  private readonly records = new Map<string, CharacterState>();
  async load(character: string): Promise<unknown | null> { return structuredClone(this.records.get(character) ?? null); }
  async compareAndSet(character: string, expectedRevision: number | null, next: CharacterState): Promise<void> {
    const previous = this.records.get(character);
    ensure((previous?.revision ?? null) === expectedRevision, 'Jobs revision conflict');
    ensure(next.revision === (expectedRevision ?? 0) + 1, 'Invalid next revision');
    this.records.set(character, migrateState(next, character));
  }
  async flush(): Promise<void> { /* Memory is deliberately not durable. */ }
}
