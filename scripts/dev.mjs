import { mkdir, writeFile, symlink, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {launchEnvironment,checkCredentials} from './credentials.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const runtime = process.env.DSH_RUNTIME ? resolve(process.env.DSH_RUNTIME) : dirname(require.resolve('@deepseek-ai/dsh/package.json'));
const manifest = JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8'));
if (manifest.version !== '0.2.1-alpha.2') throw new Error(`TreeChat dev harness currently verifies DSH 0.2.1-alpha.2; found ${manifest.version}`);
const home = process.env.TREECHAT_HOME ? resolve(process.env.TREECHAT_HOME) : join(root, '.runtime/home');
const launchEnv = await launchEnvironment();
if (process.env.TREECHAT_MOCK !== '1') await checkCredentials({runtime,root,home,env:launchEnv});
const profile = join(home, 'profiles/web');
await mkdir(join(profile, 'node_modules'), { recursive:true });
async function link(target, path) { try { await symlink(target, path, 'dir'); } catch(e) { if(e.code !== 'EEXIST') throw e; } }
await link(dirname(runtime), join(profile, 'node_modules/@deepseek-ai'));
await link(root, join(profile, 'node_modules/dsh-treechat'));
await writeFile(join(profile, 'package.json'), JSON.stringify({ name:'treechat-dev', private:true,
  dependencies:{ 'dsh-treechat':`file:${root}` }, dsh:{ profile:{ bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app','dsh-treechat'] } } }, null, 2));
// The profile is nested below this development package. Watching it recursively
// would follow the profile's link back to the package. Rebuild/reload explicitly.
// Preserve existing profile settings when restarting the preview.
try {
  await writeFile(join(profile, 'cordis.patch.yml'), '- id: hmr\n  disabled: true\n- id: client-hmr\n  disabled: true\n', {flag:'wx'});
} catch(e) { if(e.code!=='EEXIST')throw e; }
const env = { ...launchEnv, DSH_HOME:home, DSH_AGENTS_HOME:join(root,'.runtime/agents'), DSH_TELEMETRY_DISABLED:'1' };
const args = process.argv.slice(2);
const overlays = process.env.TREECHAT_DEV_PATCH ? ['--patch', resolve(process.env.TREECHAT_DEV_PATCH)] : [];
if(process.env.TREECHAT_MOCK === '1') {
  const patch=join(root,'.runtime/mock.patch.yml');
  await writeFile(patch, `- insert:\n  - id: treechat-test-model\n    name: ${JSON.stringify(join(root,'test-support/mock-model.mjs'))}\n`);
  overlays.push('--patch',patch);
  env.TREECHAT_TEST_LOG=join(root,'.runtime/model-requests.jsonl');
  console.log('TreeChat: TEST MODEL enabled. This is not a live model response.');
}
const child = spawn(process.execPath, [join(runtime,'lib/bin.js'), '--profile', 'web', ...overlays, '--port', process.env.PORT || '3081', '--no-open', ...args], { cwd:root, env, stdio:'inherit' });
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => child.kill(signal));
child.once('error', e => { console.error(e.message); process.exitCode=1; });
child.once('exit', code => { process.exitCode=code ?? 1; });
