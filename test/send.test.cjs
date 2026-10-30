const {test}=require('node:test');
const assert=require('node:assert/strict');
const {selectedModel,sendFirstMessage}=require('../src/send.cjs');

test('branch inherits the pending parent route and effort, not an older request or global default',()=>{
  const pending={provider:'custom-working-provider',model:'working-model',reasoningEffort:'low'};
  const state={next:pending,lastUsed:{provider:'old-provider',model:'old-model'}};
  const copy=selectedModel({projections:{faceOf:key=>{assert.equal(key,'modelSelection');return{getSnapshot:()=>state};}}});
  pending.model='later-selection';
  assert.deepEqual(copy,{provider:'custom-working-provider',model:'working-model',reasoningEffort:'low'});
});

function harness({selectionFailure=false,sendFailure=false}={}) {
  const calls=[],session={sessionId:'child',getSnapshot:()=>({promptError:{error:{message:'admission denied'}}})};
  const ctx={
    sessions:{using:async(id,options,fn)=>{
      assert.equal(id,'child');calls.push('retain');
      try{return await fn({ready:Promise.resolve({session})});}finally{calls.push('release');}
    }},
    remote:{session:{selectModel:async request=>{calls.push(['select',request]);return selectionFailure?{ok:false,error:{message:'route unavailable'}}:{ok:true};}}},
    conversation:{sendSession:async(target,text,attachments,mode)=>{
      assert.equal(target,session);assert.deepEqual(attachments,[]);assert.equal(mode,'queue');
      calls.push(['send',text]);return{kind:sendFailure?'error':'success'};
    }}
  };
  return{ctx,calls};
}

test('first branch prompt uses the native composer with a retained child and confirmed model selection',async()=>{
  const {ctx,calls}=harness();
  await sendFirstMessage(ctx,'child',{provider:'working-provider',model:'working-model',reasoningEffort:'high'},'branch question');
  assert.deepEqual(calls,['retain',['select',{sessionId:'child',provider:'working-provider',model:'working-model',reasoningEffort:'high'}],['send','branch question'],'release']);
});

test('a failed branch model selection stops admission instead of silently sending to the global default',async()=>{
  const {ctx,calls}=harness({selectionFailure:true});
  await assert.rejects(sendFirstMessage(ctx,'child',{provider:'working-provider',model:'working-model'},'question'),/route unavailable/);
  assert.ok(!calls.some(c=>Array.isArray(c)&&c[0]==='send'));
  assert.equal(calls.at(-1),'release');
});

test('native admission failure reaches the retryable branch draft',async()=>{
  const {ctx}=harness({sendFailure:true});
  await assert.rejects(sendFirstMessage(ctx,'child',null,'question'),/admission denied/);
});
