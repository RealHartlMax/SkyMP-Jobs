'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { EventEmitter } = require('node:events');
const root = path.resolve(__dirname, '..');
function fakeCore() {
  const listeners = new Map(), users = new Map(), records = new Map(), sent = [];
  const mp = {
    on(event, callback) { if (!listeners.has(event)) listeners.set(event, []); listeners.get(event).push(callback); },
    isConnected: u => users.has(u), getUserActor: u => users.get(u) ?? 0,
    getUserByActor: a => [...users].find(([, value]) => value === a)?.[0] ?? 65535,
    getDescFromId: a => records.get(a)?.record, getIdFromDesc: d => [...records].find(([, value]) => value.record === d)?.[0] ?? 0,
    get: (a, p) => structuredClone(records.get(a)?.[p]),
    set: (a, p, value) => { if (!records.has(a)) throw Error('Missing actor'); records.get(a)[p] = structuredClone(value); },
    getServerSettings: () => ({ maxPlayers: 32 }), getActorName: a => `Fixture ${a}`,
    getUserGuid: u => `fixture-guid-${u}`, sendCustomPacket: (userId, raw) => sent.push({ userId, ...JSON.parse(raw) }), writeLogs() {},
  };
  const emit = (event, ...args) => { for (const listener of listeners.get(event) ?? []) listener(...args); };
  return { mp, users, records, listeners, sent, emit,
    connect(userId = 1, actorId = 101) { users.set(userId, actorId); if (!records.has(actorId)) records.set(actorId, { record: actorId.toString(16) + ':Skyrim.esm', profileId: 7 }); emit('connect', userId); },
    disconnect(userId = 1) { users.delete(userId); emit('disconnect', userId); },
  };
}
function fakeUi() {
  const widgets = new Map(), menus = new Map(), actions = new Map(), updates = [], opened = [], notices = [];
  const api = { apiVersion: 1, getStatus: () => ({ ready: true, apiVersion: 1, frontendProtocol: 1, sessions: 1, locale: 'de' }),
    registerWidget(def) { if (widgets.has(def.id)) throw Error('Widget collision'); widgets.set(def.id, def); },
    unregisterWidget(owner, widgetId) { if (widgets.get(widgetId)?.owner === owner) widgets.delete(widgetId); },
    updateWidget: (target, widgetId, state) => updates.push({ target, widgetId, state }), setWidgetVisible() {},
    registerMenu(def) { if (menus.has(def.id)) throw Error('Menu collision'); menus.set(def.id, def); },
    unregisterMenu(owner, menuId) { if (menus.get(menuId)?.owner === owner) { menus.delete(menuId); for (const key of actions.keys()) if (key.startsWith(menuId + '/')) actions.delete(key); } },
    onAction(owner, menuId, actionId, handler, options) { actions.set(menuId + '/' + actionId, { handler, options }); },
    openMenu: (target, menuId, state) => opened.push({ target, menuId, state }), closeMenu() {}, notify: (target, message) => notices.push({ target, message }),
  };
  return { api, widgets, menus, actions, updates, opened, notices };
}
function fakeChat() {
  const commands = new Map();
  return { commands, api: { apiVersion: 1, extensions: { commands: 1 },
    registerCommand(def) { if (commands.has(def.name)) throw Error('Command collision'); commands.set(def.name, def); },
    unregisterCommand(owner, name) { if (commands.get(name)?.owner === owner) commands.delete(name); },
  } };
}
function temporary() {
  const parent = path.join(root, 'artifacts'); fs.mkdirSync(parent, { recursive: true });
  const directory = fs.mkdtempSync(path.join(parent, 'jobs-fixture-'));
  return { directory, remove() {
    const relative = path.relative(parent, path.resolve(directory));
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !path.basename(directory).startsWith('jobs-fixture-')) throw Error('Unsafe cleanup path');
    fs.rmSync(directory, { recursive: true, force: true });
  } };
}
const settled = () => new Promise(resolve => setImmediate(resolve));
async function settle() { for (let i = 0; i < 6; i++) await settled(); }
function runtimeFixture({ config = { chat: false, ui: false }, host, ui, chat, core = fakeCore() } = {}) {
  const temp = temporary(), folder = path.join(temp.directory, 'Plugins/SkyMPJobs'); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, 'config.json'), JSON.stringify(config));
  const timers = new Set(), logs = [], fakeProcess = new EventEmitter(); let now = 0;
  fakeProcess.cwd = () => temp.directory;
  const context = vm.createContext({ require(name) { if (!name.startsWith('node:')) throw Error('Unexpected runtime dependency: ' + name); return require(name); },
    module: { exports: {} }, exports: {}, Buffer, process: fakeProcess, AbortController, structuredClone, mp: core.mp,
    skympJobsHost: host, skympUi: ui, skympChat: chat,
    performance: { now: () => now }, console: Object.fromEntries(['info', 'warn', 'error', 'log'].map(k => [k, (...args) => logs.push(args.join(' '))])),
    setInterval(callback) { const timer = { callback, unref() {} }; timers.add(timer); return timer; }, clearInterval(timer) { timers.delete(timer); },
  });
  const execute = () => vm.runInContext(fs.readFileSync(path.join(root, 'build/Plugins/SkyMPJobs/index.cjs'), 'utf8'), context, { filename: 'requireTemp-copy.js' });
  const handle = () => vm.runInContext('globalThis[Symbol.for("skymp-plugin-sdk.runtime.skymp-jobs.v1")]', context);
  try { execute(); } catch (error) { temp.remove(); throw error; }
  return { ...core, context, timers, logs, execute, handle, temp,
    async tick(ms = 1000) { now += ms; for (const timer of [...timers]) timer.callback(); await settle(); },
    async close() { handle()?.stop(); await settle(); temp.remove(); },
  };
}
module.exports = { fakeCore, fakeUi, fakeChat, temporary, settle, runtimeFixture };
