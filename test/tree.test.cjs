const {test}=require('node:test');
const assert=require('node:assert/strict');
const {layoutTree}=require('../src/tree.cjs');
const b=(sessionId,parentId,atSeq,promoted=false)=>({sessionId,parentId,title:sessionId,anchor:{atSeq},createdAt:atSeq,promoted});
test('tree has a main axis, source-ordered branches, and explicit nested connectors',()=>{
 const graph={branches:{late:b('late','root',30),early:b('early','root',10),nested:b('nested','early',15),promoted:b('promoted','root',20,true),private:b('private','promoted',25),other:b('other','another-root',1)}};
 const map=layoutTree(graph,'root');
 assert.deepEqual(map.nodes.map(n=>n.id),['early','nested','late']);
 assert.equal(map.edges[0].x1,map.axisX);
 assert.equal(map.edges[1].source,'early');assert.equal(map.edges[1].target,'nested');
 for(const n of map.nodes){assert.ok(n.x+n.width<map.width);assert.ok(n.y+n.height<map.height);}
 assert.ok(map.nodes[1].x>map.nodes[0].x);
 assert.deepEqual(layoutTree(graph,'promoted').nodes.map(n=>n.id),['private']);
});
test('empty tree retains space for a main-session node and long branch chains stay distinct',()=>{
 assert.equal(layoutTree({branches:{}},'root').nodes.length,0);
 const branches={};for(let i=0;i<60;i++)branches['n'+i]=b('n'+i,i?'n'+(i-1):'root',i);
 const map=layoutTree({branches},'root');assert.equal(new Set(map.nodes.map(n=>n.y)).size,60);assert.equal(map.edges.length,60);
});
test('Control-wheel zoom consumes the wheel and preserves the diagram point under the pointer',()=>{
 const {bindMapWheel}=require('../src/tree.cjs');let listener,removed=false,prevented=0,options;
 const element={addEventListener:(type,fn,opts)=>{assert.equal(type,'wheel');listener=fn;options=opts;},removeEventListener:(type,fn)=>{removed=fn===listener;},getBoundingClientRect:()=>({left:100,top:50})};
 let camera={zoom:1,pan:{x:16,y:24}};
 const off=bindMapWheel(element,()=>camera,next=>camera=next);
 const event={ctrlKey:false,clientX:300,clientY:250,deltaY:-100,deltaMode:0,preventDefault:()=>prevented++};
 listener(event);assert.equal(camera.zoom,1);assert.equal(prevented,0);
 listener({...event,ctrlKey:true});assert.equal(prevented,1);assert.equal(options.passive,false);assert.ok(camera.zoom>1);
 assert.ok(Math.abs((200-camera.pan.x)/camera.zoom-184)<1e-9);assert.ok(Math.abs((200-camera.pan.y)/camera.zoom-176)<1e-9);
 off();assert.equal(removed,true);
});
test('zoom limits preserve pointer focus even after panning',()=>{
 const {zoomCamera}=require('../src/tree.cjs');const start={zoom:.7,pan:{x:-130,y:80}};
 for(const desired of [.01,9]){const next=zoomCamera(start,desired,80,110);assert.ok(next.zoom>=.35&&next.zoom<=2);assert.ok(Math.abs((80-next.pan.x)/next.zoom-(80-start.pan.x)/start.zoom)<1e-9);}
});
