const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtemp,writeFile,rm,mkdir}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');

async function fixture(t) {
  const root=await mkdtemp(join(tmpdir(),'treechat-credentials-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  const home=join(root,'home'); await mkdir(home);
  const runtime=process.env.DSH_TEST_ROOT&&join(process.env.DSH_TEST_ROOT,'node_modules/@deepseek-ai/dsh');
  const api=await import('../scripts/credentials.mjs');
  return {...api,root,home,runtime,env:{}};
}
test('missing credential fails closed before restart; unrelated records do not count',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.checkCredentials(f),/MISSING_CREDENTIAL/);
  if(!f.runtime)return;
  await writeFile(join(f.home,'.credentials.yaml'),'version: 1\nrefs: {}\nrecords: {}\n',{mode:0o600});
  await assert.rejects(f.checkCredentials(f),/MISSING_CREDENTIAL/);
});
test('launch file and inherited environment are available to both launch and preflight',async t=>{
  const f=await fixture(t);
  const path=join(f.root,'launch.env'); await writeFile(path,'DEEPSEEK_API_KEY=synthetic-test-value\n');
  f.env=await f.launchEnvironment({TREECHAT_ENV_FILE:path});
  assert.equal(await f.checkCredentials(f),'launch-environment');
  await writeFile(path,'OTHER=value\n');
  await assert.rejects(f.checkCredentials({...f,env:await f.launchEnvironment({TREECHAT_ENV_FILE:path})}),/MISSING_CREDENTIAL/);
});
test('known dotenv fallbacks follow project then profile order and ignore empty values',async t=>{
  const f=await fixture(t);
  await writeFile(join(f.home,'.env'),'DEEPSEEK_API_KEY=synthetic-profile\n');
  await writeFile(join(f.root,'.env'),'DEEPSEEK_API_KEY=\n');
  assert.equal(await f.checkCredentials(f),'profile-env');
  await writeFile(join(f.root,'.env'),'DEEPSEEK_API_KEY=synthetic-project\n');
  assert.equal(await f.checkCredentials(f),'project-env');
});
test('installed DSH parser reads stored reference and sanitizes invalid credential diagnostics',{skip:!process.env.DSH_TEST_ROOT},async t=>{
  const f=await fixture(t),path=join(f.home,'.credentials.yaml');
  await writeFile(path,'version: 1\nrefs:\n  DEEPSEEK_API_KEY: synthetic-store\n',{mode:0o600});
  assert.equal(await f.checkCredentials(f),'credential-store');
  await writeFile(path,'version: 1\nrefs: [synthetic-secret]\n');
  await assert.rejects(f.checkCredentials(f),e=>/格式/.test(e.message)&&!e.message.includes('synthetic-secret'));
});
