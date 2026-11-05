import type { CharacterState } from '../api/types';
import { characterId, ensure, id, integer, object, text } from '../core/validation';

export const RECEIPT_LIMIT = 4096;
export const PAYMENT_LIMIT = 2048;
export const DUTY_LOG_LIMIT = 256;
export function emptyState(character: string): CharacterState {
  return { schemaVersion: 2, characterId: characterId(character), revision: 0, jobs: [], professions: [], primaryJobId: null,
    experienceReceipts: [], payments: [], dutyLog: [] };
}
/** V1 is the documented pre-ledger format. Never reset unknown/corrupt data. */
export function migrateState(value: unknown, expectedCharacter: string): CharacterState {
  ensure(object(value) && [1, 2].includes(value.schemaVersion as number), 'Unsupported Jobs state schema');
  ensure(value.characterId === characterId(expectedCharacter), 'Character state identity mismatch');
  integer(value.revision);
  ensure(Array.isArray(value.jobs) && value.jobs.length <= 64 && Array.isArray(value.professions) && value.professions.length <= 256, 'Invalid memberships');
  const unique = (items: unknown[], key: string) => {
    const keys = items.map(i => { ensure(object(i), 'Invalid record'); return id(i[key]); });
    ensure(new Set(keys).size === keys.length, 'Duplicate state record');
  };
  unique(value.jobs, 'jobId'); unique(value.professions, 'professionId');
  for (const m of value.jobs) {
    id(m.owner); integer(m.definitionVersion, 1); id(m.gradeId); integer(m.assignedAt); integer(m.totalDutyMs);
    if (m.specializationId !== undefined) id(m.specializationId);
  }
  for (const p of value.professions) { id(p.owner); integer(p.definitionVersion, 1); integer(p.experience); integer(p.learnedAt); }
  ensure(value.primaryJobId === null || value.jobs.some(m => m.jobId === value.primaryJobId), 'Invalid primary job');
  const state = structuredClone(value.schemaVersion === 1 ? { ...value, schemaVersion: 2, experienceReceipts: [], payments: [], dutyLog: [] } : value);
  ensure(Array.isArray(state.experienceReceipts) && state.experienceReceipts.length <= RECEIPT_LIMIT, 'Invalid experience receipts');
  const receiptKeys = new Set<string>();
  for (const r of state.experienceReceipts) {
    ensure(object(r), 'Invalid receipt'); text(r.key, 160); id(r.professionId); id(r.source); integer(r.amount, 1);
    ensure(!receiptKeys.has(r.key as string), 'Duplicate receipt'); receiptKeys.add(r.key as string);
  }
  ensure(Array.isArray(state.payments) && state.payments.length <= PAYMENT_LIMIT, 'Invalid payment ledger');
  const paymentKeys = new Set<string>();
  for (const p of state.payments) {
    ensure(object(p), 'Invalid payment'); text(p.key, 160); id(p.owner); text(p.eventId, 128); id(p.jobId);
    ensure(['salary', 'reward', 'bonus', 'fee'].includes(p.kind as string) && ['pending', 'settled'].includes(p.status as string), 'Invalid payment kind/status');
    integer(p.amount, 1); id(p.currency); text(p.reason, 256); if (p.reference !== undefined) text(p.reference, 160);
    ensure(!paymentKeys.has(p.key as string), 'Duplicate payment'); paymentKeys.add(p.key as string);
  }
  ensure(Array.isArray(state.dutyLog) && state.dutyLog.length <= DUTY_LOG_LIMIT, 'Invalid duty log');
  for (const l of state.dutyLog) {
    ensure(object(l), 'Invalid duty log'); text(l.id, 160); id(l.jobId); text(l.sessionId, 160); integer(l.milliseconds); integer(l.at);
    ensure(['checkpoint', 'off-duty', 'disconnect', 'character-change', 'resource-stop', 'access-revoked', 'shutdown'].includes(l.reason as string), 'Invalid duty reason');
  }
  ensure(Buffer.byteLength(JSON.stringify(state)) <= 2 * 1024 * 1024, 'Jobs state exceeds 2 MiB');
  return state as unknown as CharacterState;
}
