import fs from 'node:fs';
import path from 'node:path';
import type { CoreApi, CoreEvents, PermissionApi } from './api/core';
import type { UiApi } from './api/ui';
import type { SkyMPChatAPI } from './api/chat';

declare global {
  var mp: CoreApi;
  var skympConsoleSecurity: PermissionApi | undefined;
  var skympUi: UiApi | undefined;
}
export const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
export function keys(value: Record<string, unknown>, allowed: string[]) { check(Object.keys(value).every(k => allowed.includes(k)), 'Unknown configuration/data field'); }
export function text(value: unknown, max = 256): string {
  check(typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value), 'Invalid text');
  return value;
}
export function integer(value: unknown, min: number, max: number): number {
  check(Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= max, 'Invalid integer'); return value as number;
}
export interface Identity { userId: number; actorId: number; profileId: number; record: string }
export function identity(mp: CoreApi, userId: number): Identity | null {
  try {
    if (!Number.isInteger(userId) || userId < 0 || userId >= 65535 || !mp.isConnected(userId)) return null;
    const actorId = mp.getUserActor(userId);
    if (!Number.isInteger(actorId) || actorId <= 0 || actorId > 0xffffffff || mp.getUserByActor(actorId) !== userId) return null;
    const profileId = integer(mp.get(actorId, 'profileId'), 0, 0x7fffffff);
    const record = text(mp.getDescFromId(actorId), 160);
    return { userId, actorId, profileId, record };
  } catch { return null; }
}
export function hasPermission(userId: number, permission: string): boolean {
  try { const api = globalThis.skympConsoleSecurity; return api?.apiVersion === 1 && api.hasPermission(userId, permission) === true; } catch { return false; }
}
type Callback = (...args: any[]) => void;
interface Dispatch { callbacks: Set<Callback>; dispatch: Callback }
const listenersKey = Symbol.for('skymp-plugin-sdk.native-listeners.v1');
const shared = globalThis as typeof globalThis & { [key: symbol]: unknown };
const dispatchers = (shared[listenersKey] ??= new WeakMap<CoreApi, Map<string, Dispatch>>()) as WeakMap<CoreApi, Map<string, Dispatch>>;

