import {readFile, stat} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseEnv} from 'node:util';

// Use the same launch environment for preflight and the child process.
export async function launchEnvironment(env = process.env) {
  const result = {...env};
  if (env.TREECHAT_ENV_FILE) {
    try { Object.assign(result, parseEnv(await readFile(resolve(env.TREECHAT_ENV_FILE), 'utf8'))); }
    catch { throw new Error('TREECHAT_ENV_FILE 读取失败，请检查指定文件。'); }
  }
  return result;
}

async function optionalRead(path) {
  try { return await readFile(path, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return ''; throw new Error('凭据预检读取失败，请检查配置文件访问权限。'); }
}

// This preview uses the deepseek-official route and its default credential ref.
// Resolve only known launch locations; never search other user directories.
export async function checkCredentials({runtime, root, home, env}) {
  const ref = 'DEEPSEEK_API_KEY';
  if (typeof env[ref] === 'string' && env[ref].length) return 'launch-environment';
  const filename = join(home, '.credentials.yaml');
  const text = await optionalRead(filename);
  if (text) {
    const mode = (await stat(filename)).mode;
    if (process.platform !== 'win32' && (mode & 0o077)) throw new Error('凭据存储需要仅所有者可读写（0600），请检查 native-home/.credentials.yaml。');
    const require = createRequire(join(runtime, 'package.json'));
    const {parseCredentialsDocument} = await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-credentials-local')).href);
    let stored;
    try { stored = parseCredentialsDocument(text, filename); }
    catch { throw new Error('凭据存储格式校验失败，请通过 DSH 模型设置修复。'); }
    if (stored.refs.get(ref)?.length) return 'credential-store';
  }
  for (const [directory, source] of [[root, 'project-env'], [home, 'profile-env']]) {
    let fallback;
    try { fallback = parseEnv(await optionalRead(join(directory, '.env'))); }
    catch { throw new Error('凭据 .env 读取失败，请检查配置。'); }
    if (fallback[ref]?.length) return source;
  }
  throw new Error('MISSING_CREDENTIAL：预览缺少 DEEPSEEK_API_KEY。请在 3082 的设置 > 模型保存现有密钥，或通过 TREECHAT_ENV_FILE 提供。当前服务保持运行。');
}
