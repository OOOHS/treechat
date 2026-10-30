// Explicit test-only model. Never included in the installable plugin package.
import { appendFile } from 'node:fs/promises';
export const inject = ['llm'];
export function apply(ctx) {
  ctx.on('llm/stream', async function* (options) {
    const messages=options.messages.filter(m=>m.role==='user'||m.role==='assistant').map(m=>({role:m.role,text:(m.content??[]).filter(b=>b.type==='text').map(b=>b.text).join('\n')}));
    const last=messages.filter(m=>m.role==='user').at(-1)?.text??'';
    let text;
    if(last.includes('BRANCH_ONLY_472')) text='[本地联调] Tool Discovery 负责发现、筛选和暴露工具；MCP 是连接工具与数据源的协议。BRANCH_ONLY_472 已保留在这个分支。';
    else if(last.includes('NESTED_ONLY_915')) text='[本地联调] MCP 规定工具描述、调用与资源访问的接口。这是孙分支里的 NESTED_ONLY_915。';
    else if(last.includes('PARENT_CHECK_103')) text='[本地联调] 主对话继续讨论 Agent Harness。旁支讨论没有自动写回主会话。';
    else text='[本地联调] Agent Harness 管理模型与执行环境的交互。Tool Discovery 负责发现并向模型暴露工具。MCP 为连接外部工具与资源提供协议。';
    if(process.env.TREECHAT_TEST_LOG) await appendFile(process.env.TREECHAT_TEST_LOG,JSON.stringify({sessionId:options.sessionId,messages,response:text})+'\n');
    yield {type:'block-start',index:0,blockType:'text'};
    for(const part of text.match(/.{1,14}/gu)??[]) yield {type:'text-delta',index:0,text:part};
    yield {type:'block-end',index:0,block:{type:'text',text}};
    yield {type:'finish',reason:'stop'};
  });
}
