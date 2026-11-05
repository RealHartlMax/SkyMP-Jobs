import type { JobDefinition, ProfessionDefinition } from '../../api/types';
import { ensure, snapshot, validateJob, validateProfession } from '../validation';

export class JobRegistry {
  private epoch = 0;
  get revision(): number { return this.epoch; }
  private readonly jobs = new Map<string, JobDefinition>();
  private readonly professions = new Map<string, ProfessionDefinition>();
  private readonly provenance = new Map<string, { owner: string; version: number }>();
  getJob(id: string): JobDefinition | null { return this.jobs.get(id) ?? null; }
  getProfession(id: string): ProfessionDefinition | null { return this.professions.get(id) ?? null; }
  listJobs(): readonly JobDefinition[] { return Object.freeze([...this.jobs.values()]); }
  listProfessions(): readonly ProfessionDefinition[] { return Object.freeze([...this.professions.values()]); }
  private claim(kind: string, id: string, owner: string, version: number): void {
    const key = `${kind}:${id}`, previous = this.provenance.get(key);
    ensure(!previous || previous.owner === owner && version >= previous.version, 'Definition owner/version conflict');
    this.provenance.set(key, { owner, version });
  }
  registerJob(owner: string, value: JobDefinition): void {
    const definition = validateJob(value, owner);
    ensure(!this.jobs.has(definition.id), 'Duplicate job ID');
    this.claim('job', definition.id, owner, definition.version); this.jobs.set(definition.id, definition); this.epoch++;
  }
  registerProfession(owner: string, value: ProfessionDefinition): void {
    const definition = validateProfession(value, owner);
    ensure(!this.professions.has(definition.id), 'Duplicate profession ID');
    this.claim('profession', definition.id, owner, definition.version); this.professions.set(definition.id, definition); this.epoch++;
  }
  setEnabled(owner: string, id: string, enabled: boolean): void {
    const d = this.ownedJob(owner, id); ensure(typeof enabled === 'boolean', 'Invalid enabled');
    this.jobs.set(id, snapshot({ ...d, enabled })); this.epoch++;
  }
  ownedJob(owner: string, id: string): JobDefinition { const d = this.getJob(id); ensure(d?.owner === owner, 'Resource does not own job'); return d; }
  removeJob(owner: string, id: string): void { this.ownedJob(owner, id); this.jobs.delete(id); this.epoch++; }
  removeProfession(owner: string, id: string): void { ensure(this.getProfession(id)?.owner === owner, 'Resource does not own profession'); this.professions.delete(id); this.epoch++; }
  clear(): void { this.jobs.clear(); this.professions.clear(); this.provenance.clear(); this.epoch++; }
}
