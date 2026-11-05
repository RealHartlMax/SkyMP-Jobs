import { ensure, id, integer, object, snapshot } from './core/validation';

export interface JobsConfig {
  identity: 'native-record' | 'host';
  persistence: 'native' | 'host' | 'memory';
  maxJobs: number; maxConcurrentDuty: number; maxDutyGapMs: number; tickMs: number;
  chat: boolean; ui: boolean;
  commands: { job: string; jobs: string; duty: string; professions: string };
}
export function parseConfig(raw: unknown): JobsConfig {
  ensure(object(raw), 'Jobs config must be an object');
  const allowed = ['identity', 'persistence', 'maxJobs', 'maxConcurrentDuty', 'maxDutyGapMs', 'tickMs', 'chat', 'ui', 'commands'];
  ensure(Object.keys(raw).every(k => allowed.includes(k)), 'Unknown Jobs configuration field');
  const identity = raw.identity ?? 'native-record', persistence = raw.persistence ?? 'native';
  ensure(identity === 'native-record' || identity === 'host', 'Invalid identity mode');
  ensure(persistence === 'native' || persistence === 'host' || persistence === 'memory', 'Invalid persistence mode');
  ensure(persistence !== 'native' || identity === 'native-record', 'Native persistence needs native-record identity');
  const maxJobs = integer(raw.maxJobs ?? 3, 1, 64), maxConcurrentDuty = integer(raw.maxConcurrentDuty ?? 1, 1, maxJobs);
  const tickMs = integer(raw.tickMs ?? 1000, 1000, 10000), maxDutyGapMs = integer(raw.maxDutyGapMs ?? 5000, tickMs, 60000);
  ensure((raw.chat === undefined || typeof raw.chat === 'boolean') && (raw.ui === undefined || typeof raw.ui === 'boolean'), 'Invalid chat/ui switch');
  const commands = { job: 'job', jobs: 'jobs', duty: 'duty', professions: 'professions' };
  if (raw.commands !== undefined) {
    ensure(object(raw.commands) && Object.keys(raw.commands).every(k => Object.hasOwn(commands, k)), 'Invalid command configuration');
    for (const key of Object.keys(commands) as (keyof typeof commands)[]) {
      const value = raw.commands[key]; if (value !== undefined) { const name = id(value); ensure(name.length <= 32, 'Command too long'); commands[key] = name; }
    }
  }
  ensure(new Set(Object.values(commands)).size === 4, 'Duplicate Jobs command names');
  return snapshot({ identity, persistence, maxJobs, maxConcurrentDuty, tickMs, maxDutyGapMs, chat: raw.chat ?? true, ui: raw.ui ?? true, commands });
}
