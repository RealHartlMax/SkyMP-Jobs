import type { AccessConditions, JobDefinition, ProfessionDefinition, QualificationRequirement, ResourceGrants } from '../api/types';

export function ensure(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
export const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function text(value: unknown, max = 256): string {
  ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\x00-\x1f\x7f]/.test(value), 'Invalid text'); return value;
}
export function id(value: unknown): string { const v = text(value, 64); ensure(/^[a-z][a-z0-9_-]*$/.test(v) && !['__proto__', 'constructor', 'prototype'].includes(v), 'Invalid ID'); return v; }
export function permission(value: unknown): string { const v = text(value, 128); ensure(/^[a-z][a-z0-9_.:-]*$/.test(v), 'Invalid permission'); return v; }
export function integer(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER - 1): number { ensure(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, 'Invalid integer'); return value as number; }
export const characterId = (value: unknown) => text(value, 256);
export function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value;
}
export const snapshot = <T>(value: T): T => freeze(structuredClone(value));
function list<T>(value: readonly T[], max: number, validate: (entry: T) => string): void {
  ensure(Array.isArray(value) && value.length <= max, 'Invalid list');
  const ids = value.map(validate); ensure(new Set(ids).size === ids.length, 'Duplicate ID');
}
export function requirement(r: QualificationRequirement): string {
  ensure(object(r), 'Invalid qualification requirement'); id(r.professionId);
  if (r.minExperience !== undefined) integer(r.minExperience);
  if (r.qualificationId !== undefined) id(r.qualificationId);
  return JSON.stringify(r);
}
function access(a?: AccessConditions) {
  if (a === undefined) return; ensure(object(a as unknown), 'Invalid access conditions');
  if (a.qualifications !== undefined) list(a.qualifications, 32, requirement);
  if (a.corePermission !== undefined) permission(a.corePermission);
  if (a.factionId !== undefined) id(a.factionId);
}
function definition(d: { id: string; owner: string; version: number; label: string; description: string; enabled?: boolean }, owner: string) {
  ensure(object(d), 'Invalid definition'); id(d.id); ensure(d.owner === owner, 'Definition owner mismatch'); id(owner);
  integer(d.version, 1); text(d.label, 120); text(d.description, 1024);
  ensure(d.enabled === undefined || typeof d.enabled === 'boolean', 'Invalid enabled');
  ensure(Buffer.byteLength(JSON.stringify(d)) <= 32768, 'Definition exceeds 32 KiB');
}
export function validateJob(d: JobDefinition, owner: string): JobDefinition {
  definition(d, owner); id(d.category); ensure(Array.isArray(d.grades) && d.grades.length > 0, 'Job needs grades');
  list(d.grades, 32, g => { id(g.id); text(g.label, 120); if (g.requirements) list(g.requirements, 32, requirement); return g.id; });
  if (d.specializations) list(d.specializations, 32, s => { id(s.id); text(s.label, 120); if (s.requirements) list(s.requirements, 32, requirement); return s.id; });
  ensure(d.supportsDuty === undefined || typeof d.supportsDuty === 'boolean', 'Invalid supportsDuty');
  access(d.access); access(d.dutyAccess);
  if (d.permissions) list(d.permissions, 128, p => {
    permission(p.id); ensure(p.id.startsWith(`job.${d.id}.`), 'Permission must use job.<id>. namespace');
    if (p.grades) list(p.grades, 32, g => { ensure(d.grades.some(v => v.id === g), 'Unknown permission grade'); return g; });
    ensure(p.requiresDuty === undefined || typeof p.requiresDuty === 'boolean', 'Invalid requiresDuty');
    ensure(!p.requiresDuty || d.supportsDuty, 'Duty permission requires duty support');
    if (p.qualifications) list(p.qualifications, 32, requirement);
    if (p.corePermission) permission(p.corePermission); return p.id;
  });
  return snapshot({ ...d, enabled: d.enabled ?? true, supportsDuty: d.supportsDuty ?? false });
}
export function validateProfession(d: ProfessionDefinition, owner: string): ProfessionDefinition {
  definition(d, owner); integer(d.maxExperience, 1);
  list(d.experienceSources, 64, s => { id(s.id); integer(s.maxAward, 1, d.maxExperience); return s.id; });
  list(d.levels, 64, l => { id(l.id); text(l.label, 120); integer(l.experience, 0, d.maxExperience); if (l.unlocks) list(l.unlocks, 64, id); return l.id; });
  ensure(d.levels.every((l, i) => i === 0 || l.experience > d.levels[i - 1]!.experience), 'Levels must have increasing thresholds');
  if (d.qualifications) list(d.qualifications, 64, q => { id(q.id); text(q.label, 120); integer(q.experience, 0, d.maxExperience); return q.id; });
  return snapshot({ ...d, enabled: d.enabled ?? true });
}
export function validateGrants(g: ResourceGrants): ResourceGrants {
  ensure(object(g as unknown), 'Invalid grants');
  for (const values of [g.manageJobs, g.manageProfessions, g.payments]) if (values) list(values, 256, id);
  if (g.experience) list(g.experience, 256, e => { id(e.professionId); list(e.sources, 64, id); return e.professionId; });
  return snapshot(g);
}
