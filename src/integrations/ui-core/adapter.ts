import type { UiApi, UiActionContext } from '../../../vendor/sdk/api/ui';
import type { JobsHostControlsV1 } from '../../api/contracts';
import type { CharacterSession } from '../../api/types';
import { object } from '../../core/validation';

const OWNER = 'skymp-jobs', WIDGET = `${OWNER}:status`, MENU = `${OWNER}:overview`;
interface MenuBinding { sessionId: string; actorId: number; index: number; jobId?: string; allowed: Set<string>; busy: boolean }
export interface JobsUiIntegration {
  show(session: CharacterSession): Promise<void>;
  publish(session: CharacterSession): Promise<void>;
  clear(userId: number): void;
  dispose(): void;
}
export function attachJobsUi(ui: UiApi, controls: JobsHostControlsV1, overviewCommand = 'job'): JobsUiIntegration {
  const api = controls.api, menus = new Map<number, MenuBinding>(), introduced = new Map<number, string>();
  let active = true, widgetRegistered = false, menuRegistered = false;
  const live = (s: CharacterSession) => {
    const current = controls.currentSession(s.userId);
    return active && current?.sessionId === s.sessionId && current.characterId === s.characterId && current.actorId === s.actorId;
  };
  const clear = (userId: number) => {
    menus.delete(userId); introduced.delete(userId);
    if (menuRegistered) ui.closeMenu({ userId }, MENU);
    if (widgetRegistered) ui.setWidgetVisible({ userId }, WIDGET, false);
  };
  const dispose = () => {
    active = false; menus.clear(); introduced.clear();
    if (menuRegistered) { ui.unregisterMenu(OWNER, MENU); menuRegistered = false; }
    if (widgetRegistered) { ui.unregisterWidget(OWNER, WIDGET); widgetRegistered = false; }
  };
  const authorize = (action: UiActionContext) => {
    const session = controls.currentSession(action.userId), menu = menus.get(action.userId);
    return active && !action.signal.aborted && !!session && !!menu && action.actorId === session.actorId &&
      menu.actorId === session.actorId && menu.sessionId === session.sessionId &&
      menu.allowed.has(action.actionId) &&
      object(action.payload) && Object.keys(action.payload).length === 0;
  };
  async function show(session: CharacterSession): Promise<void> {
    if (!live(session)) return;
    const state = await api.getCharacter(session.characterId), professions = await api.getProfessions(session.characterId);
    if (!live(session)) return;
    const count = state.jobs.length + professions.length;
    const previous = menus.get(session.userId), index = count ? Math.min(previous?.sessionId === session.sessionId ? previous.index : 0, count - 1) : 0;
    let description = 'Keine Jobs oder Professionen zugewiesen.';
    const actions = [{ id: 'refresh', label: 'Aktualisieren' }];
    if (count > 1) actions.push({ id: 'previous', label: 'Zurück' }, { id: 'next', label: 'Weiter' });
    const m = state.jobs[index];
    if (m) {
      const d = api.getJob(m.jobId), available = !!d?.enabled && d.owner === m.owner && m.definitionVersion <= d.version && d.grades.some(g => g.id === m.gradeId);
      const duty = await api.getDuty(session.characterId, m.jobId);
      description = `${d?.owner === m.owner ? d.label : m.jobId}\nRang: ${d?.grades.find(g => g.id === m.gradeId)?.label ?? m.gradeId}\n` +
        `Primärer Job: ${state.primaryJobId === m.jobId ? 'Ja' : 'Nein'}\nDienst: ${duty.onDuty ? 'Im Dienst' : 'Außer Dienst'}\n` +
        `Erfasste Dienstzeit: ${Math.floor((duty.creditedMs + duty.currentMs) / 1000)} s\n${available ? d.description : 'Ressource oder gespeicherter Rang zurzeit nicht verfügbar.'}`;
      if (available) {
        if (state.primaryJobId !== m.jobId) actions.push({ id: 'primary', label: 'Als primären Job setzen' });
        if (duty.onDuty || duty.canStart) actions.push({ id: duty.onDuty ? 'stop' : 'start', label: duty.onDuty ? 'Dienst beenden' : 'Dienst beginnen' });
      }
    } else if (count) {
      const p = professions[index - state.jobs.length]!;
      description = `${p.label}\nErfahrung: ${p.experience} XP\nStufe: ${p.level ?? 'Keine'}\nFreischaltungen: ${p.unlocks.join(', ') || 'Keine'}\n` +
        `Qualifikationen: ${p.qualifications.join(', ') || 'Keine'}\n${p.available ? '' : 'Ressource zurzeit nicht verfügbar.'}`;
    }
    if (!live(session)) return;
    actions.push({ id: 'close', label: 'Schließen' });
    menus.set(session.userId, { sessionId: session.sessionId, actorId: session.actorId, index, jobId: m?.jobId, allowed: new Set(actions.map(a => a.id)), busy: false });
    ui.openMenu({ userId: session.userId }, MENU, { schemaVersion: 1, text: `${count ? `${index + 1}/${count}\n` : ''}${description}`.slice(0, 2048), actions });
  }
  try {
    ui.registerWidget({ id: WIDGET, owner: OWNER, kind: 'icon-list', schemaVersion: 1, defaultPosition: 'top-right', defaultVisible: true }); widgetRegistered = true;
    ui.registerMenu({ id: MENU, owner: OWNER, title: 'Jobs & Professionen', schemaVersion: 1, layoutId: 'core:dialog-v1' }); menuRegistered = true;
    for (const actionId of ['refresh', 'previous', 'next', 'primary', 'start', 'stop', 'close']) {
      ui.onAction(OWNER, MENU, actionId, async action => {
        if (!authorize(action)) return;
        const session = controls.currentSession(action.userId)!, menu = menus.get(action.userId)!;
        if (menu.busy) return; menu.busy = true;
        try {
          if (actionId === 'close') { menus.delete(action.userId); ui.closeMenu({ userId: action.userId }, MENU); return; }
          const state = await api.getCharacter(session.characterId), professions = await api.getProfessions(session.characterId);
          if (!authorize(action) || !live(session) || menus.get(action.userId) !== menu) return;
          const count = state.jobs.length + professions.length;
          if (actionId === 'previous') menu.index = (menu.index - 1 + Math.max(1, count)) % Math.max(1, count);
          if (actionId === 'next') menu.index = (menu.index + 1) % Math.max(1, count);
          if (menu.jobId && actionId === 'primary') await controls.setPlayerPrimary(session, menu.jobId);
          if (menu.jobId && ['start', 'stop'].includes(actionId)) await controls.setPlayerDuty(session, menu.jobId, actionId === 'start');
          if (authorize(action) && live(session)) await show(session);
        } catch {
          if (live(session) && !action.signal.aborted) ui.notify({ userId: action.userId }, 'Aktion nicht verfügbar oder nicht berechtigt.', { tone: 'warning' });
        } finally { menu.busy = false; }
      }, { authorize });
    }
    return { show, clear, dispose, async publish(session) {
      if (!live(session)) return;
      const state = await api.getCharacter(session.characterId), professions = await api.getProfessions(session.characterId);
      const rows: { label: string; value: string }[] = [];
      for (const m of state.jobs) {
        const d = api.getJob(m.jobId), status = await api.getDuty(session.characterId, m.jobId);
        rows.push({ label: (d?.owner === m.owner ? d.label : m.jobId).slice(0, 160),
          value: `${d?.grades.find(g => g.id === m.gradeId)?.label ?? m.gradeId} · ${status.onDuty ? 'Im Dienst' : 'Außer Dienst'}${d?.enabled ? '' : ' · Inaktiv'}`.slice(0, 160) });
      }
      for (const p of professions) rows.push({ label: p.label, value: `${p.experience} XP · ${p.level ?? 'Keine Stufe'}${p.available ? '' : ' · Inaktiv'}`.slice(0, 160) });
      const visible = rows.slice(0, 16);
      let truncated = rows.length > 16;
      while (Buffer.byteLength(JSON.stringify(visible)) > 7000) { visible.pop(); truncated = true; }
      if (truncated) {
        if (visible.length === 16) visible.pop();
        visible.push({ label: 'Weitere Einträge', value: `Übersicht über /${overviewCommand} öffnen` });
      }
      if (!visible.length) visible.push({ label: 'Jobs & Professionen', value: 'Keine zugewiesen' });
      if (!live(session)) return;
      ui.updateWidget({ userId: session.userId }, WIDGET, { schemaVersion: 1, items: visible });
      ui.setWidgetVisible({ userId: session.userId }, WIDGET, true);
      if (introduced.get(session.userId) !== session.sessionId) { introduced.set(session.userId, session.sessionId); await show(session); }
      else if (menus.get(session.userId)?.sessionId === session.sessionId && !menus.get(session.userId)?.busy) await show(session);
    } };
  } catch (error) { dispose(); throw error; }
}
