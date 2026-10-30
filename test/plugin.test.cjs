const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const {pathToFileURL}=require('node:url');

test('browser bundle is lazy and has only the two baseline React imports',()=>{
  let entry;
  const context={window:{__ModuleLoader__:{load:e=>{entry=e;}}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/client.js'),'utf8'),context);
  assert.equal(entry.id,'dsh-treechat');
  const imports=[];
  const plugin=entry.factory(id=>{imports.push(id);return id==='react'?{createElement(){}}:{createPortal(){}};});
  assert.deepEqual(imports,['react','react-dom']);
  assert.equal(typeof plugin.apply,'function');
  assert.ok(plugin.inject.includes('sessions'));
  assert.ok(plugin.inject.includes('remote.session'), 'Cordis requires the nested remote service to be explicitly injected');
});

test('registrations satisfy the installed DSH SlotCore contracts', {skip:!process.env.DSH_TEST_ROOT}, async()=>{
  const file=path.join(process.env.DSH_TEST_ROOT,'node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js');
  const {SlotCore}=await import(pathToFileURL(file));
  const slots=new SlotCore();
  const nothing=()=>null;
  slots.register({name:'root',children:{main:{kind:'keyed',scope:'root'},'sidebar.panellist':{kind:'list',scope:'root'},'conversation.session.header.actions':{kind:'list',scope:'session'},'sidebar.right.pane.tab':{kind:'keyed',scope:'session'}}},nothing);
  let entry;
  const context={window:{__ModuleLoader__:{load:e=>{entry=e;}},localStorage:{getItem:()=>null}},document:{createElement:()=>({dataset:{},remove(){}}),head:{append(){}}},console};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../lib/client.js'),'utf8'),context);
  const plugin=entry.factory(id=>id==='react'?{createElement(){}}:{createPortal(){}});
  const registrations=[];
  const tabDefinitions=[];
  plugin.apply({effect:fn=>fn(),sidebarRightTabs:{register:definition=>{tabDefinitions.push(definition);return ()=>{};}},slots:{entries:key=>slots.entries(key),subscribe:(key,fn)=>slots.subscribe(key,fn),inject:(key,fn)=>fn(),register:(opts,component)=>{registrations.push(opts);return slots.register(opts,component);}}});
  assert.ok(!registrations.some(r=>r.name==='main'));
  assert.ok(!registrations.some(r=>r.name==='root'||r.name==='sidebar'||r.name==='conversation.view'));
  assert.equal(registrations.filter(r=>r.name==='sidebar.panellist').length,0);
  assert.equal(registrations.find(r=>r.name==='sidebar.right.pane.tab').key,'dsh-treechat.native');
  assert.equal(tabDefinitions[0].kind,'treechat');
  assert.ok(registrations.some(r=>r.name==='conversation.session.header.actions'&&r.id==='treechat.native'));
});
