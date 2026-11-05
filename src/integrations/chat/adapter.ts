import type { SkyMPChatAPI, ChatCommandContext } from '../../../vendor/sdk/api/chat';
import type { JobsHostControlsV1 } from '../../api/contracts';
import type { JobsConfig } from '../../config';
import type { CharacterSession } from '../../api/types';

const OWNER = 'skymp-jobs';
export function attachJobsChat(chat: SkyMPChatAPI, controls: JobsHostControlsV1, config: JobsConfig,
  openUi: (session: CharacterSession) => Promise<void>, warn: (message: string) => void): () => void {
  const registered: string[] = [];
  const valid = (command: ChatCommandContext, session: CharacterSession) => {
    const current = controls.currentSession(command.userId);
    return !command.signal.aborted && command.isCurrent() && command.actorId === session.actorId && current?.sessionId === session.sessionId && current.characterId === session.characterId;
  };
  for (const kind of ['job', 'jobs', 'duty', 'professions'] as const) {
    const name = config.commands[kind];
    try {
      chat.registerCommand({ owner: OWNER, id: `${OWNER}:${kind}`, name, description: 'Eigene Jobs und Professionen verwalten',
        parameters: kind === 'duty' ? [{ name: 'job', type: 'string', optional: true, maxLength: 64 }, { name: 'state', type: 'string', optional: true, choices: ['on', 'off'] }] : [],
        rateLimit: { burst: 1, refillMs: 1000 },
        async execute(command) {
          const session = controls.currentSession(command.userId);
          if (!session || !valid(command, session)) { command.error('Charakter noch nicht bereit.'); return; }
          try {
            const state = await controls.api.getCharacter(session.characterId);
            if (!valid(command, session)) return;
            if (kind === 'duty') {
              const jobId = typeof command.parameters.job === 'string' ? command.parameters.job : state.primaryJobId;
              if (!jobId) { command.error('Kein primärer Job gesetzt.'); return; }
              const status = await controls.api.getDuty(session.characterId, jobId);
              if (!valid(command, session)) return;
              const onDuty = command.parameters.state === 'on' ? true : command.parameters.state === 'off' ? false : !status.onDuty;
              await controls.setPlayerDuty(session, jobId, onDuty);
              if (valid(command, session)) command.reply(onDuty ? 'Dienst begonnen.' : 'Dienst beendet.');
            } else if (kind === 'professions') {
              const professions = await controls.api.getProfessions(session.characterId);
              if (!valid(command, session)) return;
              if (!professions.length) command.reply('Keine Profession erlernt.');
              for (const p of professions) command.reply(`${p.label}: ${p.experience} XP; Stufe ${p.level ?? 'Keine'}${p.available ? '' : ' (inaktiv)'}`);
            } else {
              if (!state.jobs.length) command.reply('Kein Job zugewiesen.');
              for (const m of state.jobs) {
                const d = controls.api.getJob(m.jobId), duty = await controls.api.getDuty(session.characterId, m.jobId);
                if (!valid(command, session)) return;
                command.reply(`${state.primaryJobId === m.jobId ? '* ' : ''}${d?.owner === m.owner ? d.label : m.jobId}: ${d?.grades.find(g => g.id === m.gradeId)?.label ?? m.gradeId}; ${duty.onDuty ? 'Im Dienst' : 'Außer Dienst'}${d?.enabled ? '' : ' (inaktiv)'}`);
              }
              if (kind === 'job' && valid(command, session)) await openUi(session);
            }
          } catch { if (valid(command, session)) command.error('Aktion nicht verfügbar oder nicht berechtigt.'); }
        },
      }); registered.push(name);
    } catch (error) { warn(`Chat /${name} nicht registriert (Kollision/API): ${String(error)}`); }
  }
  return () => { for (const name of registered) chat.unregisterCommand(OWNER, name); };
}