/** SDK lifecycle helper; this is not a Core plugin lifecycle API. */
export interface PluginContext<C> {
  mp: CoreApi; owner: string; folder: string; config: C; signal: AbortSignal;
  log: { info(message: string): void; warn(message: string): void; error(message: string): void };
  on<E extends keyof CoreEvents>(event: E, fn: (...args: CoreEvents[E]) => void): () => void;
  onStop(cleanup: () => void): void;
  every(milliseconds: number, callback: () => void): void;
}
export interface PluginHandle { owner: string; mp: CoreApi; stop(): void; readonly active: boolean }
export function startPlugin<C>(owner: string, folder: string, parseConfig: (raw: unknown) => C, start: (ctx: PluginContext<C>) => void): PluginHandle {
  check(/^[a-z][a-z0-9-]{0,47}$/.test(owner) && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(folder), 'Invalid SDK owner/folder');
  const mp = globalThis.mp;
  check(mp && typeof mp.on === 'function', 'SkyMP Core mp.on unavailable');
  const runtimeKey = Symbol.for(`skymp-plugin-sdk.runtime.${owner}.v1`);
  const previous = shared[runtimeKey] as PluginHandle | undefined;
  check(!previous || previous.owner === owner && previous.mp === mp && typeof previous.stop === 'function', 'Runtime owner collision');
  const filename = path.join(process.cwd(), 'Plugins', folder, 'config.json');
  let raw: unknown = {};
  if (fs.existsSync(filename)) {
    check(fs.statSync(filename).size <= 16384, 'Config exceeds 16 KiB');
    raw = JSON.parse(fs.readFileSync(filename, 'utf8'));
  }
  const config = parseConfig(raw); // Invalid data never silently replaces operator settings.
  previous?.stop();
  const cleanup: (() => void)[] = [], abort = new AbortController(); let active = true;
  const log = Object.fromEntries(['info', 'warn', 'error'].map(level => [level, (message: string) => console[level as 'info' | 'warn' | 'error'](`[${owner}] ${message}`)])) as PluginContext<C>['log'];
  const handle: PluginHandle = { owner, mp, get active() { return active; }, stop() {
    if (!active) return;
    active = false; abort.abort();
    for (const fn of cleanup.splice(0).reverse()) { try { fn(); } catch (error) { log.error(`Cleanup: ${String(error)}`); } }
    process.removeListener('exit', handle.stop);
    if (shared[runtimeKey] === handle) delete shared[runtimeKey];
    log.info('Stopped; callbacks and timers released');
  } };
  const context: PluginContext<C> = { mp, owner, folder, config, log, signal: abort.signal,
    onStop(fn) { check(active, 'Plugin stopped'); cleanup.push(fn); },
    on(event, fn) {
      check(active, 'Plugin stopped');
      let events = dispatchers.get(mp);
      if (!events) { events = new Map(); dispatchers.set(mp, events); }
      let entry = events.get(event);
      if (!entry) {
        const callbacks = new Set<Callback>();
        entry = { callbacks, dispatch: (...args) => { for (const callback of [...callbacks]) callback(...args); } };
        mp.on(event, entry.dispatch); events.set(event, entry);
      }
      const guarded: Callback = (...args) => { if (!active) return; try { (fn as Callback)(...args); } catch (error) { log.error(`Event ${event}: ${String(error)}`); } };
      entry.callbacks.add(guarded);
      const dispose = () => { entry!.callbacks.delete(guarded); };
      cleanup.push(dispose); return dispose;
    },
    every(milliseconds, fn) {
      check(active && Number.isInteger(milliseconds) && milliseconds >= 50, 'Invalid timer');
      const timer = setInterval(() => { if (active) { try { fn(); } catch (error) { log.error(`Tick: ${String(error)}`); } } }, milliseconds);
      timer.unref(); cleanup.push(() => clearInterval(timer));
    },
  };
  shared[runtimeKey] = handle; process.once('exit', handle.stop);
  try { start(context); log.info('Started'); } catch (error) { handle.stop(); throw error; }
  return handle;
}

export function requireChat(value: unknown = globalThis.skympChat): SkyMPChatAPI {
  const chat = value as SkyMPChatAPI | undefined;
  check(chat?.apiVersion === 1 && chat.extensions?.commands === 1 && typeof chat.registerCommand === 'function' && typeof chat.unregisterCommand === 'function', 'Chat commands extension v1 unavailable');
  return chat;
}
export function requireUi(value: unknown = globalThis.skympUi): UiApi {
  const ui = value as UiApi | undefined;
  check(ui?.apiVersion === 1 && typeof ui.getStatus === 'function', 'UI Core API v1 unavailable');
  const status = ui.getStatus();
  check(status.ready && status.apiVersion === 1 && status.frontendProtocol === 1, 'UI Core not ready or incompatible');
  for (const name of ['registerWidget', 'unregisterWidget', 'registerMenu', 'unregisterMenu', 'onAction', 'notify', 'updateWidget', 'openMenu', 'closeMenu'] as const) check(typeof ui[name] === 'function', `UI method ${name} unavailable`);
  return ui;
}
/** Bounded late discovery handles alphabetic Core load order. Consumers remain inactive on mismatch. */
export function watchDependency<C, T>(ctx: PluginContext<C>, label: string, select: () => T, attach: (api: T) => () => void): void {
  let dispose: (() => void) | undefined, api: T | undefined, attempts = 0, message = '';
  const detach = () => {
    const release = dispose; dispose = undefined; api = undefined;
    try { release?.(); } catch (error) { ctx.log.warn(`${label} cleanup: ${String(error)}`); }
  };
  const poll = () => {
    if (ctx.signal.aborted || attempts >= 30 && !api) return;
    attempts++;
    try {
      const candidate = select();
      if (candidate === api) return;
      detach();
      dispose = attach(candidate); api = candidate; ctx.log.info(`${label} attached`);
    } catch (error) {
      if (api) detach();
      const next = String(error);
      if (message !== next) { message = next; ctx.log.warn(`${label} inactive: ${next}`); }
    }
  };
  ctx.onStop(detach);
  poll(); ctx.every(1000, poll);
}
