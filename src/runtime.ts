import { requireChat, requireUi, startPlugin, watchDependency } from '../vendor/sdk/server';
import { parseConfig } from './config';
import { createJobsFramework } from './core/character-jobs/framework';
import { ensure, integer } from './core/validation';
import { InMemoryJobsPersistence } from './persistence/memory';
import { NativeJobsPersistence, NativeRecordIdentity, nativeCorePermissions, type NativeCore } from './integrations/skymp/native';
import './integrations/skymp/host';
import { attachJobsChat } from './integrations/chat/adapter';
import { attachJobsUi, type JobsUiIntegration } from './integrations/ui-core/adapter';

export function startJobsPlugin() {
  ensure(globalThis.skympJobs === undefined, 'Jobs already running; restart the gameserver instead of loading twice');
  return startPlugin('skymp-jobs', 'SkyMPJobs', parseConfig, ctx => {
    const host = globalThis.skympJobsHost;
    ensure(!host || host.apiVersion === 1, 'Unsupported Jobs host adapter');
    const identity = ctx.config.identity === 'host' ? host?.identity : new NativeRecordIdentity(ctx.mp);
    ensure(identity?.apiVersion === 1 && typeof identity.getSession === 'function' && typeof identity.isCurrent === 'function', 'Trusted character identity adapter v1 required');
    const persistence = ctx.config.persistence === 'host' ? host?.persistence : ctx.config.persistence === 'memory' ? new InMemoryJobsPersistence() : new NativeJobsPersistence(ctx.mp as NativeCore);
    ensure(persistence?.apiVersion === 1, 'Jobs persistence adapter v1 required');
    const controls = createJobsFramework({ persistence, maxJobs: ctx.config.maxJobs, maxConcurrentDuty: ctx.config.maxConcurrentDuty,
      maxDutyGapMs: ctx.config.maxDutyGapMs, isSessionCurrent: session => identity.isCurrent(session),
      permissions: host?.permissions ?? nativeCorePermissions(identity), factions: host?.factions, economy: host?.economy,
      onError: error => ctx.log.error(String(error)) });
    let ui: JobsUiIntegration | undefined, ticking = false;
    const users = new Set<number>(), failures = new Map<number, string>();
    const report = (userId: number, error: unknown) => {
      const message = String(error); if (failures.get(userId) !== message) { failures.set(userId, message); ctx.log.error(`Character ${userId}: ${message}`); }
    };
    ctx.onStop(() => {
      if (globalThis.skympJobs === controls.api) delete globalThis.skympJobs;
      users.clear(); failures.clear();
      // Core/SDK stop is synchronous. Hosts needing an acknowledged flush must await controls.shutdown().
      void controls.shutdown().catch(error => ctx.log.error(`Shutdown not acknowledged: ${String(error)}`));
    });
    const forget = (userId: number) => {
      identity.invalidate?.(userId); users.delete(userId); failures.delete(userId);
      try { ui?.clear(userId); } catch (error) { ctx.log.warn(String(error)); }
      void controls.disconnect(userId).catch(error => report(userId, error));
    };
    ctx.on('connect', userId => { forget(userId); users.add(userId); });
    ctx.on('disconnect', forget);
    const maxPlayers = integer(ctx.mp.getServerSettings().maxPlayers ?? 100, 1, 65535);
    for (let userId = 0; userId < maxPlayers; userId++) if (ctx.mp.isConnected(userId)) users.add(userId);
    if (ctx.config.ui) watchDependency(ctx, 'UI Core (optional)', requireUi, api => {
      const integration = attachJobsUi(api, controls, ctx.config.commands.job); ui = integration;
      return () => { if (ui === integration) ui = undefined; integration.dispose(); };
    });
    if (ctx.config.chat) watchDependency(ctx, 'Chat commands (optional)', requireChat, api =>
      attachJobsChat(api, controls, ctx.config, async session => { await ui?.show(session); }, message => ctx.log.warn(message)));
    ctx.every(ctx.config.tickMs, () => {
      if (ticking) return; ticking = true;
      void (async () => {
        for (const userId of [...users]) {
          if (ctx.signal.aborted) return;
          try {
            if (!ctx.mp.isConnected(userId)) { forget(userId); continue; }
            const previous = controls.currentSession(userId), session = identity.getSession(userId);
            if (!session) { await controls.disconnect(userId); ui?.clear(userId); continue; }
            if (previous && previous.sessionId !== session.sessionId) ui?.clear(userId);
            await controls.bindSession(session);
            // Optional presentation failures never block sessions or duty accounting.
            try { await ui?.publish(session); } catch (error) { ctx.log.warn(`UI update: ${String(error)}`); }
            failures.delete(userId);
          } catch (error) { report(userId, error); }
        }
        if (!ctx.signal.aborted) await controls.checkpoint();
      })().catch(error => ctx.log.error(`Tick: ${String(error)}`)).finally(() => { ticking = false; });
    });
    globalThis.skympJobs = controls.api;
    if (host?.onReady) { const cleanup = host.onReady(controls); if (cleanup) ctx.onStop(cleanup); }
    ctx.log.info(`Ready API=1; persistence=${persistence.mode}; durableCommitAcknowledged=${persistence.durableCommitAcknowledged}`);
    if (ctx.config.persistence === 'memory') ctx.log.warn('TEST MODE: Jobs data is lost when this process/adapter stops');
  });
}
