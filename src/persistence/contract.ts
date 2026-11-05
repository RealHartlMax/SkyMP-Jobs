import type { CharacterId, CharacterState } from '../api/types';

/** Host-owned namespace, no account/character creation. CAS must be atomic per character. */
export interface JobsPersistenceV1 {
  readonly apiVersion: 1;
  readonly mode: string;
  readonly durableCommitAcknowledged: boolean;
  load(character: CharacterId): Promise<unknown | null>;
  compareAndSet(character: CharacterId, expectedRevision: number | null, next: CharacterState): Promise<void>;
  flush(): Promise<void>;
}
