'use strict';
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const esbuild = require('esbuild');
const root = path.resolve(__dirname, '..');
async function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'plugin.json'), 'utf8'));
  if (pkg.name !== manifest.name || pkg.version !== manifest.version || manifest.kind !== 'gamemode' || manifest.main !== 'index.cjs') throw Error('Package/manifest identity mismatch');
  const out = path.join(root, 'build', 'Plugins', 'SkyMPJobs'); fs.mkdirSync(out, { recursive: true });
  const flags = { bundle: true, platform: 'node', format: 'cjs', target: 'node20', charset: 'utf8', legalComments: 'inline', banner: { js: '// SkyMP-Jobs; GPL-3.0-only; implementation 2026-11-04. See LICENSE.' } };
  await esbuild.build({ ...flags, entryPoints: [path.join(root, 'src/index.ts')], outfile: path.join(out, 'index.cjs') });
  await esbuild.build({ ...flags, entryPoints: [path.join(root, 'src/library.ts')], outfile: path.join(root, 'dist/library.cjs') });
  const declared = cp.spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--emitDeclarationOnly'], { cwd: root, encoding: 'utf8' });
  if (declared.status !== 0) throw Error(declared.stdout + declared.stderr);
  // tsc does not emit/copy .d.ts inputs. Preserve the SDK consumer declarations explicitly.
  fs.cpSync(path.join(root, 'vendor/sdk/api'), path.join(root, 'dist/types/vendor/sdk/api'), { recursive: true });
  for (const file of ['plugin.json', 'LICENSE']) fs.copyFileSync(path.join(root, file), path.join(out, file));
  fs.writeFileSync(path.join(out, 'README.md'), '> Entpackter lokaler Plugin-Build. npm-Befehle gelten für das Quellrepository; zur Serverinstallation siehe docs/INSTALLATION.md.\n\n' + fs.readFileSync(path.join(root, 'README.md'), 'utf8'));
  // Never ship an operator config.json: copying this build over an installation preserves its configuration.
  fs.copyFileSync(path.join(root, 'config/config.example.json'), path.join(out, 'config.example.json'));
  const types = path.join(out, 'types'); fs.mkdirSync(types, { recursive: true });
  fs.cpSync(path.join(root, 'dist/types/src'), path.join(types, 'src'), { recursive: true });
  fs.cpSync(path.join(root, 'dist/types/vendor'), path.join(types, 'vendor'), { recursive: true });
  fs.copyFileSync(path.join(root, 'docs/INSTALLATION.md'), path.join(out, 'INSTALLATION.md'));
  fs.cpSync(path.join(root, 'docs'), path.join(out, 'docs'), { recursive: true });
  fs.cpSync(path.join(root, 'examples'), path.join(out, 'examples'), { recursive: true });
  const hostExample = path.join(out, 'examples/host-bootstrap.ts');
  fs.writeFileSync(hostExample, fs.readFileSync(hostExample, 'utf8').replaceAll("'../src/", "'../types/src/"));
  const consumerTypes = cp.spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--esModuleInterop', '--target', 'ES2022', '--module', 'CommonJS', '--moduleResolution', 'node', hostExample], { cwd: root, encoding: 'utf8' });
  if (consumerTypes.status !== 0) throw Error('Packaged consumer declarations failed: ' + consumerTypes.stdout + consumerTypes.stderr);
  const checksums = ['index.cjs', 'plugin.json', 'config.example.json', 'LICENSE'].map(file => `${crypto.createHash('sha256').update(fs.readFileSync(path.join(out, file))).digest('hex')}  ${file}`).join('\n');
  fs.writeFileSync(path.join(out, 'SHA256SUMS.txt'), checksums + '\n');
  console.log(`Local build: ${out}`);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
