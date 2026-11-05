import type { ActiveJob, CharacterId, CharacterSession, CharacterState, DutyStatus, EventListener,
  JobDefinition, PaymentRequest, ProfessionDefinition, ProfessionView, QualificationRequirement, ResourceGrants } from './types';

export interface JobsReadApiV1 {
  readonly apiVersion: 1;
  getJob(id: string): JobDefinition | null;
  listJobs(): readonly JobDefinition[];
  getProfession(id: string): ProfessionDefinition | null;
  listProfessions(): readonly ProfessionDefinition[];
  getCharacter(id: CharacterId): Promise<CharacterState>;
  getActiveJobs(id: CharacterId): Promise<readonly ActiveJob[]>;
  getProfessions(id: CharacterId): Promise<readonly ProfessionView[]>;
  hasQualification(id: CharacterId, requirement: QualificationRequirement): Promise<boolean>;
  hasPermission(id: CharacterId, permission: string): Promise<boolean>;
  getDuty(id: CharacterId, jobId: string): Promise<DutyStatus>;
  subscribe(listener: EventListener): () => void;
}
export interface ResourceRegistrationV1 {
  readonly owner: string;
  registerJob(definition: JobDefinition): void;
  deregisterJob(id: string): Promise<void>;
  setJobEnabled(id: string, enabled: boolean): Promise<void>;
  registerProfession(definition: ProfessionDefinition): void;
  deregisterProfession(id: string): void;
  subscribe(listener: EventListener): () => void;
  dispose(): Promise<void>;
}
export interface ResourceAdministrationV1 extends ResourceRegistrationV1 {
  assignJob(character: CharacterId, jobId: string, gradeId?: string): Promise<void>;
  removeJob(character: CharacterId, jobId: string): Promise<void>;
  setPrimaryJob(character: CharacterId, jobId: string): Promise<void>;
  setGrade(character: CharacterId, jobId: string, gradeId: string): Promise<void>;
  setSpecialization(character: CharacterId, jobId: string, specializationId: string | null): Promise<void>;
  learnProfession(character: CharacterId, professionId: string): Promise<void>;
  addExperience(character: CharacterId, professionId: string, award: { source: string; eventId: string; amount: number }): Promise<boolean>;
  setDuty(character: CharacterId, jobId: string, onDuty: boolean): Promise<void>;
  requestPayment(character: CharacterId, request: PaymentRequest): Promise<{ status: 'unavailable' | 'pending' | 'settled'; reference?: string }>;
}
export interface SkyMpJobsApiV1 extends JobsReadApiV1 {
  /** Registration only. A freely chosen owner never yields membership, XP or payment privileges. */
  registerResource(owner: string): ResourceRegistrationV1;
  readonly status: { persistence: string; durableCommitAcknowledged: boolean };
}
export interface JobsHostControlsV1 {
  readonly api: SkyMpJobsApiV1;
  provisionResource(owner: string, grants: ResourceGrants): ResourceAdministrationV1;
  bindSession(session: CharacterSession): Promise<void>;
  disconnect(userId: number): Promise<void>;
  currentSession(userId: number): CharacterSession | null;
  setPlayerDuty(session: CharacterSession, jobId: string, onDuty: boolean): Promise<void>;
  setPlayerPrimary(session: CharacterSession, jobId: string): Promise<void>;
  checkpoint(): Promise<void>;
  shutdown(): Promise<void>;
}
declare global { var skympJobs: SkyMpJobsApiV1 | undefined; }
