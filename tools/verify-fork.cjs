'use strict';
// Execute current local loader helpers and provider sources with a native API fixture.
// No server build, native addon, database, browser or foreign-repository writes.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const assert = require('node:assert/strict'), { createRequire } = require('node:module');
const ts = require('typescript'), esbuild = require('esbuild');
const { temporary, fakeCore, settle } = require('../tests/runtime-harness.cjs');
const root = path.resolve(__dirname, '..'), parent = path.resolve(process.argv[2] || path.join(root, '..'));
const fork = path.join(parent, 'skymp');
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const transpile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
async function bundle(filename) {
  const result = await esbuild.build({ entryPoints: [filename], bundle: true, platform: 'node', format: 'cjs', write: false, logLevel: 'silent' });
  const mod = { exports: {} }; new Function('require', 'module', 'exports', result.outputFiles[0].text)(createRequire(filename), mod, mod.exports); return mod.exports;
}
function loadState() {
  const filename = path.join(fork, 'skymp5-server/ts/pluginDiscoveryState.ts'), mod = { exports: {} };
  new Function('require', 'module', 'exports', transpile(fs.readFileSync(filename, 'utf8')))(createRequire(filename), mod, mod.exports); return mod.exports;
}
function loader(state, publication, statuses, logs) {
  const filename = path.join(fork, 'skymp5-server/ts/index.ts'), source = fs.readFileSync(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const wanted = new Set(['pluginsLog', 'pluginsWarn', 'pluginsError', 'SAFE_PLUGIN_NAME_RE', 'SAFE_VERSION_RE', 'toAbsolutePath',
    'getAlternativeNtfsAliasPath', 'resolveExistingPath', 'sha256', 'ensureMainPath', 'isRelativePathSafe', 'readPluginManifest',
    'fingerprintPlugin', 'discoverPlugins', 'buildPluginSortOrder', 'requireTemp', 'runGamemodePlugin', 'bootstrapPlugins']);
  const selected = [];
  for (const node of ast.statements) {
    const names = ts.isFunctionDeclaration(node) && node.name ? [node.name.text] : ts.isVariableStatement(node) ? node.declarationList.declarations.map(d => d.name.getText(ast)) : [];
    if (names.some(name => wanted.has(name))) { selected.push(node.getFullText(ast)); names.forEach(name => wanted.delete(name)); }
  }
  assert.equal(wanted.size, 0, 'Loader changed; reaudit helpers: ' + [...wanted]);
  const allowedTempDirectories = new Set();
  const guardedFs = { ...fs,
    mkdtempSync(prefix) { assert.equal(prefix, path.join(os.tmpdir(), 'skymp5-server')); const directory = fs.mkdtempSync(prefix); allowedTempDirectories.add(path.resolve(directory)); return directory; },
    rmSync(directory, options) { const resolved = path.resolve(directory); assert.ok(allowedTempDirectories.has(resolved), 'Unexpected loader cleanup target'); fs.rmSync(resolved, options); allowedTempDirectories.delete(resolved); },
  };
  const bindings = { fs: guardedFs, path, os, crypto, require, process,
    console: Object.fromEntries(['log', 'warn', 'error'].map(level => [level, (...args) => logs.push(args.join(' '))])),
    ui: { updatePluginRuntimeStatus: (name, status) => statuses.set(name, status) },
    readDiscoveryState: state.readDiscoveryState, writeDiscoveryState: state.writeDiscoveryState, PLUGINS_DIR: state.PLUGINS_DIR,
    installShutdownHooks() {}, askToEnablePlugin() { throw Error('Unexpected interactive prompt'); }, runProcessPlugin() { throw Error('Unexpected process plugin'); },
    publishPluginRuntimeSelection: publication.publishPluginRuntimeSelection, publishStartedPluginRuntime: publication.publishStartedPluginRuntime, validatePluginRuntime: publication.validatePluginRuntime,
  };
  return { ...new Function(...Object.keys(bindings), transpile(selected.join('\n')) + '\nreturn { readPluginManifest, discoverPlugins, bootstrapPlugins };')(...Object.values(bindings)),
    assertTempClean: () => assert.equal(allowedTempDirectories.size, 0) };
}
async function main() {
  const temp = temporary(), before = process.cwd(), core = fakeCore(), logs = [], statuses = new Map();
  const keys = ['mp', 'skympJobs', 'skympJobsHost', 'skympUi', 'skympChat', 'skympChatReady', Symbol.for('skymp-jobs-example.resource.v1'), Symbol.for('skymp-jobs-consumer.v1')];
  const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let controls, ui, chat;
  try {
    fs.cpSync(path.join(root, 'build/Plugins/SkyMPJobs'), path.join(temp.directory, 'Plugins/SkyMPJobs'), { recursive: true });
    for (const name of ['SkyMPJobsExample', 'SkyMPJobsConsumer']) fs.cpSync(path.join(root, 'examples', name), path.join(temp.directory, 'Plugins', name), { recursive: true });
    fs.writeFileSync(path.join(temp.directory, 'Plugins/SkyMPJobs/config.json'), JSON.stringify({ ui: true, chat: true }));
    process.chdir(temp.directory); globalThis.mp = core.mp;
    globalThis.skympJobsHost = { apiVersion: 1, onReady: c => { controls = c; } };
    const state = loadState(), publication = await bundle(path.join(fork, 'skymp5-server/ts/pluginRuntimePackages.ts'));
    const actual = loader(state, publication, statuses, logs);
    const settings = { dataDir: path.join(temp.directory, 'data'), mode: 'safe', loadOrder: ['skymp-jobs', 'skymp-jobs-example', 'skymp-jobs-consumer'], abortOnPluginError: true, processCommandAllowlist: [] };
    assert.equal(actual.discoverPlugins().length, 3);
    await actual.bootstrapPlugins(core.mp, settings);
    assert.equal(globalThis.skympJobs, undefined); assert.ok([...statuses.values()].every(s => s === 'stopped'));
    const discovery = state.readDiscoveryState(); for (const entry of Object.values(discovery.plugins)) entry.startupEnabled = true;
    state.writeDiscoveryState(discovery);
    await actual.bootstrapPlugins(core.mp, settings); actual.assertTempClean();
    assert.equal(controls.api, globalThis.skympJobs); assert.equal(controls.api.getJob('example-worker').owner, 'skymp-jobs-example');
    assert.ok([...statuses.values()].every(s => s === 'running')); assert.ok(!logs.some(s => s.includes('Error:')), logs.join('\n'));
    // Instantiate actual providers after Jobs to exercise late discovery as well as production payload validation.
    const uiProvider = await bundle(path.join(parent, 'SkyMP-UI-Core/src/runtime.ts'));
    ui = uiProvider.createUiCore(core.mp, { autoFlush: false, chatGlobals: globalThis }); globalThis.skympUi = ui.api;
    const chatProvider = require(path.join(parent, 'SkyMP-Chat/Plugins/SkyMPChat/src/runtime.cjs'));
    chat = chatProvider.createChat(core.mp, { globals: globalThis, config: { showJoinMessages: false } }); globalThis.skympChat = chat.api;
    core.connect(1, 101); core.connect(2, 102);
    const receive = (userId, packet) => core.emit('customPacket', userId, JSON.stringify(packet));
    for (const userId of [1, 2]) {
      receive(userId, { customPacketType: 'skympChat:ready' });
      receive(userId, { customPacketType: 'skympUi:ready', protocolVersion: 1, frontId: 'jobs-fixture-' + userId });
    }
    await new Promise(resolve => setTimeout(resolve, 1150)); await settle();
    const session = controls.currentSession(1), other = controls.currentSession(2); assert.ok(session && other); assert.notEqual(session.characterId, other.characterId);
    const admin = controls.provisionResource('fork-fixture-controller', { manageJobs: ['example-worker'], manageProfessions: ['example-trade'], experience: [{ professionId: 'example-trade', sources: ['verified-task'] }] });
    await admin.assignJob(session.characterId, 'example-worker'); await admin.learnProfession(session.characterId, 'example-trade');
    await admin.addExperience(session.characterId, 'example-trade', { source: 'verified-task', eventId: 'actual-source-check', amount: 100 });
    receive(1, { customPacketType: 'skympChat:send', requestId: 'jobs-command-1', text: '/duty example-worker on' }); await settle();
    assert.equal((await controls.api.getDuty(session.characterId, 'example-worker')).onDuty, true);
    assert.ok(core.sent.some(p => p.userId === 1 && p.customPacketType === 'skympChat:message' && p.message?.text === 'Dienst begonnen.'));
    await new Promise(resolve => setTimeout(resolve, 1100)); await settle(); ui.flush();
    const frames = core.sent.filter(p => p.customPacketType === 'skympUi:update' || p.customPacketType === 'skympUi:snapshot');
    assert.ok(frames.some(p => p.userId === 1 && p.widgets?.some(w => w.definition.id === 'skymp-jobs:status' && w.state.items.some(i => i.label === 'Beispielberuf'))), 'Actual UI protocol must contain Jobs widget');
    assert.ok(frames.some(p => p.userId === 1 && p.menus?.some(m => m.definition.id === 'skymp-jobs:overview' && m.state.actions.some(a => a.id === 'stop'))), 'Actual UI protocol must offer stop duty');
    assert.ok(!frames.some(p => p.userId === 2 && p.widgets?.some(w => w.state.items?.some(i => i.label === 'Beispielberuf'))), 'Private Jobs snapshot must not leak to another character');
    const first = frames.find(p => p.userId === 1);
    receive(1, { customPacketType: 'skympUi:action', protocolVersion: 1, widgetId: 'skymp-jobs:overview', actionId: 'stop', requestId: first.sessionId + '_1', payload: {} });
    await settle(); assert.equal((await controls.api.getDuty(session.characterId, 'example-worker')).onDuty, false);
    assert.ok(core.sent.some(p => p.userId === 1 && p.customPacketType === 'skympUi:ack' && p.accepted));
    assert.equal(core.mp.onEatItem, undefined); assert.ok(core.records.get(101)['private.skympJobs']);
    globalThis[Symbol.for('skymp-jobs-consumer.v1')].stop(); await globalThis[Symbol.for('skymp-jobs-example.resource.v1')].stop();
    await controls.shutdown(); globalThis[Symbol.for('skymp-plugin-sdk.runtime.skymp-jobs.v1')].stop();
    assert.equal(globalThis.skympJobs, undefined); assert.equal(chat.api.getCommandsForPlayer(1).some(c => c.owner === 'skymp-jobs'), false);
    ui.api.registerWidget({ id: 'skymp-jobs:status', owner: 'skymp-jobs', kind: 'text', schemaVersion: 1 }); ui.api.unregisterWidget('skymp-jobs', 'skymp-jobs:status');
    const sources = ['skymp/skymp5-server/ts/index.ts', 'skymp/skymp5-server/ts/pluginDiscoveryState.ts', 'skymp/skymp5-server/ts/pluginRuntimePackages.ts',
      'skymp/skymp5-server/ts/consoleSecurity.ts', 'skymp/skymp5-server/cpp/server_guest_lib/database_drivers/MariaDbDatabase.cpp',
      'SkyMP-UI-Core/shared/contracts.ts', 'SkyMP-UI-Core/src/runtime.ts', 'SkyMP-Chat/Plugins/SkyMPChat/api.d.ts', 'SkyMP-Chat/Plugins/SkyMPChat/src/runtime.cjs'];
    const report = { success: true, date: new Date().toISOString(), sources: Object.fromEntries(sources.map(name => [name, digest(fs.readFileSync(path.join(parent, name)))])),
      entrySha256: digest(fs.readFileSync(path.join(root, 'build/Plugins/SkyMPJobs/index.cjs'))),
      checks: ['actual safe discovery and persisted activation', 'explicit load order', 'requireTemp self-contained entries', 'standalone registration and consumer',
        'late actual UI/Chat providers', 'actual typed Chat duty command', 'actual UI widget/menu/action protocol', 'two-character private snapshots', 'scoped cleanup'],
      nativeAddon: false, mariaDb: false, skyrimCef: false, vps: false };
    fs.writeFileSync(path.join(root, 'artifacts/fork-validation.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('Actual local loader/UI/Chat checks passed. Report: artifacts/fork-validation.json');
  } finally {
    try { globalThis[Symbol.for('skymp-jobs-consumer.v1')]?.stop(); await globalThis[Symbol.for('skymp-jobs-example.resource.v1')]?.stop(); await controls?.shutdown(); }
    finally {
      globalThis[Symbol.for('skymp-plugin-sdk.runtime.skymp-jobs.v1')]?.stop(); chat?.stop(); ui?.stop();
      process.chdir(before); for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
      temp.remove();
    }
  }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
