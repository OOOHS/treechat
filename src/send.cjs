'use strict';

// A fork's inherited request history is not its live model configuration.
// DSH creates the new Agent with the global default route, so explicitly apply
// the parent's current complete selection before admitting the first prompt.
function selectedModel(session) {
  const state = session?.projections.faceOf('modelSelection').getSnapshot();
  const selection = state?.next ?? state?.lastUsed;
  if (!selection) return null;
  return { provider:selection.provider, model:selection.model,
    ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort:selection.reasoningEffort }) };
}

async function sendFirstMessage({sessions,remote,conversation}, id, model, text) {
  return sessions.using(id,{source:'controllerOperation'},async ref=>{
    const binding=await ref.ready;
    if(model) {
      const result=await remote.session.selectModel({sessionId:id,...model});
      if(!result.ok)throw new Error(`分支模型设置失败：${result.error?.message||result.error?.code||'未知错误'}`);
    }
    // Use the same admission path as DSH's normal composer, addressed with the
    // child's concrete Session rather than a parent-scoped conversation.send.
    const result=await conversation.sendSession(binding.session,text,[],'queue');
    if(result.kind!=='success') {
      const error=binding.session.getSnapshot().promptError;
      throw new Error(error?.error?.message||'问题未被接受，请重试');
    }
  });
}

module.exports={selectedModel,sendFirstMessage};
