'use strict';
const React = require('react');
const { createPortal } = require('react-dom');
const { useState, useEffect, useRef, useSyncExternalStore, createElement: h } = React;
const C = require('./core.cjs');
const Send = require('./send.cjs');
const Sidebar = require('./sidebar.cjs');
const {layoutTree,zoomCamera,bindMapWheel}=require('./tree.cjs');
const {shouldSend} = require('./keyboard.cjs');

const inject = ['slots', 'sessions', 'remote', 'remote.session', 'conversation', 'uiWorkspace', 'sidebarRight', 'sidebarRightTabs'];
function TreeIcon({ size = 20 } = {}) {
  return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
    h('path', { d: 'M12 21V10M12 15L5 8M12 12l7-7', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' }),
    ...[[5, 6], [12, 7], [19, 4]].map(([cx,cy], i) => h('circle', { key:i, cx, cy, r:2.3, stroke:'currentColor', strokeWidth:1.6 })));
}
function Icon({name,size=18}) {
  const paths={edit:'M15 4l5 5M4 20l5-1L20 8a2 2 0 0 0-4-4L5 15l-1 5',check:'M5 12l4 4L19 6',back:'M15 5l-7 7 7 7',chevron:'M9 5l7 7-7 7',more:'M5 12h.01M12 12h.01M19 12h.01',promote:'M8.5 7a7 7 0 1 0 7 0M12 13.5V1M9.6 3.4 12 1l2.4 2.4',send:'M12 19V5M6 11l6-6 6 6',close:'M6 6l12 12M18 6L6 18',loading:'M12 3a9 9 0 1 1-9 9'};
  return h('svg',{width:size,height:size,viewBox:'0 0 24 24',fill:'none',stroke:'currentColor',strokeWidth:name==='more'?3:1.7,strokeLinecap:'round',strokeLinejoin:'round','aria-hidden':true,className:name==='loading'?'tc-spinner':undefined},h('path',{d:paths[name]}));
}
function Button({ children, title, ...props }) {
  const [tip,setTip]=useState(null);
  const show=e=>{if(!title)return;const r=e.currentTarget.getBoundingClientRect();setTip({x:Math.min(window.innerWidth-170,Math.max(8,r.right-160)),y:r.bottom+6});};
  return h(React.Fragment,null,h('button',{type:'button','data-treechat-control':true,'data-tooltip':title,...props,onPointerEnter:e=>{show(e);props.onPointerEnter?.(e);},onPointerLeave:e=>{setTip(null);props.onPointerLeave?.(e);},onFocus:e=>{show(e);props.onFocus?.(e);},onBlur:e=>{setTip(null);props.onBlur?.(e);},onPointerDown:e=>{setTip(null);props.onPointerDown?.(e);},onClick:e=>{setTip(null);props.onClick?.(e);}},children),tip&&createPortal(h('div',{className:'tc-tooltip',role:'tooltip',style:{left:tip.x,top:tip.y}},title),document.body));
}
function EditableBranchTitle({name,busy,onSave}) {
  const [editing,setEditing]=useState(false),[value,setValue]=useState(name),input=useRef(null),saving=useRef(false),ime=useRef(false);
  useEffect(()=>{if(editing){input.current?.focus();input.current?.select();}},[editing]);
  const cancel=()=>{if(!busy&&!saving.current){setValue(name);setEditing(false);}};
  const save=async e=>{e.preventDefault();if(busy||saving.current)return;saving.current=true;try{if(await onSave(value))setEditing(false);}finally{saving.current=false;}};
  return editing?h('form',{className:'tc-title-editor',onSubmit:save},
    h('input',{ref:input,'aria-label':'分支名称',value,maxLength:200,required:true,disabled:busy,onChange:e=>setValue(e.target.value),onCompositionStart:()=>{ime.current=true;},onCompositionEnd:()=>{ime.current=false;},onKeyDown:e=>{if(e.key==='Enter'&&(ime.current||e.nativeEvent.isComposing||e.keyCode===229))e.preventDefault();if(e.key==='Escape'&&!ime.current){e.preventDefault();cancel();}}}),
    h(Button,{className:'tc-icon-button',type:'submit','aria-label':'保存分支名称',title:'保存名称',disabled:busy||!value.trim()},h(Icon,{name:'check',size:16})),
    h(Button,{className:'tc-icon-button','aria-label':'取消修改名称',title:'取消',onClick:cancel,disabled:busy},h(Icon,{name:'close',size:14}))):
    h(Button,{className:'tc-panel-title tc-editable-title',title:'点击修改分支名称','aria-label':'编辑分支名称',disabled:busy,onClick:()=>{setValue(name);setEditing(true);}},h('span',null,name),h(Icon,{name:'edit',size:13}));
}
function messageText(row) { const copy=row.cloneNode(true);copy.querySelectorAll('[data-treechat-markers]').forEach(el=>el.remove());return copy.textContent; }
function errorText(e) { return e?.rpcError?.message || e?.message || String(e); }
// Keep the clicked disclosure stationary while native history sizing settles.
function holdReadingPosition(button) {
  let scroll=button?.parentElement;
  while(scroll&&!/(auto|scroll)/.test(getComputedStyle(scroll).overflowY))scroll=scroll.parentElement;
  if(!scroll)return {finish(){},cancel(){}};
  const top=button.getBoundingClientRect().top,oldAnchor=scroll.style.overflowAnchor;
  let doneAt=Infinity,frame,stopped=false;const started=performance.now();
  scroll.style.overflowAnchor='none';
  const cancel=()=>{if(stopped)return;stopped=true;cancelAnimationFrame(frame);scroll.style.overflowAnchor=oldAnchor;for(const type of ['wheel','touchstart','pointerdown','keydown'])scroll.removeEventListener(type,cancel);};
  const tick=()=>{if(stopped)return;if(!button.isConnected||performance.now()>doneAt||performance.now()-started>10000){cancel();return;}const delta=button.getBoundingClientRect().top-top;if(Math.abs(delta)>.5)scroll.scrollTop+=delta;frame=requestAnimationFrame(tick);};
  for(const type of ['wheel','touchstart','pointerdown','keydown'])scroll.addEventListener(type,cancel,{passive:true});
  frame=requestAnimationFrame(tick);
  return {finish(){doneAt=performance.now()+700;},cancel};
}
function apply(ctx) {
  let storage;
  try { storage = window.localStorage; }
  catch { storage = { getItem() { throw new Error('浏览器不允许本地存储'); }, setItem() { throw new Error('浏览器不允许本地存储'); } }; }
  const graphStore = C.createGraphStore(storage);
  const style = document.createElement('style'); style.textContent = TREECHAT_CSS; style.dataset.treechat = 'style';
  ctx.effect(() => { document.head.append(style); return () => style.remove(); });
  const graphHook = () => useSyncExternalStore(graphStore.subscribe, graphStore.getSnapshot, graphStore.getSnapshot);
  ctx.effect(()=>Sidebar.installWorkspaceFilter(ctx.slots,graphStore,React));
  function useRetained(id) {
    const [result, setResult] = useState(null);
    useEffect(() => {
      if (!id) { setResult(null); return; }
      let ref, live = true;
      try {
        ref = ctx.sessions.retain(id, { source:'controllerOperation' });
        ref.ready.then(() => { if (live) setResult({ id, reference:ref }); }, e => { if (live) setResult({ id, error:errorText(e) }); });
      } catch (e) { setResult({ id, error:errorText(e) }); }
      return () => { live = false; ref?.release(); };
    }, [id]);
    return result?.id === id ? result : null;
  }
  function title(id, catalog, graph) { return graph.branches[id]?.title || catalog.byId[id]?.displayTitle || '新对话'; }
  // One native drawer state per main Session. Switching the main conversation
  // never moves an in-flight fork or a draft into the newly selected Session.
  const nativeViews = new Map(), nativeListeners = new Set();
  function nativeView(id) {
    if (!nativeViews.has(id)) {
      let saved;
      try { saved=JSON.parse(storage.getItem(`${C.STORAGE_KEY}:native:${id}`)); } catch {}
      nativeViews.set(id,{ sideId:typeof saved?.sideId==='string'?saved.sideId:null, draft:null, busy:false, error:null, jump:null });
    }
    return nativeViews.get(id);
  }
  const nativeSubscribe = fn => { nativeListeners.add(fn); return ()=>nativeListeners.delete(fn); };
  function patchNative(id,change) {
    const next={...nativeView(id),...(('sideId' in change||'draft' in change)?{treeOpen:false}:{}),...change}; nativeViews.set(id,next);
    try { storage.setItem(`${C.STORAGE_KEY}:native:${id}`,JSON.stringify({sideId:next.sideId})); } catch {}
    for(const listener of nativeListeners)listener();
  }
  function useNativeView(id) { return useSyncExternalStore(nativeSubscribe,()=>nativeView(id),()=>nativeView(id)); }
  function showNativePane(owner) {
    if (ctx.sidebarRight.mounted.getSnapshot()===owner) ctx.sidebarRight.openTab('treechat');
  }
  async function sendBranchDraft(current,onCreated) {
    let child=current.createdId;
    const model=current.modelSelection ?? Send.selectedModel(ctx.sessions.binding(current.anchor.sourceSessionId)?.session);
    if (!child) {
      graphStore.ensureWritable();
      child=await ctx.sessions.fork({sessionId:current.anchor.sourceSessionId,atSeq:current.anchor.atSeq,onCreated:id=>{
        const branch={sessionId:id,parentId:current.anchor.sourceSessionId,anchor:current.anchor,
          title:current.anchor.exact.trim().replace(/\s+/g,' ').slice(0,60),promoted:false,createdAt:Date.now()};
        try { graphStore.add(branch); }
        catch(e){throw new Error(`分支已保存，来源记录保存失败：${errorText(e)}`);}
        onCreated(id);
      }});
    }
    await Send.sendFirstMessage(ctx,child,model,C.branchPrompt(current.anchor,current.question));
    return child;
  }
  function nativeActions(owner) {
    return {
      beginBranch(anchor) {
        if(nativeView(owner).busy)return;
        patchNative(owner,{draft:{anchor,question:'',createdId:null,modelSelection:Send.selectedModel(ctx.sessions.binding(anchor.sourceSessionId)?.session)},sideId:null,error:null});showNativePane(owner);
      },
      openBranch(id) {if(!nativeView(owner).busy){patchNative(owner,{sideId:id,draft:null,error:null,jump:null});showNativePane(owner);}},
      jumpTo(branch) {
        if(branch.parentId===owner){
          patchNative(owner,{sideId:null,draft:null,jump:{anchor:branch.anchor,nonce:Date.now()}});
          if(ctx.sidebarRight.mounted.getSnapshot()===owner&&ctx.sidebarRight.isExpanded()&&ctx.sidebarRight.active()?.kind==='treechat')ctx.sidebarRight.toggleExpanded();
        } else if(graphStore.getSnapshot().branches[branch.parentId]) {
          patchNative(owner,{sideId:branch.parentId,draft:null,jump:{anchor:branch.anchor,nonce:Date.now()}});showNativePane(owner);
        } else {
          patchNative(branch.parentId,{sideId:null,draft:null,jump:{anchor:branch.anchor,nonce:Date.now()}});ctx.uiWorkspace.openSession(branch.parentId);
        }
      }
    };
  }
  async function submitNative(owner,event) {
    event.preventDefault();const view=nativeView(owner),current=view.draft;
    if(view.busy||!current?.question.trim())return;
    patchNative(owner,{busy:true,error:null});
    try {
      const child=await sendBranchDraft(current,id=>patchNative(owner,{draft:{...current,createdId:id}}));
      patchNative(owner,{draft:null,sideId:child});
    }catch(e){patchNative(owner,{error:errorText(e)});}
    finally{patchNative(owner,{busy:false});}
  }

  function SessionPane(props) {
    const { sessionId, mode, jump, observeOnly = false } = props;
    const actions=props.actions;
    const graph = graphHook();
    const session = props.useSession(x=>x);
    const chat = props.useChat(x=>x);
    const root = useRef(null);
    const [selection, setSelection] = useState(null);
    const [markerTargets, setMarkerTargets] = useState([]);
    const [contextTarget,setContextTarget]=useState(null);
    const readingHold=useRef(null);
    useEffect(()=>()=>readingHold.current?.cancel(),[]);
    const [quoteTarget, setQuoteTarget] = useState(null);
    const [notice, setNotice] = useState(null);
    const [showInherited, setShowInherited] = useState(false);
    const selectionHandler = useRef(null);
    const descendantBranches = C.children(graph, sessionId);
    const ownBranch = graph.branches[sessionId];
    const getHost = () => observeOnly ? root.current?.closest('[data-slot="main.conversation"]') : root.current;
    function selectText() {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) { setSelection(null); return; }
      const range = sel.getRangeAt(0);
      const elementOf = node => node.nodeType === 1 ? node : node.parentElement;
      const from = elementOf(range.startContainer)?.closest('[data-chat-node-key]');
      const to = elementOf(range.endContainer)?.closest('[data-chat-node-key]');
      if (!from || from !== to || !getHost()?.contains(from) || elementOf(range.startContainer)?.closest('.tc-marker')) { setSelection(null); return; }
      const nodeKey = from.getAttribute('data-chat-node-key');
      const node = chat.nodes.get(nodeKey), seq = C.messageSeq(node);
      if (seq === null) { setSelection(null); return; }
      try {
        const pre = document.createRange(); pre.selectNodeContents(from); pre.setEnd(range.startContainer, range.startOffset);
        const before=pre.cloneContents();before.querySelectorAll('[data-treechat-markers]').forEach(el=>el.remove());
        const start = before.textContent.length, end = start + range.toString().length;
        const anchor = C.makeAnchor({ sessionId, nodeKey, part:from.getAttribute('data-chat-group-part'), atSeq:seq, text:messageText(from), start, end });
        const rect = range.getBoundingClientRect(), bounds = observeOnly ? {top:0,left:0,width:window.innerWidth,height:window.innerHeight} : getHost().getBoundingClientRect();
        setSelection({ anchor, top:Math.max(0, Math.min(bounds.height - 42, rect.top - bounds.top - 40)), left:Math.max(8, Math.min(bounds.width - 145, rect.left - bounds.left)) });
      } catch (error) { console.debug('TreeChat selection unavailable:', errorText(error)); setSelection(null); }
    }
    selectionHandler.current = selectText;
    useEffect(() => {
      const listener = () => { if (window.getSelection()?.isCollapsed) setSelection(null); else selectionHandler.current?.(); };
      const dismiss = () => setSelection(null);
      document.addEventListener('selectionchange', listener);
      document.addEventListener('scroll', dismiss, true);
      window.addEventListener('resize', dismiss);
      return () => {
        document.removeEventListener('selectionchange', listener);
        document.removeEventListener('scroll', dismiss, true);
        window.removeEventListener('resize', dismiss);
      };
    }, []);
    useEffect(() => {
      const host = getHost(); if (!host) return;
      let scheduled = false, disposed = false;
      const highlightKey=`treechat-anchor-${sessionId}-${mode}`, hoverKey=`treechat-hover-${sessionId}-${mode}`;
      let anchored=[];
      const anchorTip=document.createElement('div');anchorTip.className='tc-tooltip';anchorTip.setAttribute('role','tooltip');
      const hideAnchorTip=()=>anchorTip.remove();
      function textRange(row,position) {
        const walker=document.createTreeWalker(row,NodeFilter.SHOW_TEXT);let node,offset=0,start,end;
        while((node=walker.nextNode())) {
          if(node.parentElement?.closest('[data-treechat-markers]'))continue;
          const next=offset+node.textContent.length;
          if(!start&&position.start<next)start=[node,position.start-offset];
          if(position.end<=next){end=[node,position.end-offset];break;}offset=next;
        }
        if(!start||!end)return null;
        const range=document.createRange();range.setStart(...start);range.setEnd(...end);return range;
      }
      const highlightStyle=document.createElement('style');
      highlightStyle.textContent=`::highlight(${highlightKey}){text-decoration:underline;text-decoration-color:#4d6bfe;text-decoration-thickness:1.5px;text-underline-offset:3px}::highlight(${hoverKey}){background-color:#dce7ff;color:#24489b}`;
      document.head.append(highlightStyle);
      const hit=e=>anchored.find(item=>[...item.range.getClientRects()].some(r=>e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom));
      const hover=e=>{const item=hit(e);if(window.CSS?.highlights&&window.Highlight){if(item)CSS.highlights.set(hoverKey,new Highlight(item.range));else CSS.highlights.delete(hoverKey);}
        if(item&&item.branch.title!==item.branch.anchor.exact.trim().replace(/\s+/g,' ').slice(0,60)){
          anchorTip.textContent=item.branch.title;anchorTip.style.left=`${Math.max(8,Math.min(window.innerWidth-176,e.clientX+10))}px`;anchorTip.style.top=`${Math.max(8,Math.min(window.innerHeight-80,e.clientY+18))}px`;
          if(!anchorTip.isConnected)document.body.append(anchorTip);
        }else hideAnchorTip();
      };
      const leave=()=>{window.CSS?.highlights?.delete(hoverKey);hideAnchorTip();};
      const click=e=>{hideAnchorTip();const item=hit(e);if(item&&window.getSelection()?.isCollapsed)actions?.openBranch(item.branch.sessionId);};
      host.addEventListener('scroll',leave,true);host.addEventListener('pointermove',hover);host.addEventListener('pointerleave',leave);host.addEventListener('click',click);
      function reconcile() {
        scheduled = false; if (disposed) return;
        const targets = []; anchored=[]; let quote=null,firstOwnRow=null;
        for (const row of host.querySelectorAll('[data-chat-node-key]')) {
          const key = row.getAttribute('data-chat-node-key');
          const node = chat.nodes.get(key);
          const sourceSeq = node?.kind === 'turn-tail' ? node.data?.closing?.finalNode?.seq ?? node.anchorSeq : node?.anchorSeq;
          const inherited = mode === 'branch' && ownBranch && sourceSeq !== undefined && sourceSeq <= ownBranch.anchor.atSeq;
          row.toggleAttribute('data-treechat-inherited', Boolean(inherited && !showInherited));
          const part=row.getAttribute('data-chat-group-part');
          const branches = descendantBranches.filter(b => b.anchor.nodeKey === key && (b.anchor.part ? b.anchor.part===part : part!=='reasoning'));
          for(const branch of branches){const position=C.resolveAnchor(messageText(row),branch.anchor);const range=position&&textRange(row,position);if(range)anchored.push({range,branch});}
          if(ownBranch&&sourceSeq>ownBranch.anchor.atSeq&&row.getAttribute('data-chat-flow-kind')==='user'){
            if(mode==='branch'&&!firstOwnRow)firstOwnRow=row;
            const prefix=`> ${ownBranch.anchor.exact.split('\n').join('\n> ')}\n\n`;
            const plain=[...row.querySelectorAll('span')].find(el=>el.textContent.startsWith(prefix)&&!el.closest('.tc-quoted-message'));
            if(plain){const element=plain.parentElement;element.setAttribute('data-treechat-quote','');quote={element,text:plain.textContent.slice(prefix.length),exact:ownBranch.anchor.exact};}
          }
          if (branches.length) targets.push({ element:row, key:`${key}:${part || ''}`, branches });
        }
        if(window.CSS?.highlights&&window.Highlight)CSS.highlights.set(highlightKey,new Highlight(...anchored.map(item=>item.range)));
        if(firstOwnRow)firstOwnRow.setAttribute('data-treechat-start','');
        setContextTarget(firstOwnRow);
        setQuoteTarget(previous=>previous?.element===quote?.element&&previous?.text===quote?.text?previous:quote);
        setMarkerTargets(previous => previous.length === targets.length && previous.every((p,i)=>p.element===targets[i].element && p.branches.length===targets[i].branches.length && p.branches.every((b,j)=>b===targets[i].branches[j])) ? previous : targets);
      }
      const observer = new MutationObserver(() => { if (!scheduled) { scheduled = true; requestAnimationFrame(reconcile); } });
      observer.observe(host, { childList:true, subtree:true }); reconcile();
      return () => { disposed = true; hideAnchorTip();host.removeEventListener('scroll',leave,true);observer.disconnect();highlightStyle.remove();window.CSS?.highlights?.delete(highlightKey);window.CSS?.highlights?.delete(hoverKey);host.removeEventListener('pointermove',hover);host.removeEventListener('pointerleave',leave);host.removeEventListener('click',click);host.querySelectorAll('[data-treechat-start]').forEach(el=>el.removeAttribute('data-treechat-start'));host.querySelectorAll('[data-treechat-quote]').forEach(el=>el.removeAttribute('data-treechat-quote')); };
    }, [chat, graph, sessionId, mode, showInherited]);
    useEffect(() => {
      if (!jump) return;
      let cancelled = false, timer;
      const host = getHost(); if(!host)return;
      async function reveal() {
        try {
          const binding = ctx.sessions.binding(sessionId);
          await binding?.session.loadThrough(jump.anchor.atSeq);
          let attempts = 0;
          const locate = () => {
            if (cancelled) return;
            const row = [...host.querySelectorAll('[data-chat-node-key]')].find(el => el.getAttribute('data-chat-node-key') === jump.anchor.nodeKey && (jump.anchor.part ? el.getAttribute('data-chat-group-part')===jump.anchor.part : el.getAttribute('data-chat-group-part')!=='reasoning'));
            if (!row && attempts++ < 30) { timer = setTimeout(locate, 100); return; }
            if (!row) { setNotice('来源消息暂时无法定位，可以展开较早的历史后重试。'); return; }
            row.removeAttribute('data-treechat-inherited'); row.scrollIntoView({ block:'center', behavior:'smooth' });
            row.classList.add('tc-source-flash');
            const position = C.resolveAnchor(messageText(row), jump.anchor);
            if (position && window.CSS?.highlights && window.Highlight) {
              const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT); let node, offset=0, startNode, endNode, startOffset, endOffset;
              while ((node=walker.nextNode())) {
                if(node.parentElement?.closest('[data-treechat-markers]'))continue;
                const end = offset + node.textContent.length;
                if (!startNode && position.start < end) { startNode=node; startOffset=position.start-offset; }
                if (position.end <= end) { endNode=node; endOffset=position.end-offset; break; }
                offset=end;
              }
              if (startNode && endNode) { const range=document.createRange(); range.setStart(startNode,startOffset); range.setEnd(endNode,endOffset); CSS.highlights.set('treechat-source',new Highlight(range)); }
            } else if (!position) setNotice('已返回来源消息；文字排版发生变化，未自动高亮具体选区。');
            timer = setTimeout(() => { row.classList.remove('tc-source-flash'); window.CSS?.highlights?.delete('treechat-source'); }, 1200);
          };
          locate();
        } catch(e) { if (!cancelled) setNotice(errorText(e)); }
      }
      setShowInherited(true); reveal();
      return () => { cancelled=true; clearTimeout(timer); host?.querySelectorAll('.tc-source-flash').forEach(el=>el.classList.remove('tc-source-flash')); window.CSS?.highlights?.delete('treechat-source'); };
    }, [jump?.nonce, sessionId]);
    // TreeChat also supports ungrouped chat sessions. The native hero requires a
    // Workspace chip and disables its composer without one; use the regular
    // embedded composer for our already-created, retained Session instead.
    const phase = session.openState === 'loading' ? 'settling' : 'active';
    const selectionButton=selection&&h(Button,{className:`tc-selection ${observeOnly?'tc-native-selection':''}`,style:{top:selection.top,left:selection.left},onPointerDown:e=>e.preventDefault(),onClick:()=>{actions?.beginBranch(selection.anchor);setSelection(null);window.getSelection()?.removeAllRanges();}},h(TreeIcon,{size:16}),'分支讨论');
    const markers=markerTargets.map(target=>createPortal(h('div',{className:`tc-markers ${observeOnly?'tc-native-surface':''}`,'data-treechat-markers':true},target.branches.map(b=>h(Button,{key:b.sessionId,className:'tc-marker',title:b.anchor.exact,onClick:()=>actions?.openBranch(b.sessionId)},h(TreeIcon,{size:13}),b.title,h(Icon,{name:'chevron',size:12})))),target.element,target.key));
    const contextPortal=contextTarget&&createPortal(h('div',{className:'tc-context-entry','data-treechat-markers':true},h(Button,{className:'tc-context-toggle','aria-expanded':showInherited,onClick:async e=>{
      readingHold.current?.cancel();const hold=holdReadingPosition(e.currentTarget);readingHold.current=hold;
      try{if(!showInherited)await ctx.sessions.binding(sessionId)?.session.loadThrough(0);setShowInherited(!showInherited);}catch(error){setNotice(errorText(error));}finally{hold.finish();}
    }},showInherited?'收起主会话上下文':'展开主会话上下文',h(Icon,{name:'chevron',size:12}))),contextTarget);
    const quotePortal=quoteTarget&&createPortal(h('div',{className:'tc-quoted-message'},h('blockquote',null,quoteTarget.exact),h('div',null,quoteTarget.text)),quoteTarget.element);
    if(observeOnly)return h('span',{ref:root,className:'tc-native-bridge'},
      ownBranch&&h(Button,{className:'tc-native-action',title:ownBranch.anchor.exact,onClick:()=>actions?.jumpTo(ownBranch)},'↖ 来源'),
      notice&&h('span',{className:'tc-native-notice',role:'status'},notice,h(Button,{onClick:()=>setNotice(null),'aria-label':'关闭提示'},'×')),
      selectionButton&&createPortal(h('div',{className:'tc-native-surface'},selectionButton),document.body),...markers,quotePortal);
    return h('div', { className:'tc-native-host', ref:root, 'data-treechat-session':sessionId, onPointerUp:selectText, onMouseUp:selectText, onKeyUp:e => { if (e.key==='Shift') selectText(); }, onScrollCapture:() => setSelection(null) },
      notice && h('div', { className:'tc-notice', role:'status' }, notice, h(Button, { onClick:() => setNotice(null), 'aria-label':'关闭提示' }, '×')),

      props.renderFactorySlot('conversation.content', { variant:'embedded', phase, hero:phase==='hero' }),
      selectionButton,...markers,quotePortal,contextPortal);
  }
  function NativeMainBridge(props) {
    const view=useNativeView(props.sessionId);
    const mounted=useSyncExternalStore(ctx.sidebarRight.mounted.subscribe,ctx.sidebarRight.mounted.getSnapshot,ctx.sidebarRight.mounted.getSnapshot);
    const revealed=useRef(null);
    useEffect(()=>{
      if(!view.jump||view.jump.anchor.sourceSessionId!==props.sessionId||mounted!==props.sessionId||revealed.current===view.jump.nonce)return;
      const frame=requestAnimationFrame(()=>{
        revealed.current=view.jump.nonce;
        if(ctx.sidebarRight.mounted.getSnapshot()===props.sessionId&&ctx.sidebarRight.isExpanded()&&ctx.sidebarRight.active()?.kind==='treechat')ctx.sidebarRight.toggleExpanded();
      });
      return()=>cancelAnimationFrame(frame);
    },[view.jump?.nonce,mounted,props.sessionId]);
    return h(SessionPane,{...props,mode:'main',observeOnly:true,actions:nativeActions(props.sessionId),jump:view.jump?.anchor.sourceSessionId===props.sessionId?view.jump:null});
  }
  function BranchMap({owner,graph,catalog,actions,onMain}) {
    const [zoom,setZoom]=useState(1),[pan,setPan]=useState({x:16,y:16}),viewport=useRef(null),camera=useRef({zoom:1,pan:{x:16,y:16}}),drag=useRef(null);
    camera.current={zoom,pan};
    const applyCamera=next=>{camera.current=next;setZoom(next.zoom);setPan(next.pan);};
    const zoomAt=(value,x,y)=>applyCamera(zoomCamera(camera.current,value,x,y));
    useEffect(()=>{const el=viewport.current;if(el)return bindMapWheel(el,()=>camera.current,applyCamera);},[]);
    const startDrag=e=>{if(e.button!==0||e.target.closest('button'))return;e.preventDefault();drag.current={x:e.clientX,y:e.clientY,pan:camera.current.pan};e.currentTarget.setPointerCapture(e.pointerId);e.currentTarget.dataset.dragging='true';};
    const moveDrag=e=>{if(!drag.current)return;setPan({x:drag.current.pan.x+e.clientX-drag.current.x,y:drag.current.pan.y+e.clientY-drag.current.y});};
    const stopDrag=e=>{drag.current=null;delete e.currentTarget.dataset.dragging;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);};
    const layout=React.useMemo(()=>layoutTree(graph,owner),[graph,owner]);
    const change=value=>{const el=viewport.current;zoomAt(value,(el?.clientWidth||0)/2,(el?.clientHeight||0)/2);};
    const fit=()=>{const el=viewport.current;if(el){const next=Math.max(.35,Math.min((el.clientWidth-32)/layout.width,(el.clientHeight-32)/layout.height,1));setZoom(next);setPan({x:Math.max(16,(el.clientWidth-layout.width*next)/2),y:16});}};
    return h('div',{className:'tc-map'},
      h('div',{className:'tc-map-toolbar',role:'toolbar','aria-label':'树图缩放'},
        h(Button,{title:'缩小','aria-label':'缩小分支树',disabled:zoom<=.35,onClick:()=>change(zoom-.15)},'−'),
        h(Button,{title:'恢复原始大小',onClick:()=>change(1),'aria-label':'重置分支树缩放'},`${Math.round(zoom*100)}%`),
        h(Button,{title:'放大','aria-label':'放大分支树',disabled:zoom>=2,onClick:()=>change(zoom+.15)},'+'),
        h(Button,{onClick:fit,title:'适应窗口；Control + 滚轮缩放，拖动空白处平移'},'适应窗口')),
      h('div',{className:'tc-map-viewport',ref:viewport,tabIndex:0,'aria-label':'会话分支图',onPointerDown:startDrag,onPointerMove:moveDrag,onPointerUp:stopDrag,onPointerCancel:stopDrag,onKeyDown:e=>{const delta={ArrowLeft:[40,0],ArrowRight:[-40,0],ArrowUp:[0,40],ArrowDown:[0,-40]}[e.key];if(delta){e.preventDefault();setPan(p=>({x:p.x+delta[0],y:p.y+delta[1]}));}}},
        h('div',{style:{width:'100%',height:'100%',position:'relative'}},
          h('div',{className:'tc-map-canvas',style:{width:layout.width,height:layout.height,transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})`}},
            h('svg',{className:'tc-map-lines',width:layout.width,height:layout.height,'aria-hidden':true},
              h('path',{className:'tc-map-trunk',d:`M46 90V${layout.height-24}`}),
              ...layout.edges.map(e=>h('path',{key:e.id,d:e.source===owner?`M${e.x1} ${e.y1}H${e.x2}`:`M${e.x1} ${e.y1}H${e.x1+22}Q${e.x1+34} ${e.y1} ${e.x1+34} ${e.y1+12}V${e.y2-12}Q${e.x1+34} ${e.y2} ${e.x1+46} ${e.y2}H${e.x2}`})),
              ...layout.edges.filter(e=>e.source===owner).map(e=>h('circle',{key:e.id,cx:46,cy:e.y1,r:4,className:'tc-map-joint'}))),
            h(Button,{className:'tc-map-node tc-map-root',style:{left:24,top:24,width:264,height:66},title:title(owner,catalog,graph),onClick:onMain},h('small',null,'主会话'),h('strong',null,title(owner,catalog,graph))),
            ...layout.nodes.map(n=>h(Button,{key:n.id,className:'tc-map-node',style:{left:n.x,top:n.y,width:n.width,height:n.height},title:n.title,onClick:()=>actions.openBranch(n.id)},h(TreeIcon,{size:15}),h('span',null,n.title))),
            !layout.nodes.length&&h('p',{className:'tc-map-empty'},'选中文字，创建第一个分支')))));
  }
  function NativeBranchTab(props) {
    const owner=props.sessionId,view=useNativeView(owner),graph=graphHook();
    const catalog=useSyncExternalStore(ctx.sessions.list.subscribe,ctx.sessions.list.getSnapshot,ctx.sessions.list.getSnapshot);
    const held=useRetained(view.sideId),branch=graph.branches[view.sideId],actions=nativeActions(owner);
    const composing=useRef(false);
    const tab=props.useTabInfo().tab;
    const draft=view.draft;
    const closeDraft=()=>{const source=draft?.anchor.sourceSessionId;patchNative(owner,{draft:null,sideId:source&&source!==owner?source:null});if(!source||source===owner)tab.actions.close();};
    const promote=async()=>{
      if(view.busy||!branch)return;
      patchNative(owner,{busy:true,error:null});
      try{
        await ctx.sessions.using(branch.sessionId,{source:'controllerOperation'},async ref=>{
          const binding=await ref.ready,result=await binding.session.rename(branch.title);
          if(!result.ok)throw new Error(result.error?.message||'标题保存失败');
        });
        graphStore.promote(branch.sessionId);
        ctx.uiWorkspace.openSession(branch.sessionId);
      }catch(e){patchNative(owner,{error:errorText(e)});}
      finally{patchNative(owner,{busy:false});}
    };
    const renameBranch=async value=>{
      const name=value.trim();if(!branch||view.busy)return false;
      if(!name||name.length>200){patchNative(owner,{error:'名称需为 1–200 个字符'});return false;}
      if(name===branch.title)return true;
      patchNative(owner,{busy:true,error:null});
      try{
        graphStore.ensureWritable();
        await ctx.sessions.using(branch.sessionId,{source:'controllerOperation'},async ref=>{const binding=await ref.ready,result=await binding.session.rename(name);if(!result.ok)throw new Error(result.error?.message||'名称保存失败');});
        graphStore.rename(branch.sessionId,name);return true;
      }catch(e){patchNative(owner,{error:errorText(e)});return false;}finally{patchNative(owner,{busy:false});}
    };
    const treeButton=h(Button,{className:'tc-icon-button',title:'查看分支树','aria-label':'查看分支树',disabled:view.busy,onClick:()=>patchNative(owner,{treeOpen:true})},h(TreeIcon,{size:18}));
    const header=(heading,back,treeMode=false)=>h('div',{className:'tc-panel-header'},
      h(Button,{className:'tc-icon-button',onClick:back,disabled:view.busy,title:treeMode?'返回刚才的会话':draft?'取消分支':'返回上一级并定位原文','aria-label':treeMode?'返回刚才的会话':draft?'取消分支':'返回原文'},h(Icon,{name:'back'})),
      !treeMode&&branch&&!draft?h(EditableBranchTitle,{key:branch.sessionId,name:heading,busy:view.busy,onSave:renameBranch}):h('strong',{className:'tc-panel-title',title:heading},heading),
      !treeMode&&branch&&!draft&&!branch.promoted&&h(Button,{className:'tc-icon-button tc-promote',disabled:view.busy,onClick:promote,title:'提升为主会话','aria-label':'提升为主会话'},h(Icon,{name:'promote',size:20})),
      !treeMode&&treeButton);
    const path=view.sideId?C.lineage(graph,view.sideId):[];
    return h('div',{className:`tc-app tc-native-tab ${view.sideId||draft?'tc-has-branch':''}`,'data-treechat-native-tab':owner},

      view.error&&h('div',{className:'tc-error',role:'alert'},h('span',null,view.error),h(Button,{onClick:()=>patchNative(owner,{error:null}),'aria-label':'关闭提示'},h(Icon,{name:'close'}))),
      draft?h('section',{className:'tc-pane tc-draft',style:{visibility:view.treeOpen?'hidden':undefined},'aria-label':'创建分支'},
        header('新分支',closeDraft),
        h('div',{className:'tc-draft-body'},h('blockquote',null,draft.anchor.exact)),
        h('form',{className:'tc-draft-form',onSubmit:e=>submitNative(owner,e)},
          h('div',{className:'tc-composer'},
            h('textarea',{id:'tc-native-question','aria-label':'分支消息',placeholder:'继续聊聊…',autoFocus:true,rows:3,value:draft.question,disabled:view.busy,
              onChange:e=>patchNative(owner,{draft:{...draft,question:e.target.value}}),
              onCompositionStart:()=>{composing.current=true;},onCompositionEnd:()=>{composing.current=false;},
              onKeyDown:e=>{if(shouldSend(e,composing.current))submitNative(owner,e);}}),
            h('div',{className:'tc-composer-actions'},h(Button,{type:'submit',className:'tc-send','aria-label':draft.createdId?'重试发送':'发送分支消息',title:'发送',disabled:view.busy||!draft.question.trim()},h(Icon,{name:view.busy?'loading':'send',size:20})))))):
      view.sideId?h('section',{className:'tc-pane',style:{visibility:view.treeOpen?'hidden':undefined},'aria-label':'分支对话'},
        header(title(view.sideId,catalog,graph),()=>branch?actions.jumpTo(branch):tab.actions.close()),
        path.length>1&&h('nav',{className:'tc-breadcrumbs','aria-label':'分支路径'},path.map((id,i)=>h(React.Fragment,{key:id},i>0&&h(Icon,{name:'chevron',size:11}),i===path.length-1?h('span',{className:'tc-current-crumb','aria-current':'page',title:title(id,catalog,graph)},title(id,catalog,graph)):h(Button,{title:title(id,catalog,graph),onClick:()=>id===owner?actions.jumpTo(graph.branches[path[1]]):actions.openBranch(id)},i===0?'主对话':title(id,catalog,graph))))),
        !held?h('div',{className:'tc-loading'},'加载中…'):held.error?h('div',{role:'alert',className:'tc-error'},held.error):h(props.SessionProvider,{session:held.reference,key:view.sideId},props.renderSlot('treechat.native-session',{mode:'branch',actions,jump:view.jump?.anchor.sourceSessionId===view.sideId?view.jump:null}))):null,
      (view.treeOpen||(!view.sideId&&!draft))&&h('section',{className:'tc-pane tc-tree-overlay','aria-label':'当前对话的分支'},header('分支树',()=>view.sideId||draft?patchNative(owner,{treeOpen:false}):tab.actions.close(),true),
        h(BranchMap,{owner,graph,catalog,actions,onMain:()=>{ctx.uiWorkspace.openSession(owner);tab.actions.close();}})));
  }
  ctx.effect(()=>ctx.sidebarRightTabs.register({id:'dsh-treechat.native',kind:'treechat',title:()=>'分支',guide:[{id:'treechat',order:30,title:()=>'分支',icon:TreeIcon}]}));
  ctx.slots.inject('sidebar.right.pane.tab',()=>ctx.slots.register({name:'sidebar.right.pane.tab',key:'dsh-treechat.native',children:{'treechat.native-session':{kind:'single',scope:'session'}}},NativeBranchTab));
  ctx.slots.inject('treechat.native-session',()=>ctx.slots.register({name:'treechat.native-session'},SessionPane));
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name:'conversation.session.header.actions', id:'treechat.native', order:10 }, NativeMainBridge));
}
module.exports = { inject, apply(ctx) { try { return apply(ctx); } catch (error) { console.error('TreeChat activation failed:', error); throw error; } } };
