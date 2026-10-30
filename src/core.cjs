'use strict';

const STORAGE_KEY = 'dsh-treechat:v1';
const emptyGraph = () => ({ version: 1, branches: {} });
function invariant(ok, message) { if (!ok) throw new Error(message); }
function hashText(text) {
  let n = 2166136261;
  for (let i = 0; i < text.length; i++) n = Math.imul(n ^ text.charCodeAt(i), 16777619);
  return (n >>> 0).toString(16);
}
function makeAnchor({ sessionId, nodeKey, atSeq, text, start, end, part = null }) {
  invariant(typeof sessionId === 'string' && sessionId && typeof nodeKey === 'string' && nodeKey, '缺少来源消息');
  invariant(Number.isSafeInteger(atSeq) && atSeq >= 0, '这条消息尚未保存，回复完成后再创建分支');
  invariant(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end > start && end <= text.length, '文本选区已失效，请重新选择');
  invariant(text.slice(start, end).trim(), '请选择有内容的文字');
  invariant(end - start <= 12000, '选区过长，请选择更具体的片段');
  return { version: 1, sourceSessionId: sessionId, nodeKey, part, atSeq,
    start, end, textHash: hashText(text), exact: text.slice(start, end),
    prefix: text.slice(Math.max(0, start - 48), start), suffix: text.slice(end, end + 48) };
}
function resolveAnchor(text, anchor) {
  if (hashText(text) === anchor.textHash && text.slice(anchor.start, anchor.end) === anchor.exact) return { start: anchor.start, end: anchor.end };
  const candidates = [];
  let from = 0;
  while (from <= text.length) {
    const start = text.indexOf(anchor.exact, from);
    if (start < 0) break;
    const end = start + anchor.exact.length;
    const score = (anchor.prefix && text.slice(Math.max(0, start - anchor.prefix.length), start) === anchor.prefix ? 1 : 0)
      + (anchor.suffix && text.slice(end, end + anchor.suffix.length) === anchor.suffix ? 1 : 0);
    candidates.push({ start, end, score }); from = start + 1;
  }
  candidates.sort((a, b) => b.score - a.score);
  // An ambiguous repeated quote must never silently jump to the wrong place.
  if (!candidates.length || (candidates[1] && candidates[0].score === candidates[1].score)) return null;
  return { start: candidates[0].start, end: candidates[0].end };
}
function messageSeq(node) {
  if (!node) return null;
  let seq;
  if (node.kind === 'assistant-step') {
    const final = node.data?.finalNode;
    if (!final?.messageId || node.data.status === 'running') return null;
    seq = final.seq;
  } else if (node.kind === 'user' || node.kind === 'steering') seq = node.data?.seq;
  else return null;
  return Number.isSafeInteger(seq) && seq >= 0 ? seq : null;
}
function validateGraph(input) {
  invariant(input && input.version === 1 && input.branches && typeof input.branches === 'object' && !Array.isArray(input.branches), '不支持的 TreeChat 数据格式');
  const branches = {};
  invariant(Object.keys(input.branches).length <= 10000, '分支数量超过导入上限');
  for (const [id, b] of Object.entries(input.branches)) {
    invariant(id !== '__proto__' && id !== 'constructor' && id !== 'prototype', '无效的分支标识');
    invariant(b && b.sessionId === id && typeof b.parentId === 'string' && b.parentId && id !== b.parentId, '分支关系无效');
    const a = b.anchor;
    invariant(a && a.sourceSessionId === b.parentId && typeof a.nodeKey === 'string' && a.nodeKey && typeof a.exact === 'string' && a.exact.trim() && a.exact.length <= 12000, '分支锚点无效');
    invariant(Number.isSafeInteger(a.atSeq) && a.atSeq >= 0 && Number.isInteger(a.start) && Number.isInteger(a.end) && a.start >= 0 && a.end > a.start && a.end - a.start === a.exact.length, '分支位置无效');
    invariant(typeof a.textHash === 'string' && typeof a.prefix === 'string' && typeof a.suffix === 'string', '分支引用无效');
    invariant(typeof b.title === 'string' && b.title.length <= 200 && typeof b.promoted === 'boolean' && Number.isFinite(b.createdAt), '分支信息无效');
    branches[id] = { sessionId: id, parentId: b.parentId, anchor: { ...a }, title: b.title, promoted: b.promoted, createdAt: b.createdAt };
  }
  const graph = { version: 1, branches };
  for (const id of Object.keys(branches)) lineage(graph, id);
  return graph;
}
function lineage(graph, id) {
  const path = [], seen = new Set();
  while (id) {
    invariant(!seen.has(id), '分支关系形成循环'); seen.add(id);
    path.unshift(id); id = graph.branches[id]?.parentId;
  }
  return path;
}
function children(graph, id) { return Object.values(graph.branches).filter(b => b.parentId === id).sort((a,b) => a.createdAt - b.createdAt); }
function rootSessions(graph, catalog) { return catalog.filter(s => s.origin !== 'subagent' && (!graph.branches[s.id] || graph.branches[s.id].promoted)); }
function branchPrompt(anchor, question) {
  invariant(question.trim(), '请先输入一个问题');
  return `> ${anchor.exact.split('\n').join('\n> ')}\n\n${question.trim()}`;
}
function createGraphStore(storage, key = STORAGE_KEY) {
  let state = emptyGraph(), error = null;
  const listeners = new Set();
  let loadedRaw = null;
  try { loadedRaw = storage.getItem(key); if (loadedRaw) state = validateGraph(JSON.parse(loadedRaw)); }
  catch (e) { error = `无法读取分支记录：${e.message}。原始记录已保留，请导出后检查。`; }
  function commit(next) {
    // Never overwrite an unreadable previous document automatically.
    invariant(!error, error);
    invariant(storage.getItem(key) === loadedRaw, '另一个窗口更新了分支记录，请刷新页面后重试，以免覆盖它的修改');
    const validated = validateGraph(next);
    const raw = JSON.stringify(validated);
    storage.setItem(key, raw); loadedRaw = raw;
    state = validated; for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => state,
    subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
    get error() { return error; },
    ensureWritable() { invariant(!error, error); invariant(storage.getItem(key) === loadedRaw, '另一个窗口更新了分支记录，请刷新页面后重试'); storage.setItem(key, loadedRaw ?? JSON.stringify(state)); loadedRaw = storage.getItem(key); },
    add(branch) { invariant(!state.branches[branch.sessionId], '分支已存在'); commit({ ...state, branches: { ...state.branches, [branch.sessionId]: branch } }); },
    rename(id, title) { invariant(state.branches[id], '分支不存在'); invariant(typeof title==='string'&&title.trim()&&title.trim().length<=200, '名称需为 1–200 个字符'); commit({...state,branches:{...state.branches,[id]:{...state.branches[id],title:title.trim()}}}); },
    demote(id) { invariant(state.branches[id], '分支不存在'); commit({ ...state, branches: { ...state.branches, [id]: { ...state.branches[id], promoted: false } } }); },
    promote(id) { invariant(state.branches[id], '分支不存在'); commit({ ...state, branches: { ...state.branches, [id]: { ...state.branches[id], promoted: true } } }); },
    import(raw) { const incoming = validateGraph(JSON.parse(raw)); commit({ version: 1, branches: { ...state.branches, ...incoming.branches } }); },
    export: () => storage.getItem(key) ?? JSON.stringify(state)
  };
}
module.exports = { STORAGE_KEY, emptyGraph, hashText, makeAnchor, resolveAnchor, messageSeq, validateGraph, lineage, children, rootSessions, branchPrompt, createGraphStore };
