import { createHash } from 'node:crypto';
import type { JobsHostControlsV1, ResourceAdministrationV1, ResourceRegistrationV1, SkyMpJobsApiV1 } from '../../api/contracts';
import type { AccessConditions, CharacterSession, CharacterState, DutyLog, EventListener, JobDefinition, JobEvent,
  PaymentRequest, ResourceGrants } from '../../api/types';
import type { JobsPersistenceV1 } from '../../persistence/contract';
import { CharacterRepository } from '../../persistence/repository';
import { DUTY_LOG_LIMIT, PAYMENT_LIMIT, RECEIPT_LIMIT } from '../../persistence/state';
import type { EconomyAdapterV1 } from '../../integrations/economy/contract';
import type { FactionsAdapterV1 } from '../../integrations/factions/contract';
import { DutyTracker } from '../duty';
import { JobsEvents } from '../events';
import { JobRegistry } from '../job-registry';
import { JobsPermissions, type CorePermissionsAdapterV1 } from '../permissions';
import { hasQualification, professionView } from '../professions';
import { characterId, ensure, id, integer, permission, requirement, snapshot, text, validateGrants } from '../validation';

export interface FrameworkOptions {
  persistence: JobsPersistenceV1;
  maxJobs?: number;
  maxConcurrentDuty?: number;
  maxDutyGapMs?: number;
  permissions?: CorePermissionsAdapterV1;
  factions?: FactionsAdapterV1;
  economy?: EconomyAdapterV1;
  /** Must query the trusted host, not a client-provided binding. */
  isSessionCurrent(session: CharacterSession): boolean;
  monotonic?: () => number;
  wallClock?: () => number;
  onError?: (error: unknown) => void;
}
type Resource = { owner: string; active: boolean; grants: ResourceGrants; disposeSubscriptions: Set<() => void> };
type PaymentResult = { status: 'pending' | 'settled'; reference?: string };

