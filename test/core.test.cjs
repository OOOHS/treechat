const { test } = require('node:test');
const assert = require('node:assert/strict');
const C = require('../src/core.cjs');
function memory(raw) { const map = new Map(raw ? [[C.STORAGE_KEY,raw]] : []); return { getItem:k=>map.get(k)??null, setItem:(k,v)=>map.set(k,v) }; }
const text = 'Agent Harness includes Tool Discovery and Context Management.';
const anchor = C.makeAnchor({ sessionId:'parent', nodeKey:'assistant:1', atSeq:17, text, start:23, end:37 });
function branch(id='child', parent='parent', source=anchor) { return { sessionId:id, parentId:parent, anchor:source, title:'Tool Discovery', promoted:false, createdAt:100 }; }
test('selection preserves exact quote and offsets', () => {
  assert.equal(anchor.exact,'Tool Discovery'); assert.deepEqual(C.resolveAnchor(text,anchor),{start:23,end:37});
  const shifted = 'Intro. ' + text;
  assert.deepEqual(C.resolveAnchor(shifted,anchor),{start:30,end:44});
});
test('repeated text resolves by context, ambiguous quotation refuses a wrong match', () => {
  const a=C.makeAnchor({sessionId:'s',nodeKey:'k',atSeq:1,text:'A tool B tool C',start:9,end:13});
  assert.deepEqual(C.resolveAnchor('Prefix A tool B tool C',a),{start:16,end:20});
  assert.equal(C.resolveAnchor('tool tool',{...a,exact:'tool',prefix:'',suffix:'',textHash:'changed'}),null);
});
test('assistant fork boundary uses final message, never streaming/start position', () => {
  assert.equal(C.messageSeq({kind:'assistant-step',anchorSeq:2,data:{status:'settled',finalNode:{seq:17,messageId:'m'}}}),17);
  assert.equal(C.messageSeq({kind:'assistant-step',data:{status:'running',finalNode:{seq:17,messageId:'m'}}}),null);
  assert.equal(C.messageSeq({kind:'assistant-step',data:{status:'interrupted',finalNode:{seq:17.5}}}),null);
  assert.equal(C.messageSeq({kind:'user',data:{seq:4}}),4);
  assert.equal(C.messageSeq({kind:'tool',anchorSeq:9}),null);
});
test('nested lineage survives promotion; identity and parent history are unchanged', () => {
  const store=C.createGraphStore(memory()); store.add(branch());
  store.add(branch('grandchild','child',{...anchor,sourceSessionId:'child',atSeq:30}));
  assert.deepEqual(C.lineage(store.getSnapshot(),'grandchild'),['parent','child','grandchild']);
  assert.deepEqual(C.rootSessions(store.getSnapshot(),[{id:'parent'},{id:'child'},{id:'grandchild'}]).map(x=>x.id),['parent']);
  store.promote('child');
  assert.deepEqual(C.rootSessions(store.getSnapshot(),[{id:'parent'},{id:'child'},{id:'grandchild'}]).map(x=>x.id),['parent','child']);
  assert.deepEqual(C.lineage(store.getSnapshot(),'grandchild'),['parent','child','grandchild']);
  assert.equal(C.children(store.getSnapshot(),'parent')[0].sessionId,'child');
});
test('metadata round trip and merge preserve unrelated branches', () => {
  const a=C.createGraphStore(memory()); a.add(branch());
  const b=C.createGraphStore(memory()); b.add(branch('sibling')); b.import(a.export());
  assert.deepEqual(Object.keys(b.getSnapshot().branches),['sibling','child']);
  const c=C.createGraphStore(memory(b.export())); assert.deepEqual(c.getSnapshot(),b.getSnapshot());
});
test('malformed metadata and cycles are rejected without altering saved state', () => {
  const store=C.createGraphStore(memory()); store.add(branch()); const before=store.export();
  const malformed = {version:1,branches:{ parent:branch('parent','child',{...anchor,sourceSessionId:'child'}),child:branch() }};
  assert.throws(()=>store.import(JSON.stringify(malformed)),/循环/); assert.equal(store.export(),before);
  assert.throws(()=>store.import('{"version":2,"branches":{}}'),/格式/);
});
test('corrupt previous data stays untouched; storage failure never publishes fake success', () => {
  const storage=memory('broken'); const store=C.createGraphStore(storage);
  assert.match(store.error,/无法读取/); assert.throws(()=>store.add(branch())); assert.equal(storage.getItem(C.STORAGE_KEY),'broken');
  const full=C.createGraphStore({getItem:()=>null,setItem:()=>{throw new Error('quota');}});
  let signals=0; full.subscribe(()=>signals++); assert.throws(()=>full.add(branch()),/quota/);
  assert.deepEqual(full.getSnapshot(),C.emptyGraph()); assert.equal(signals,0);
});
test('first prompt explicitly carries anchor without injecting anything into parent', () => {
  assert.match(C.branchPrompt(anchor,'和 MCP 有什么区别？'),/Tool Discovery/);
  assert.match(C.branchPrompt(anchor,'和 MCP 有什么区别？'),/和 MCP 有什么区别？/);
  assert.throws(()=>C.branchPrompt(anchor,'  '));
  assert.throws(()=>C.makeAnchor({sessionId:'s',nodeKey:'n',atSeq:1.1,text:'x',start:0,end:1}));
});
test('a stale tab cannot overwrite newer branch records',()=>{
  const storage=memory(),first=C.createGraphStore(storage),second=C.createGraphStore(storage);
  first.add(branch());
  assert.throws(()=>second.add(branch('sibling')),/另一个窗口/);
  assert.equal(JSON.parse(storage.getItem(C.STORAGE_KEY)).branches.child.sessionId,'child');
});

test('restoring a promoted branch hides it and preserves lineage and saved identity',()=>{
 const storage=memory(),store=C.createGraphStore(storage);store.add(branch());store.promote('child');store.demote('child');
 const restored=C.createGraphStore(storage).getSnapshot();
 assert.equal(restored.branches.child.promoted,false);
 assert.equal(restored.branches.child.sessionId,'child');
 assert.deepEqual(C.lineage(restored,'child'),['parent','child']);
 assert.deepEqual(C.rootSessions(restored,[{id:'parent'},{id:'child'}]).map(x=>x.id),['parent']);
});
test('renaming persists only the title, preserving source, identity and promotion',()=>{
 const storage=memory(),store=C.createGraphStore(storage);store.add(branch());store.promote('child');const before=store.getSnapshot().branches.child;
 store.rename('child','  工具发现的新名称  ');const after=C.createGraphStore(storage).getSnapshot().branches.child;
 assert.equal(after.title,'工具发现的新名称');assert.deepEqual({...after,title:before.title},before);
 for(const invalid of ['','  ','x'.repeat(201)])assert.throws(()=>store.rename('child',invalid),/名称/);
 assert.equal(store.getSnapshot().branches.child.title,'工具发现的新名称');assert.throws(()=>store.rename('missing','name'),/不存在/);
});
