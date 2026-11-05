import { randomUUID } from 'node:crypto';
import type { CoreApi } from '../../../vendor/sdk/api/core';
import { identity } from '../../../vendor/sdk/server';
import type { CharacterSession, CharacterState } from '../../api/types';
import type { JobsPersistenceV1 } from '../../persistence/contract';
import { migrateState } from '../../persistence/state';
import { ensure, integer, object, snapshot, text } from '../../core/validation';
import type { CorePermissionsAdapterV1 } from '../../core/permissions';

export interface NativeCore extends CoreApi { getIdFromDesc(description: string): number }
export interface CharacterIdentityAdapterV1 {
  readonly apiVersion: 1;
  getSession(userId: number): CharacterSession | null;
  isCurrent(session: CharacterSession): boolean;
  invalidate?(userId: number): void;
}
/** Uses the existing Core saved FormDesc + profile. It never invents a Jobs character UUID. */
export class NativeRecordIdentity implements CharacterIdentityAdapterV1 {
  readonly apiVersion = 1 as const;
  private readonly bindings = new Map<number, CharacterSession>();
  constructor(private readonly mp: CoreApi) {}
  getSession(userId: number): CharacterSession | null {
    const native = identity(this.mp, userId);
    if (!native) { this.bindings.delete(userId); return null; }
    const characterId = `native:${native.profileId}:${native.record}`;
    const previous = this.bindings.get(userId);
    if (previous?.characterId === characterId && previous.actorId === native.actorId) return previous;
    const binding = snapshot({ characterId, accountId: `profile:${native.profileId}`, userId, actorId: native.actorId, sessionId: randomUUID() });
    this.bindings.set(userId, binding); return binding;
  }
  isCurrent(session: CharacterSession): boolean {
    const live = this.getSession(session.userId);
    return !!live && live.characterId === session.characterId && live.accountId === session.accountId && live.actorId === session.actorId && live.sessionId === session.sessionId;
  }
  invalidate(userId: number): void { this.bindings.delete(userId); }
}
export class NativeJobsPersistence implements JobsPersistenceV1 {
  readonly apiVersion = 1 as const;
  readonly mode = 'core-private-changeform';
  readonly durableCommitAcknowledged = false;
  static readonly property = 'private.skympJobs';
  constructor(private readonly mp: NativeCore) {
    ensure(typeof mp.getIdFromDesc === 'function' && typeof mp.getDescFromId === 'function' && typeof mp.get === 'function' && typeof mp.set === 'function', 'Native ChangeForm methods unavailable');
  }
  private target(character: string) {
    const match = /^native:(\d+):(.+)$/.exec(text(character, 256)); ensure(match, 'Native storage requires a native record identity');
    const profileId = integer(Number(match[1]), 0, 0x7fffffff), record = text(match[2], 160);
    const actorId = integer(this.mp.getIdFromDesc(record), 1, 0xffffffff);
    ensure(this.mp.getDescFromId(actorId) === record && this.mp.get(actorId, 'profileId') === profileId, 'Saved character ownership mismatch');
    return { actorId, profileId, record };
  }
  private decode(character: string, target: ReturnType<NativeJobsPersistence['target']>): CharacterState | null {
    const raw = this.mp.get(target.actorId, NativeJobsPersistence.property);
    if (raw === undefined || raw === null) return null;
    ensure(object(raw) && raw.formatVersion === 1 && raw.characterId === character && raw.profileId === target.profileId && raw.record === target.record, 'Invalid Jobs ChangeForm envelope');
    return migrateState(raw.state, character);
  }
  async load(character: string): Promise<unknown | null> { const target = this.target(character); return this.decode(character, target); }
  async compareAndSet(character: string, expectedRevision: number | null, next: CharacterState): Promise<void> {
    // No await between read/check/set: atomic against writers in this Node event loop.
    const target = this.target(character), previous = this.decode(character, target);
    ensure((previous?.revision ?? null) === expectedRevision, 'Jobs revision conflict');
    ensure(next.revision === (expectedRevision ?? 0) + 1, 'Invalid next revision');
    const state = migrateState(next, character);
    this.mp.set(target.actorId, NativeJobsPersistence.property, { formatVersion: 1, characterId: character, profileId: target.profileId, record: target.record, state });
  }
  async flush(): Promise<void> { /* Core exposes no durable commit acknowledgement. */ }
}
/** Reads the actual Core permissions service; does not replace its single resolver. */
export function nativeCorePermissions(identityAdapter: CharacterIdentityAdapterV1): CorePermissionsAdapterV1 {
  return { apiVersion: 1, async hasPermission(character, permission, session) {
    if (!session || session.characterId !== character || !identityAdapter.isCurrent(session)) return false;
    try { return globalThis.skympConsoleSecurity?.apiVersion === 1 && globalThis.skympConsoleSecurity.hasPermission(session.userId, permission) === true; }
    catch { return false; }
  } };
}
