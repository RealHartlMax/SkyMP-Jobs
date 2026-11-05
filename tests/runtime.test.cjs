'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { runtimeFixture, fakeUi, fakeChat, settle } = require('./runtime-harness.cjs');
const { parseConfig, attachJobsUi, attachJobsChat } = require('../dist/library.cjs');
const { setup, job, profession } = require('./helpers.cjs');
test('configuration is strict and command names must be unique', () => {
  for (const raw of [{ maxJobs: 0 }, { ui: 'yes' }, { unknown: true }, { identity: 'host', persistence: 'native' }, { commands: { job: 'same', jobs: 'same' } }, { commands: { duty: '../bad' } }]) assert.throws(() => parseConfig(raw));
});
test('bundled gamemode starts without optional dependencies, binds native characters and stops cleanly', async () => {
  let controls; const f = runtimeFixture({ host: { apiVersion: 1, onReady: c => { controls = c; } } });
  try {
    assert.equal(f.context.skympJobs.apiVersion, 1); assert.equal(controls.api.status.persistence, 'core-private-changeform');
    f.connect(); await f.tick(); const session = controls.currentSession(1); assert.ok(session);
    const r = controls.provisionResource('runtime-job', { manageJobs: ['worker'] }); r.registerJob(job('worker', { owner: 'runtime-job' }));
    await r.assignJob(session.characterId, 'worker'); await controls.setPlayerDuty(session, 'worker', true); await f.tick(1000);
    f.disconnect(); await settle(); assert.equal((await controls.api.getDuty(session.characterId, 'worker')).onDuty, false);
    assert.ok(f.records.get(101)['private.skympJobs']); assert.equal(f.mp.onEatItem, undefined);
    assert.throws(() => f.execute(), /already running/);
    f.handle().stop(); await settle(); assert.equal(f.context.skympJobs, undefined); assert.equal(f.timers.size, 0);
    assert.equal(f.logs.some(v => v.includes('Ready API=1')), true);
  } finally { await f.close(); }
});
test('late optional discovery attaches API v1; command collisions are preserved and cleanup is scoped', async () => {
  const ui = fakeUi(), chat = fakeChat(); chat.commands.set('jobs', { owner: 'foreign' });
  let controls; const f = runtimeFixture({ config: { chat: true, ui: true }, host: { apiVersion: 1, onReady: c => { controls = c; } } });
  try {
    f.connect(); await f.tick(); f.context.skympUi = ui.api; f.context.skympChat = chat.api; await f.tick();
    assert.equal(ui.widgets.size, 1); assert.equal(chat.commands.get('jobs').owner, 'foreign'); assert.equal(chat.commands.get('job').owner, 'skymp-jobs');
    assert.equal(ui.updates.at(-1).target.userId, 1); assert.equal(ui.opened.length > 0, true); assert.ok(controls.currentSession(1));
    assert.ok(f.logs.some(v => v.includes('Kollision')));
    f.handle().stop(); await settle(); assert.equal(ui.widgets.size, 0); assert.equal(ui.actions.size, 0);
    assert.equal(chat.commands.size, 1); assert.equal(chat.commands.get('jobs').owner, 'foreign');
  } finally { await f.close(); }
});
test('UI actions are own-character only, offered actions are checked and stale sessions are refused', async () => {
  const h = setup(); h.resource.registerJob(job()); h.resource.registerJob(job('second')); h.resource.registerProfession(profession());
  await h.resource.assignJob('c', 'worker'); await h.resource.assignJob('c', 'second'); await h.resource.learnProfession('c', 'craft');
  const session = await h.activate('c'), ui = fakeUi(), integration = attachJobsUi(ui.api, h.controls);
  try {
    await integration.publish(session); assert.match(ui.opened.at(-1).state.text, /Rang/);
    const start = ui.actions.get('skymp-jobs:overview/start');
    const action = { userId: 1, actorId: session.actorId, actionId: 'start', widgetId: 'skymp-jobs:overview', payload: {}, signal: new AbortController().signal, requestId: '1' };
    assert.equal(start.options.authorize({ ...action, payload: { roles: ['admin'] } }), false);
    assert.equal(start.options.authorize({ ...action, userId: 2 }), false);
    assert.equal(start.options.authorize(action), true); await start.handler(action);
    assert.equal((await h.api.getDuty('c', 'worker')).onDuty, true); assert.equal(start.options.authorize(action), false); // Start no longer offered.
    const old = { ...action, actionId: 'stop' }; await h.activate('other'); assert.equal(ui.actions.get('skymp-jobs:overview/stop').options.authorize(old), false);
  } finally { integration.dispose(); }
});
test('UI navigation reaches profession XP and every job; client payload cannot select another target', async () => {
  const h = setup(); h.resource.registerJob(job()); h.resource.registerJob(job('second')); h.resource.registerProfession(profession());
  await h.resource.assignJob('c', 'worker'); await h.resource.assignJob('c', 'second'); await h.resource.learnProfession('c', 'craft');
  const s = await h.activate('c'), ui = fakeUi(), integration = attachJobsUi(ui.api, h.controls);
  try {
    await integration.show(s); const next = ui.actions.get('skymp-jobs:overview/next');
    const action = { userId: 1, actorId: s.actorId, actionId: 'next', payload: {}, signal: new AbortController().signal };
    await next.handler(action); assert.match(ui.opened.at(-1).state.text, /2\/3/);
    const primary = ui.actions.get('skymp-jobs:overview/primary'); await primary.handler({ ...action, actionId: 'primary' });
    assert.equal((await h.api.getCharacter('c')).primaryJobId, 'second');
    await next.handler(action); assert.match(ui.opened.at(-1).state.text, /Erfahrung: 0 XP/);
  } finally { integration.dispose(); }
});
test('Chat configurable commands only change the current character and refuse stale/aborted commands', async () => {
  const h = setup(); h.resource.registerJob(job()); await h.resource.assignJob('c', 'worker'); const s = await h.activate('c'), chat = fakeChat();
  const detach = attachJobsChat(chat.api, h.controls, parseConfig({ commands: { duty: 'dienst' } }), async () => {}, () => {});
  const replies = [], errors = [], command = { userId: 1, actorId: s.actorId, signal: new AbortController().signal, isCurrent: () => true, parameters: { state: 'on' }, reply: x => replies.push(x), error: x => errors.push(x) };
  try {
    assert.equal(chat.commands.has('duty'), false); await chat.commands.get('dienst').execute(command);
    assert.equal((await h.api.getDuty('c', 'worker')).onDuty, true);
    await chat.commands.get('dienst').execute({ ...command, isCurrent: () => false, parameters: { state: 'off' } }); assert.equal((await h.api.getDuty('c', 'worker')).onDuty, true);
    await chat.commands.get('dienst').execute({ ...command, parameters: { job: 'foreign', state: 'on' } }); assert.ok(errors.length > 0);
    assert.equal(replies.includes('Dienst begonnen.'), true);
  } finally { detach(); }
});
test('standalone registration resource and external consumer work with the public API', async () => {
  const h = setup(), context = vm.createContext({ skympJobs: h.api, module: { exports: {} } });
  // Each requireTemp entry has its own wrapper scope, as the loader does.
  function loadExample(name) { context.module = { exports: {} }; vm.runInContext('(function(){' + fs.readFileSync(path.join(__dirname, '../examples', name, 'index.cjs'), 'utf8') + '\n})()', context); return context.module.exports; }
  const registration = loadExample('SkyMPJobsExample'), consumer = loadExample('SkyMPJobsConsumer');
  assert.equal(h.api.getJob('example-worker').owner, 'skymp-jobs-example'); assert.equal(await consumer.canUseWorkshop('c'), false);
  const controller = h.controls.provisionResource('example-controller', { manageJobs: ['example-worker'], manageProfessions: ['example-trade'], experience: [{ professionId: 'example-trade', sources: ['verified-task'] }] });
  await controller.assignJob('c', 'example-worker'); await controller.learnProfession('c', 'example-trade');
  await controller.addExperience('c', 'example-trade', { source: 'verified-task', eventId: 'server-task-1', amount: 100 });
  await h.activate('c'); await controller.setDuty('c', 'example-worker', true);
  assert.equal(await consumer.canUseWorkshop('c'), true); assert.ok(consumer.observedEvents > 0);
  consumer.stop(); await registration.stop(); assert.equal(await consumer.canUseWorkshop('c'), false); assert.equal(h.api.getJob('example-worker'), null);
});
