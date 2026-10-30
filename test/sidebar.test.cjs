const {test}=require('node:test');
const assert=require('node:assert/strict');
const {projectWorkspace,filterSearch,installWorkspaceFilter}=require('../src/sidebar.cjs');
const list={phase:'ready',ids:['root','child','nested','promoted','ordinary-fork'],byId:Object.fromEntries(['root','child','nested','promoted','ordinary-fork'].map(id=>[id,{id,retainedBy:{}}]))};
const workspaces={phase:'ready',state:'idle',items:[{workspaceId:'workspace',sessionIds:list.ids}],pinnedSessionIds:['child','promoted'],archivedSessionIds:['nested']};
const graph={branches:{child:{promoted:false},nested:{promoted:false},promoted:{promoted:true}}};

test('native grouped and flat browser projections exclude only unpromoted TreeChat branches',()=>{
 const before=JSON.stringify({list,workspaces});
 const result=projectWorkspace(graph,list,workspaces);
 assert.deepEqual(result.list.ids,['root','promoted','ordinary-fork']);
 assert.deepEqual(Object.keys(result.list.byId),result.list.ids);
 assert.deepEqual(result.workspaces.items[0].sessionIds,result.list.ids);
 assert.deepEqual(result.workspaces.pinnedSessionIds,['promoted']);
 assert.deepEqual(result.workspaces.archivedSessionIds,[]);
 assert.equal(JSON.stringify({list,workspaces}),before);
 const promoted=projectWorkspace({branches:{...graph.branches,child:{promoted:true}}},list,workspaces);
 assert.ok(promoted.list.ids.includes('child'));
 assert.equal(promoted.list.byId.child,list.byId.child);
});
test('content search excludes branch hits and restores them after promotion',()=>{
 const result={items:[{sessionId:'child',snippet:'branch-only'},{sessionId:'root',snippet:'root'}],hasMore:true};
 assert.deepEqual(filterSearch(graph,result).items,[result.items[1]]);
 assert.equal(filterSearch({branches:{}},result).items.length,2);
 assert.equal(result.items.length,2);
});
test('workspace adapter preserves native entry contracts and restores the component on unload',{skip:!process.env.DSH_TEST_ROOT},async()=>{
 const {pathToFileURL}=require('node:url');const path=require('node:path');
 const {SlotCore}=await import(pathToFileURL(path.join(process.env.DSH_TEST_ROOT,'node_modules/@deepseek-ai/dsh-client-ui-slots/lib/index.js')));
 const slots=new SlotCore();
 slots.register({name:'root',children:{'sidebar.workspaces':{kind:'single',scope:'root'}}},()=>null);
 let current=graph;
 const store={getSnapshot:()=>current,subscribe:()=>()=>{}};
 const React={createElement:(component,props)=>({component,props}),useMemo:fn=>fn(),useSyncExternalStore:(_subscribe,get)=>get()};
 const dispose=installWorkspaceFilter(slots,store,React);
 function WorkspaceBrowser(){}
 const inject=()=>({nativeAction:true});
 slots.register({name:'sidebar.workspaces',inject,locale:'workspace',children:{'sidebar.test.action':{kind:'list',scope:'root'}}},WorkspaceBrowser);
 await new Promise(resolve=>queueMicrotask(resolve));
 const entry=slots.entries('sidebar.workspaces')[0];
 assert.notEqual(entry.component,WorkspaceBrowser);
 assert.equal(entry.inject,inject);assert.equal(entry.locale,'workspace');assert.ok(entry.children['sidebar.test.action']);
 const renderSlot=()=>{},props={useSessions:fn=>fn(list),useWorkspaces:fn=>fn(workspaces),renderSlot,searchSessions:async()=>({items:[{sessionId:'child'}],hasMore:false})};
 let rendered=entry.component(props);
 assert.equal(rendered.component,WorkspaceBrowser);assert.equal(rendered.props.renderSlot,renderSlot);
 assert.deepEqual(rendered.props.useSessions(s=>s.ids),['root','promoted','ordinary-fork']);
 assert.deepEqual((await rendered.props.searchSessions('test')).items,[]);
 current={branches:{...graph.branches,child:{promoted:true}}};
 rendered=entry.component(props);assert.ok(rendered.props.useSessions(s=>s.ids).includes('child'));
 dispose();assert.equal(entry.component,WorkspaceBrowser);
});
