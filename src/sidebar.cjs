'use strict';

const emptyGraph = {branches:{}};
const isHidden = (graph, id) => Boolean(graph.branches[id] && !graph.branches[id].promoted);

// Project only the workspace browser's inputs. Session binding, persistence,
// native forks and all other consumers keep the complete host catalog.
function projectWorkspace(graph, list, workspaces) {
  const visible = id => !isHidden(graph,id);
  if (!Object.keys(graph.branches).some(id => isHidden(graph,id))) return {list,workspaces};
  return {
    list:{...list,ids:list.ids.filter(visible),byId:Object.fromEntries(Object.entries(list.byId).filter(([id])=>visible(id)))},
    workspaces:{...workspaces,items:workspaces.items.map(item=>({...item,sessionIds:item.sessionIds.filter(visible)})),
      pinnedSessionIds:workspaces.pinnedSessionIds.filter(visible),archivedSessionIds:workspaces.archivedSessionIds.filter(visible)}
  };
}
function filterSearch(graph, result) {
  return {...result,items:result.items.filter(item=>!isHidden(graph,item.sessionId))};
}

// DSH 0.2.1-alpha.2 exposes the native browser as a SlotCore StoredEntry.
// Its component seat is mutable, but it has no row-filter extension. Wrap that
// seat so the native component keeps its original store, inject face, children,
// navigation, keyboard handling and locale. Restore it when the plugin unloads.
function installWorkspaceFilter(slots, graphStore, React) {
  const {createElement:h,useMemo,useSyncExternalStore}=React;
  const wrappers=new Map(),listeners=new Set();
  let enabled=true;
  const getGraph=()=>enabled?graphStore.getSnapshot():emptyGraph;
  const subscribe=listener=>{listeners.add(listener);return()=>listeners.delete(listener);};
  const notify=()=>{for(const listener of listeners)listener();};
  const offGraph=graphStore.subscribe(notify);
  function reconcile() {
    for(const entry of slots.entries('sidebar.workspaces')) {
      if(wrappers.has(entry)||entry.component?.name!=='WorkspaceBrowser')continue;
      const Original=entry.component;
      function TreeChatWorkspaceBrowser(props) {
        const graph=useSyncExternalStore(subscribe,getGraph,getGraph);
        const list=props.useSessions(value=>value);
        const workspaces=props.useWorkspaces(value=>value);
        const projected=useMemo(()=>projectWorkspace(graph,list,workspaces),[graph,list,workspaces]);
        const hooks=useMemo(()=>({
          useSessions:selector=>selector(projected.list),
          useWorkspaces:selector=>selector(projected.workspaces),
          searchSessions:async(...args)=>filterSearch(getGraph(),await props.searchSessions(...args))
        }),[projected,props.searchSessions]);
        return h(Original,{...props,...hooks});
      }
      wrappers.set(entry,{Original,Wrapped:TreeChatWorkspaceBrowser});
      entry.component=TreeChatWorkspaceBrowser;
    }
  }
  const offSlots=slots.subscribe('sidebar.workspaces',reconcile);
  reconcile();
  return()=>{
    enabled=false;offGraph();offSlots();
    for(const [entry,{Original,Wrapped}] of wrappers)if(entry.component===Wrapped)entry.component=Original;
    notify();listeners.clear();wrappers.clear();
  };
}
module.exports={isHidden,projectWorkspace,filterSearch,installWorkspaceFilter};