export function createJobsFramework(options: FrameworkOptions): JobsHostControlsV1 {
  const registry = new JobRegistry(), repository = new CharacterRepository(options.persistence);
  const clock = options.wallClock ?? Date.now, monotonic = options.monotonic ?? (() => performance.now());
  const onError = (error: unknown) => { try { options.onError?.(error); } catch { /* Logging cannot roll back accepted state. */ } }, events = new JobsEvents(onError);
  const maxJobs = integer(options.maxJobs ?? 3, 1, 64);
  const duty = new DutyTracker(integer(options.maxConcurrentDuty ?? 1, 1, maxJobs), integer(options.maxDutyGapMs ?? 5000, 1000, 60000), monotonic);
  const permissions = new JobsPermissions(registry, options.permissions, options.factions);
  const sessions = new Map<number, CharacterSession>(), resources = new Map<string, Resource>();
  const paymentsInFlight = new Map<string, { fingerprint: string; promise: Promise<PaymentResult> }>();
  let phase: 'active' | 'stopping' | 'stopped' = 'active';
  let shutdownPromise: Promise<void> | undefined;
  const active = () => ensure(phase === 'active', 'Jobs service stopped');
  const resourceActive = (r: Resource) => { active(); ensure(r.active, 'Resource disposed'); };
  const timestamp = () => integer(Math.floor(clock()));
  const emit = (type: JobEvent['type'], details: Omit<JobEvent, 'type' | 'at' | 'apiVersion'> = {}) => events.emit({ apiVersion: 1, type, at: timestamp(), ...details });
  const sameSession = (a: CharacterSession, b: CharacterSession) => a.userId === b.userId && a.actorId === b.actorId && a.characterId === b.characterId && a.accountId === b.accountId && a.sessionId === b.sessionId;
  const current = (s: CharacterSession | null): s is CharacterSession => {
    if (!s || phase !== 'active') return false;
    try { const bound = sessions.get(s.userId); return !!bound && sameSession(s, bound) && options.isSessionCurrent(s) === true; } catch { return false; }
  };
  const sessionFor = (character: string) => [...sessions.values()].find(s => s.characterId === character && current(s)) ?? null;
  const onDuty = (character: string, jobId: string) => { const entry = duty.get(character, jobId); return !!entry && entry.endedAt === undefined && current(entry.session) && registry.getJob(jobId)?.enabled === true; };
  const job = (jobId: string) => { const d = registry.getJob(id(jobId)); ensure(d?.enabled, 'Job unavailable'); return d; };
  const membership = (state: CharacterState, d: JobDefinition) => { const m = permissions.membership(state, d); ensure(m, 'Job membership unavailable'); return m; };
  const storedMembership = (state: CharacterState, d: JobDefinition) => {
    const m = state.jobs.find(m => m.jobId === d.id);
    ensure(m?.owner === d.owner && m.definitionVersion <= d.version, 'Job membership ownership/version mismatch'); return m;
  };
  const checkConditions = async (state: CharacterState, conditions?: AccessConditions) => ensure(await permissions.access(state, conditions, sessionFor(state.characterId)), 'Job access denied');
  const scope = (r: Resource, kind: 'manageJobs' | 'manageProfessions' | 'payments', key: string) => { resourceActive(r); id(key); ensure(r.grants[kind]?.includes(key), `Missing ${kind} capability`); };
  const read = async (character: string) => { active(); return repository.run(character, () => repository.read(character)); };
  async function dutyAllowed(state: CharacterState, d: JobDefinition | null, session: CharacterSession | null): Promise<boolean> {
    if (!d?.enabled || !d.supportsDuty || !current(session)) return false;
    const m = permissions.membership(state, d); if (!m) return false;
    if (!permissions.qualifications(state, d.grades.find(g => g.id === m.gradeId)?.requirements) ||
      !permissions.qualifications(state, d.specializations?.find(s => s.id === m.specializationId)?.requirements)) return false;
    const epoch = registry.revision;
    return await permissions.access(state, d.access, session) && await permissions.access(state, d.dutyAccess, session) &&
      current(session) && registry.revision === epoch;
  }

  async function write(character: string, guard: () => void, type: JobEvent['type'], details: Partial<JobEvent>, change: (state: CharacterState) => void | Promise<void>): Promise<void> {
    characterId(character); guard();
    await repository.run(character, async () => {
      guard();
      const epoch = registry.revision;
      const { state } = await repository.mutate(character, async draft => { guard(); await change(draft); }, () => { guard(); ensure(registry.revision === epoch, 'Definitions changed during operation'); });
      emit(type, { ...details, characterId: character, revision: state.revision });
    });
  }
  async function credit(character: string, jobId: string, reason: DutyLog['reason'], end: number, stop: boolean): Promise<void> {
    const entry = duty.get(character, jobId); if (!entry) return;
    if (stop && entry.endedAt === undefined) { entry.endedAt = end; entry.endReason = reason; }
    if (entry.endedAt !== undefined) { end = entry.endedAt; reason = entry.endReason!; stop = true; }
    const record = duty.log(entry, reason, timestamp(), end);
    const { state } = await repository.mutate(character, draft => {
      const m = draft.jobs.find(v => v.jobId === jobId);
      ensure(m, 'Duty membership missing');
      // A deterministic interval ID makes a retry after an ambiguous store response harmless.
      if (!draft.dutyLog.some(l => l.id === record.id)) {
        m.totalDutyMs = integer(m.totalDutyMs + record.milliseconds);
        draft.dutyLog.push(record); draft.dutyLog = draft.dutyLog.slice(-DUTY_LOG_LIMIT);
      }
    });
    entry.creditedUntil = Math.max(entry.creditedUntil, end); entry.sequence++;
    if (stop) duty.remove(character, jobId);
    emit(stop ? 'duty-changed' : 'duty-time', { characterId: character, jobId, revision: state.revision, reason });
  }
  async function stopCharacter(character: string, reason: DutyLog['reason'], end: number): Promise<void> {
    await repository.run(character, async () => {
      for (const jobId of [...(duty.entries.get(character)?.keys() ?? [])]) await credit(character, jobId, reason, end, true);
    });
  }
  async function stopJob(jobId: string): Promise<void> {
    const end = monotonic();
    await Promise.all([...duty.entries].filter(([, entries]) => entries.has(jobId)).map(([character]) => repository.run(character, () => credit(character, jobId, 'resource-stop', end, true))));
  }
  async function setDuty(character: string, jobId: string, value: boolean, guard: () => void): Promise<void> {
    ensure(typeof value === 'boolean', 'Invalid duty status'); guard();
    await repository.run(character, async () => {
      guard();
      if (!value) { await credit(character, jobId, 'off-duty', monotonic(), true); return; }
      const d = job(jobId); ensure(d.supportsDuty, 'Job has no duty support');
      const session = sessionFor(character); ensure(session, 'Duty requires a current online character');
      const state = await repository.read(character); membership(state, d);
      ensure(await dutyAllowed(state, d, session), 'Duty access denied');
      guard(); ensure(current(session) && registry.getJob(jobId) === d, 'Stale session/definition');
      ensure(duty.get(character, jobId)?.endedAt === undefined, 'Previous duty settlement pending');
      if (!duty.get(character, jobId)) { duty.start(session, jobId); emit('duty-changed', { characterId: character, jobId, reason: 'on-duty' }); }
    });
  }
  async function primary(character: string, jobId: string, guard: () => void): Promise<void> {
    await write(character, guard, 'primary-changed', { jobId }, state => { membership(state, job(jobId)); state.primaryJobId = jobId; });
  }
  function createResource(owner: string, suppliedGrants?: ResourceGrants): ResourceRegistrationV1 | ResourceAdministrationV1 {
    active(); id(owner); ensure(resources.size < 256 && !resources.has(owner), 'Resource already registered/limit reached');
    const r: Resource = { owner, active: true, grants: validateGrants(suppliedGrants ?? {}), disposeSubscriptions: new Set() };
    resources.set(owner, r);
    const registration: ResourceRegistrationV1 = {
      owner,
      registerJob(definition) { resourceActive(r); ensure(registry.listJobs().length < 256, 'Job registry limit'); registry.registerJob(owner, definition); emit('job-registered', { jobId: definition.id, owner }); },
      async deregisterJob(jobId) {
        resourceActive(r); registry.removeJob(owner, id(jobId)); emit('job-unregistered', { jobId, owner }); await stopJob(jobId);
      },
      async setJobEnabled(jobId, enabled) {
        resourceActive(r); registry.setEnabled(owner, id(jobId), enabled); emit('job-enabled', { jobId, owner }); if (!enabled) await stopJob(jobId);
      },
      registerProfession(definition) { resourceActive(r); ensure(registry.listProfessions().length < 256, 'Profession registry limit'); registry.registerProfession(owner, definition); emit('profession-registered', { professionId: definition.id, owner }); },
      deregisterProfession(professionId) { resourceActive(r); registry.removeProfession(owner, id(professionId)); emit('profession-unregistered', { professionId, owner }); },
      subscribe(listener) {
        resourceActive(r); const off = events.subscribe(listener);
        const dispose = () => { off(); r.disposeSubscriptions.delete(dispose); }; r.disposeSubscriptions.add(dispose); return dispose;
      },
      async dispose() {
        if (!r.active) return; r.active = false;
        for (const off of r.disposeSubscriptions) off();
        const ownedJobs = registry.listJobs().filter(d => d.owner === owner);
        for (const d of ownedJobs) { registry.removeJob(owner, d.id); emit('job-unregistered', { jobId: d.id, owner }); }
        for (const d of registry.listProfessions().filter(d => d.owner === owner)) { registry.removeProfession(owner, d.id); emit('profession-unregistered', { professionId: d.id, owner }); }
        try { await Promise.all(ownedJobs.map(d => stopJob(d.id))); } finally { resources.delete(owner); }
      },
    };
    if (suppliedGrants === undefined) return Object.freeze(registration);
    const administration: ResourceAdministrationV1 = {
      ...registration,
      async assignJob(character, jobId, gradeId) {
        const guard = () => scope(r, 'manageJobs', jobId);
        await write(character, guard, 'job-assigned', { jobId, owner }, async state => {
          const d = job(jobId), grade = d.grades.find(g => g.id === (gradeId ?? d.grades[0]!.id));
          ensure(!state.jobs.some(m => m.jobId === jobId), 'Job already assigned'); ensure(state.jobs.length < maxJobs, 'Character job limit reached'); ensure(grade, 'Unknown grade');
          await checkConditions(state, d.access); ensure(permissions.qualifications(state, grade.requirements), 'Grade qualification denied');
          ensure(registry.getJob(jobId) === d, 'Job definition changed');
          state.jobs.push({ jobId, owner: d.owner, definitionVersion: d.version, gradeId: grade.id, assignedAt: timestamp(), totalDutyMs: 0 });
          state.primaryJobId ??= jobId;
        });
      },
      async removeJob(character, jobId) {
        const guard = () => scope(r, 'manageJobs', jobId); guard();
        await repository.run(character, async () => {
          guard(); await credit(character, jobId, 'off-duty', monotonic(), true);
          const { state } = await repository.mutate(character, draft => {
            guard(); ensure(draft.jobs.some(m => m.jobId === jobId), 'Job not assigned');
            draft.jobs = draft.jobs.filter(m => m.jobId !== jobId);
            if (draft.primaryJobId === jobId) draft.primaryJobId = draft.jobs[0]?.jobId ?? null;
          }, guard);
          emit('job-removed', { characterId: character, jobId, owner, revision: state.revision });
        });
      },
      async setPrimaryJob(character, jobId) { await primary(character, jobId, () => scope(r, 'manageJobs', jobId)); },
      async setGrade(character, jobId, gradeId) {
        await write(character, () => scope(r, 'manageJobs', jobId), 'grade-changed', { jobId, owner }, state => {
          const d = job(jobId), m = storedMembership(state, d), grade = d.grades.find(g => g.id === gradeId); ensure(grade, 'Unknown grade');
          ensure(permissions.qualifications(state, grade.requirements), 'Grade qualification denied'); m.gradeId = gradeId; m.definitionVersion = d.version;
        });
      },
      async setSpecialization(character, jobId, specializationId) {
        await write(character, () => scope(r, 'manageJobs', jobId), 'specialization-changed', { jobId, owner }, state => {
          const d = job(jobId), m = storedMembership(state, d);
          if (specializationId === null) { delete m.specializationId; m.definitionVersion = d.version; return; }
          const specialization = d.specializations?.find(s => s.id === specializationId); ensure(specialization, 'Unknown specialization');
          ensure(permissions.qualifications(state, specialization.requirements), 'Specialization qualification denied'); m.specializationId = specializationId; m.definitionVersion = d.version;
        });
      },
      async learnProfession(character, professionId) {
        await write(character, () => scope(r, 'manageProfessions', professionId), 'profession-learned', { professionId, owner }, state => {
          const d = registry.getProfession(id(professionId)); ensure(d?.enabled, 'Profession unavailable');
          ensure(state.professions.length < 256 && !state.professions.some(p => p.professionId === professionId), 'Profession already learned/limit reached');
          state.professions.push({ professionId, owner: d.owner, definitionVersion: d.version, experience: 0, learnedAt: timestamp() });
        });
      },
      async addExperience(character, professionId, award) {
        award = snapshot(award);
        const guard = () => { resourceActive(r); ensure(r.grants.experience?.some(g => g.professionId === professionId && g.sources.includes(award.source)), 'Missing experience capability'); };
        guard(); id(professionId); id(award.source); text(award.eventId, 128); integer(award.amount, 1);
        const key = createHash('sha256').update(JSON.stringify([owner, character, award.eventId])).digest('hex');
        return repository.run(character, async () => {
          guard(); const previous = await repository.read(character), receipt = previous.experienceReceipts.find(v => v.key === key);
          if (receipt) { ensure(receipt.professionId === professionId && receipt.source === award.source && receipt.amount === award.amount, 'Experience idempotency conflict'); return false; }
          const epoch = registry.revision;
          const { state } = await repository.mutate(character, draft => {
            guard(); const d = registry.getProfession(professionId), p = draft.professions.find(p => p.professionId === professionId);
            ensure(d?.enabled && p?.owner === d.owner && p.definitionVersion <= d.version, 'Profession unavailable/not learned');
            const source = d.experienceSources.find(s => s.id === award.source); ensure(source && award.amount <= source.maxAward, 'Experience source/award denied');
            ensure(draft.experienceReceipts.length < RECEIPT_LIMIT, 'Experience receipt ledger full; host archival required');
            ensure(p.experience + award.amount <= d.maxExperience, 'Maximum profession experience exceeded');
            p.experience += award.amount; draft.experienceReceipts.push({ key, professionId, source: award.source, amount: award.amount });
          }, () => { guard(); ensure(registry.revision === epoch, 'Definitions changed during operation'); });
          emit('experience-added', { characterId: character, professionId, owner, revision: state.revision }); return true;
        });
      },
      async setDuty(character, jobId, onDuty) { await setDuty(character, jobId, onDuty, () => scope(r, 'manageJobs', jobId)); },
      async requestPayment(character, request) {
        request = snapshot(request);
        const guard = () => scope(r, 'payments', request.jobId); guard();
        text(request.eventId, 128); id(request.jobId); integer(request.amount, 1); id(request.currency); text(request.reason, 256);
        ensure(['salary', 'reward', 'bonus', 'fee'].includes(request.kind), 'Invalid payment kind');
        const economy = options.economy;
        if (!economy || economy.apiVersion !== 1) return { status: 'unavailable' };
        // Freeze the input before the first await. External resources cannot change a request mid-flight.
        const payload: PaymentRequest = snapshot({ eventId: request.eventId, jobId: request.jobId, kind: request.kind, amount: request.amount, currency: request.currency, reason: request.reason });
        const key = `jobs:${createHash('sha256').update(JSON.stringify([owner, character, payload.eventId])).digest('hex')}`;
        const fingerprint = JSON.stringify(payload), existing = paymentsInFlight.get(key);
        if (existing) { ensure(existing.fingerprint === fingerprint, 'Payment idempotency conflict'); return existing.promise; }
        const delivery: Promise<PaymentResult> = repository.run<PaymentResult | null>(character, async () => {
          guard(); let state = await repository.read(character), record = state.payments.find(p => p.key === key);
          if (record) {
            ensure(record.owner === owner && JSON.stringify(payload) === JSON.stringify({ eventId: record.eventId, jobId: record.jobId, kind: record.kind, amount: record.amount, currency: record.currency, reason: record.reason }), 'Payment idempotency conflict');
            if (record.status === 'settled') return { status: 'settled', reference: record.reference };
          } else {
            ({ state } = await repository.mutate(character, draft => {
              guard(); membership(draft, job(payload.jobId)); ensure(draft.payments.length < PAYMENT_LIMIT, 'Payment ledger full; host archival required');
              draft.payments.push({ ...payload, key, owner, status: 'pending' });
            }, guard));
          }
          return null;
        }).then(async known => {
          if (known) return known;
          guard();
          // Never hold the character queue across an external Economy call.
          const result = await economy.request(snapshot({ ...payload, characterId: character, owner, idempotencyKey: key }));
          ensure(result && ['pending', 'settled'].includes(result.status), 'Invalid economy response');
          if (result.reference !== undefined) text(result.reference, 160);
          // Settlement bookkeeping must finish even if a resource stops during the external request.
          return repository.run(character, async () => {
            const settled = await repository.mutate(character, draft => {
              const p = draft.payments.find(p => p.key === key)!; p.status = result.status;
              if (result.reference !== undefined) p.reference = result.reference;
            });
            emit('payment', { characterId: character, jobId: payload.jobId, owner, revision: settled.state.revision });
            return snapshot(result);
          });
        });
        paymentsInFlight.set(key, { fingerprint, promise: delivery });
        const release = () => { if (paymentsInFlight.get(key)?.promise === delivery) paymentsInFlight.delete(key); };
        void delivery.then(release, release); return delivery;
      },
    };
    return Object.freeze(administration);
  }

  const api: SkyMpJobsApiV1 = Object.freeze({
    apiVersion: 1 as const,
    status: snapshot({ persistence: options.persistence.mode, durableCommitAcknowledged: options.persistence.durableCommitAcknowledged }),
    getJob(jobId: string) { active(); return registry.getJob(id(jobId)); },
    listJobs() { active(); return registry.listJobs(); },
    getProfession(professionId: string) { active(); return registry.getProfession(id(professionId)); },
    listProfessions() { active(); return registry.listProfessions(); },
    getCharacter: read,
    async getActiveJobs(character: string) {
      const state = await read(character);
      return snapshot(registry.listJobs().flatMap(d => { const m = permissions.membership(state, d); return m ? [{ ...m, definition: d, primary: state.primaryJobId === d.id }] : []; }));
    },
    async getProfessions(character: string) { return snapshot(professionView(await read(character), registry)); },
    async hasQualification(character: string, query: Parameters<SkyMpJobsApiV1['hasQualification']>[1]) { query = snapshot(query); requirement(query); return hasQualification(await read(character), query, registry); },
    async hasPermission(character: string, name: string) {
      permission(name);
      return repository.run(character, async () => {
        active(); const state = await repository.read(character), session = sessionFor(character), epoch = registry.revision;
        const allowed = await permissions.check(state, name, session, jobId => onDuty(character, jobId));
        return allowed && phase === 'active' && registry.revision === epoch && (!session || current(session));
      });
    },
    async getDuty(character: string, jobId: string) {
      id(jobId); const state = await read(character), entry = duty.get(character, jobId);
      const allowed = await dutyAllowed(state, registry.getJob(jobId), sessionFor(character));
      const activeDuty = allowed && onDuty(character, jobId);
      return snapshot({ onDuty: activeDuty, canStart: allowed && !entry && (duty.entries.get(character)?.size ?? 0) < duty.maxConcurrent,
        jobId, creditedMs: state.jobs.find(m => m.jobId === jobId)?.totalDutyMs ?? 0, currentMs: entry && activeDuty ? duty.elapsed(entry) : 0 });
    },
    subscribe(listener: EventListener) { active(); return events.subscribe(listener); },
    registerResource: (owner: string) => createResource(owner) as ResourceRegistrationV1,
  });

  const controls: JobsHostControlsV1 = {
    api,
    provisionResource: (owner, grants) => createResource(owner, grants) as ResourceAdministrationV1,
    async bindSession(binding) {
      binding = snapshot(binding);
      active(); characterId(binding.characterId); text(binding.accountId, 160); text(binding.sessionId, 96); integer(binding.userId, 0, 65534); integer(binding.actorId, 1, 0xffffffff);
      ensure(options.isSessionCurrent(binding) === true, 'Untrusted/stale character binding');
      const old = sessions.get(binding.userId);
      if (old && sameSession(old, binding)) return;
      ensure(![...sessions.values()].some(s => s.characterId === binding.characterId && s.userId !== binding.userId), 'Character already online');
      if (old) { sessions.delete(binding.userId); await stopCharacter(old.characterId, 'character-change', monotonic()); }
      active(); ensure(options.isSessionCurrent(binding) === true, 'Stale character binding');
      ensure(![...sessions.values()].some(s => s.characterId === binding.characterId && s.userId !== binding.userId), 'Character already online');
      sessions.set(binding.userId, snapshot(binding));
    },
    async disconnect(userId) {
      const old = sessions.get(userId); sessions.delete(userId);
      if (old) await stopCharacter(old.characterId, 'disconnect', monotonic());
    },
    currentSession(userId) { const session = sessions.get(userId) ?? null; return current(session) ? snapshot(session) : null; },
    async setPlayerDuty(session, jobId, value) { session = snapshot(session); const guard = () => { active(); ensure(current(session), 'Stale player session'); }; await setDuty(session.characterId, jobId, value, guard); },
    async setPlayerPrimary(session, jobId) { session = snapshot(session); await primary(session.characterId, jobId, () => { active(); ensure(current(session), 'Stale player session'); }); },
    async checkpoint() {
      active(); const end = monotonic();
      for (const [character, entries] of [...duty.entries]) {
        await repository.run(character, async () => {
          const state = await repository.read(character);
          for (const entry of [...entries.values()]) {
            const definition = registry.getJob(entry.jobId), online = current(entry.session);
            const allowed = await dutyAllowed(state, definition, entry.session);
            const reason = !online ? 'disconnect' : !definition?.enabled ? 'resource-stop' : !allowed ? 'access-revoked' : 'checkpoint';
            await credit(character, entry.jobId, reason, end, !allowed);
          }
        });
      }
    },
    shutdown() {
      if (shutdownPromise) return shutdownPromise;
      phase = 'stopping'; sessions.clear(); const end = monotonic();
      shutdownPromise = (async () => {
        const results = await Promise.allSettled([...duty.entries.keys()].map(character => stopCharacter(character, 'shutdown', end)));
        await Promise.allSettled([...paymentsInFlight.values()].map(p => p.promise));
        for (const resource of resources.values()) { resource.active = false; for (const off of resource.disposeSubscriptions) off(); }
        resources.clear(); registry.clear(); events.clear();
        try { await repository.drain(); } finally { phase = 'stopped'; }
        const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
        if (failed.length) throw new AggregateError(failed.map(r => r.reason), 'Duty checkpoint failed during shutdown');
      })();
      return shutdownPromise;
    },
  };
  return Object.freeze(controls);
}
