import type { CharacterState, ProfessionDefinition, ProfessionView, QualificationRequirement } from '../../api/types';
import type { JobRegistry } from '../job-registry';

export function hasQualification(state: CharacterState, requirement: QualificationRequirement, registry: JobRegistry): boolean {
  const d = registry.getProfession(requirement.professionId), p = state.professions.find(v => v.professionId === requirement.professionId);
  if (!d?.enabled || !p || p.owner !== d.owner || p.definitionVersion > d.version || p.experience < (requirement.minExperience ?? 0)) return false;
  const qualification = requirement.qualificationId ? d.qualifications?.find(v => v.id === requirement.qualificationId) : null;
  return !requirement.qualificationId || !!qualification && p.experience >= qualification.experience;
}
export function professionView(state: CharacterState, registry: JobRegistry): readonly ProfessionView[] {
  return state.professions.map(p => {
    const d = registry.getProfession(p.professionId);
    const available = !!d?.enabled && p.owner === d.owner && p.definitionVersion <= d.version;
    const levels = available ? d.levels.filter(l => p.experience >= l.experience) : [];
    return { ...p, available, label: d?.owner === p.owner ? d.label : p.professionId,
      level: levels.at(-1)?.id ?? null, unlocks: [...new Set(levels.flatMap(l => l.unlocks ?? []))],
      qualifications: available ? (d.qualifications ?? []).filter(q => p.experience >= q.experience).map(q => q.id) : [] };
  });
}
export function validProfession(state: CharacterState, d: ProfessionDefinition): boolean {
  const p = state.professions.find(v => v.professionId === d.id); return !!p && p.owner === d.owner && p.definitionVersion <= d.version;
}
