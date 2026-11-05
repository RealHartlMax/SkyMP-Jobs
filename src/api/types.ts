export const API_VERSION = 1 as const;
export const STATE_VERSION = 2 as const;
export type CharacterId = string;
export interface QualificationRequirement {
  professionId: string;
  minExperience?: number;
  qualificationId?: string;
}
export interface AccessConditions {
  qualifications?: readonly QualificationRequirement[];
  corePermission?: string;
  factionId?: string;
}
export interface Grade {
  id: string;
  label: string;
  requirements?: readonly QualificationRequirement[];
}
export interface JobPermission {
  id: string;
  grades?: readonly string[];
  requiresDuty?: boolean;
  qualifications?: readonly QualificationRequirement[];
  corePermission?: string;
}
export interface JobDefinition {
  id: string;
  owner: string;
  version: number;
  label: string;
  description: string;
  category: string;
  grades: readonly Grade[];
  specializations?: readonly { id: string; label: string; requirements?: readonly QualificationRequirement[] }[];
  supportsDuty?: boolean;
  dutyAccess?: AccessConditions;
  access?: AccessConditions;
  enabled?: boolean;
  permissions?: readonly JobPermission[];
}
export interface ProfessionDefinition {
  id: string;
  owner: string;
  version: number;
  label: string;
  description: string;
  enabled?: boolean;
  maxExperience: number;
  experienceSources: readonly { id: string; maxAward: number }[];
  levels: readonly { id: string; label: string; experience: number; unlocks?: readonly string[] }[];
  qualifications?: readonly { id: string; label: string; experience: number }[];
}
export interface JobMembership {
  jobId: string; owner: string; definitionVersion: number; gradeId: string;
  specializationId?: string; assignedAt: number; totalDutyMs: number;
}
export interface ProfessionProgress {
  professionId: string; owner: string; definitionVersion: number; experience: number; learnedAt: number;
}
export interface DutyLog {
  id: string; jobId: string; sessionId: string; milliseconds: number; at: number;
  reason: 'checkpoint' | 'off-duty' | 'disconnect' | 'character-change' | 'resource-stop' | 'access-revoked' | 'shutdown';
}
export interface ExperienceReceipt {
  key: string; professionId: string; source: string; amount: number;
}
export interface PaymentRequest {
  eventId: string; jobId: string; kind: 'salary' | 'reward' | 'bonus' | 'fee';
  amount: number; currency: string; reason: string;
}
export interface PaymentRecord extends PaymentRequest {
  key: string; owner: string; status: 'pending' | 'settled'; reference?: string;
}
export interface CharacterState {
  schemaVersion: 2; characterId: CharacterId; revision: number;
  jobs: JobMembership[]; professions: ProfessionProgress[]; primaryJobId: string | null;
  experienceReceipts: ExperienceReceipt[]; payments: PaymentRecord[]; dutyLog: DutyLog[];
}
/** Trusted host binding. sessionId must change on every activation, including same-character re-selection. */
export interface CharacterSession {
  characterId: CharacterId; accountId: string; userId: number; actorId: number; sessionId: string;
}
export interface ActiveJob extends JobMembership { definition: JobDefinition; primary: boolean }
export interface ProfessionView extends ProfessionProgress {
  available: boolean; label: string; level: string | null; unlocks: readonly string[]; qualifications: readonly string[];
}
export interface DutyStatus { onDuty: boolean; canStart: boolean; jobId: string; creditedMs: number; currentMs: number }
export type JobEventType = 'job-registered' | 'job-unregistered' | 'job-enabled' | 'profession-registered' |
  'profession-unregistered' | 'job-assigned' | 'job-removed' | 'primary-changed' | 'grade-changed' |
  'specialization-changed' | 'profession-learned' | 'experience-added' | 'duty-changed' | 'duty-time' | 'payment';
export interface JobEvent {
  apiVersion: 1; type: JobEventType; at: number; characterId?: CharacterId; owner?: string;
  jobId?: string; professionId?: string; revision?: number; reason?: string;
}
export type EventListener = (event: Readonly<JobEvent>) => void;
/** A capability scope is supplied by the trusted host, never by a client or an owner lookup. */
export interface ResourceGrants {
  manageJobs?: readonly string[];
  manageProfessions?: readonly string[];
  experience?: readonly { professionId: string; sources: readonly string[] }[];
  payments?: readonly string[];
}
