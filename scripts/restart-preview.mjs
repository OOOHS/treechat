// Run from the user's own terminal when the task executor cannot manage servers.
import {readFile,writeFile,realpath,open,mkdir} from 'node:fs/promises';
import {execFileSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
import {launchEnvironment,checkCredentials} from './credentials.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const home=join(root,'.runtime/native-home');
const port=3082;
const runtime=await realpath(process.env.DSH_RUNTIME||join(home,'profiles/web/node_modules/@deepseek-ai/dsh'));
const manifest=JSON.parse(await readFile(join(runtime,'package.json'),'utf8'));
if(manifest.version!=='0.2.1-alpha.2')throw new Error(`不匹配的 DSH 版本：${manifest.version}`);
const launchEnv=await launchEnvironment();
const credentialSource=await checkCredentials({runtime,root,home,env:launchEnv});
if(process.argv.includes('--check')) {
  console.log(`预检通过：DSH ${manifest.version}，端口 ${port}，凭据来源 ${credentialSource}，沿用现有会话目录。`);
  process.exit(0);
}

function listeners() {
  try {
    return execFileSync('/usr/sbin/lsof',['-nP',`-iTCP:${port}`,'-sTCP:LISTEN','-t'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})
      .trim().split(/\s+/).filter(Boolean).map(Number);
  }catch(e){if(e.status===1)return [];throw e;}
}
const pids=[...new Set(listeners())];
// Only stop this development instance: both command and actual working directory
// must match. Never stop an arbitrary service just because it uses our port.
for(const pid of pids) {
  const command=execFileSync('/bin/ps',['-p',String(pid),'-o','command='],{encoding:'utf8'}).trim();
  const cwd=execFileSync('/usr/sbin/lsof',['-a','-p',String(pid),'-d','cwd','-Fn'],{encoding:'utf8'})
    .split('\n').find(line=>line.startsWith('n'))?.slice(1);
  if(!command.includes(join(runtime,'lib/bin.js'))||!cwd||await realpath(cwd)!==await realpath(root)) {
    throw new Error(`端口 ${port} 由其他程序占用，已停止操作；没有结束该程序。`);
  }
}
for(const pid of pids) {console.log(`正在关闭 TreeChat 预览进程 ${pid}…`);process.kill(pid,'SIGTERM');}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
for(let i=0;listeners().length&&i<80;i++)await pause(100);
if(listeners().length)throw new Error('旧预览仍未退出，未强制终止，也未启动第二个实例。');

await mkdir(join(root,'.runtime'),{recursive:true});
const log=join(root,'.runtime',`native-service-${Date.now()}.log`);
const handle=await open(log,'wx');
let child;
try {
  child=spawn(process.execPath,[join(root,'scripts/dev.mjs')],{
    cwd:root,detached:true,stdio:['ignore',handle.fd,handle.fd],
    env:{...launchEnv,DSH_RUNTIME:runtime,TREECHAT_HOME:home,PORT:String(port),TREECHAT_MOCK:'0'}
  });
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
}finally{await handle.close();}
child.unref();
await writeFile(join(root,'.runtime/native-process.json'),JSON.stringify({pid:child.pid,port,log},null,2));
console.log('正在加载修复后的 TreeChat，聊天记录沿用原目录…');
for(let i=0;i<300;i++) {
  const output=await readFile(log,'utf8');
  const url=output.match(/dsh web:\s*(http:\/\/127\.0\.0\.1:3082\/\S*)/)?.[1];
  if(url){console.log(`重启成功，打开：\n${url}`);process.exit(0);}
  if(output.includes('startup failed'))throw new Error(`DSH 启动失败，日志：${log}`);
  await pause(100);
}
console.log(`服务仍在启动，日志：${log}`);
