import type { AccessConditions, CharacterSession, CharacterState, JobDefinition, JobMembership } from '../../api/types';
import type { JobRegistry } from '../job-registry';
import { hasQualification } from '../professions';
import type { FactionsAdapterV1 } from '../../integrations/factions/contract';

export interface CorePermissionsAdapterV1 {
  readonly apiVersion: 1;
  hasPermission(characterId: string, permission: string, session: CharacterSession | null): Promise<boolean>;
}
export class JobsPermissions {
  constructor(private readonly registry: JobRegistry, private readonly core?: CorePermissionsAdapterV1, private readonly factions?: FactionsAdapterV1) {}
  membership(state: CharacterState, d: JobDefinition): JobMembership | null {
    const m = state.jobs.find(m => m.jobId === d.id);
    return d.enabled && m?.owner === d.owner && m.definitionVersion <= d.version && d.grades.some(g => g.id === m.gradeId) &&
      (!m.specializationId || d.specializations?.some(s => s.id === m.specializationId)) ? m : null;
  }
  qualifications(state: CharacterState, requirements: AccessConditions['qualifications']): boolean {
    return (requirements ?? []).every(r => hasQualification(state, r, this.registry));
  }
  async corePermission(state: CharacterState, name: string, session: CharacterSession | null): Promise<boolean> {
    try { return this.core?.apiVersion === 1 && await this.core.hasPermission(state.characterId, name, session) === true; } catch { return false; }
  }
  async access(state: CharacterState, conditions: AccessConditions | undefined, session: CharacterSession | null): Promise<boolean> {
    if (!conditions) return true;
    if (!this.qualifications(state, conditions.qualifications)) return false;
    if (conditions.corePermission && !await this.corePermission(state, conditions.corePermission, session)) return false;
    if (conditions.factionId) {
      try { if (this.factions?.apiVersion !== 1 || await this.factions.isMember(state.characterId, conditions.factionId) !== true) return false; }
      catch { return false; }
    }
    return true;
  }
  async check(state: CharacterState, name: string, session: CharacterSession | null, onDuty: (jobId: string) => boolean): Promise<boolean> {
    for (const d of this.registry.listJobs()) {
      const m = this.membership(state, d), rule = d.permissions?.find(p => p.id === name);
      if (!m || !rule || rule.grades && !rule.grades.includes(m.gradeId) || rule.requiresDuty && !onDuty(d.id)) continue;
      const grade = d.grades.find(g => g.id === m.gradeId)!;
      if (!this.qualifications(state, grade.requirements) || !this.qualifications(state, rule.qualifications)) continue;
      const specialization = d.specializations?.find(s => s.id === m.specializationId);
      if (!this.qualifications(state, specialization?.requirements) || !await this.access(state, d.access, session)) continue;
      if (rule.requiresDuty && !await this.access(state, d.dutyAccess, session)) continue;
      if (rule.corePermission && !await this.corePermission(state, rule.corePermission, session)) continue;
      if (this.registry.getJob(d.id) !== d || rule.requiresDuty && !onDuty(d.id)) continue;
      return true;
    }
    return false;
  }
}
