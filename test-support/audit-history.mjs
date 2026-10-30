// Read-only audit of the isolated dev profile's real DSH session journals.
import {readFileSync, readdirSync, writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {zstdDecompressSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..');
const runtime=process.env.DSH_TEST_ROOT;
if(!runtime)throw new Error('Set DSH_TEST_ROOT to the DSH runtime installation directory');
const impl=readFileSync(join(runtime,'node_modules/@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js'),'utf8');
const start=impl.indexOf('function scanZstdFrames('),end=impl.indexOf('\n/**',start);
const scan=Function('ZSTD_MAGIC',`return (${impl.slice(start,end)})`)(4247762216);
const home=join(process.env.TREECHAT_HOME ? resolve(process.env.TREECHAT_HOME) : join(root,'.runtime/home'),'sessions');
const parentMarker=process.env.TREECHAT_PARENT_MARKER||'PARENT_CHECK_103';
const childMarker=process.env.TREECHAT_CHILD_MARKER||'BRANCH_ONLY_472';
const nestedMarker=process.env.TREECHAT_NESTED_MARKER||'NESTED_ONLY_915';
const sessions=[];
for(const group of readdirSync(home,{withFileTypes:true}).filter(d=>d.isDirectory()))for(const dir of readdirSync(join(home,group.name),{withFileTypes:true}).filter(d=>d.isDirectory())){
 const bytes=readFileSync(join(home,group.name,dir.name,'session.v4.jsonl.zstd'));
 const rows=scan(bytes).frames.flatMap(f=>zstdDecompressSync(bytes.subarray(f.start,f.end)).toString().split('\n').filter(Boolean).map(JSON.parse));
 const events=rows.filter(r=>Number.isSafeInteger(r.seq));
 const visible=events.filter(e=>e.type==='user/message'||e.type==='assistant/message').map(e=>({seq:e.seq,role:e.type,text:JSON.stringify(e.data)}));
 sessions.push({id:dir.name,rows,events,visible,text:visible.map(e=>e.text).join('\n')});
}
const parent=sessions.find(s=>s.text.includes(parentMarker)&&!s.text.includes(childMarker));
const child=sessions.find(s=>s.text.includes(childMarker)&&!s.text.includes(nestedMarker));
const nested=sessions.find(s=>s.text.includes(nestedMarker));
function boundary(source, branch) {
 if(!source||!branch)return null;
 let count=0;
 while(source.events[count]&&branch.events[count]&&JSON.stringify(source.events[count])===JSON.stringify(branch.events[count]))count++;
 return {inheritedEvents:count,atSeq:source.events[count-1]?.seq,lastType:source.events[count-1]?.type};
}
function selectionBeforeRequest(session,marker) {
 const question=session?.visible.find(e=>e.role==='user/message'&&e.text.includes(marker));
 const selection=session?.events.filter(e=>e.type==='model/selection'&&e.seq<question?.seq).at(-1);
 const request=session?.events.find(e=>e.type==='request/header'&&e.seq>question?.seq);
 return !!selection&&!!request&&['provider','model','reasoningEffort'].every(key=>selection.data[key]===request.data.header.config[key]);
}
const boundaries={child:boundary(parent,child),nested:boundary(child,nested)};
const result={
 boundaries,
 sessions:sessions.map(s=>({id:s.id,events:s.events.length,turns:s.events.filter(e=>e.type==='turn/end').length,
   parentMarker:s.text.includes(parentMarker),childMarker:s.text.includes(childMarker),nestedMarker:s.text.includes(nestedMarker)})),
 checks:{parentExists:!!parent,childExists:!!child,nestedExists:!!nested,
  parentExcludesChildren:!!parent&&!parent.text.includes(childMarker)&&!parent.text.includes(nestedMarker),
  childExcludesLaterParent:!!child&&!child.text.includes(parentMarker),
  childExcludesGrandchild:!!child&&!child.text.includes(nestedMarker),
  nestedInheritsChild:!!nested&&nested.text.includes(childMarker),
  nestedExcludesLaterParent:!!nested&&!nested.text.includes(parentMarker)},
 selectedSessions:{parent:parent?.id,child:child?.id,nested:nested?.id},
 selectedDetails:[parent,child,nested].filter(Boolean).map(s=>({id:s.id,lastEvent:s.events.at(-1),chatDigest:createHash('sha256').update(JSON.stringify(s.visible)).digest('hex'),eventTimeline:s.events.map(e=>({seq:e.seq,type:e.type,sha256:createHash('sha256').update(JSON.stringify(e)).digest('hex')}))})),
 modelEvents:[parent,child,nested].filter(Boolean).map(s=>({id:s.id,events:s.events.filter(e=>/model|request\/header|fork/.test(e.type)).map(e=>({type:e.type,seq:e.seq,data:e.type==='request/header'?e.data.header.config:e.data}))})),
 liveChecks:process.env.TREECHAT_REQUIRE_SELECTION==='1'?{
  childExplicitSelection:selectionBeforeRequest(child,childMarker),nestedExplicitSelection:selectionBeforeRequest(nested,nestedMarker),
  childBoundaryIsCompletedMessage:boundaries.child?.lastType==='assistant/message',nestedBoundaryIsCompletedMessage:boundaries.nested?.lastType==='assistant/message',
  childHasRealAnswer:!!child?.visible.some(e=>e.role==='assistant/message'&&e.text.includes('CHILD_OK')),
  nestedHasRealAnswer:!!nested?.visible.some(e=>e.role==='assistant/message'&&e.text.includes('NESTED_OK'))
 }:undefined,
 historyDigests:sessions.map(s=>({id:s.id,sha256:createHash('sha256').update(JSON.stringify(s.events)).digest('hex')}))
};
writeFileSync(join(root,'.runtime/history-audit.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
if(Object.values({...result.checks,...result.liveChecks}).some(v=>!v))process.exitCode=1;
