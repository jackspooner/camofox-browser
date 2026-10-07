// Production smoke test using the installed Codex/Hermes MCP registrations.
// Uses only the inactive Codex default session, restoring its owner and suspension.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const configs=JSON.parse(execFileSync('/usr/bin/python3',['-c',`import json,tomllib,yaml,pathlib
h=pathlib.Path.home()
print(json.dumps({'codex':tomllib.loads((h/'.codex/config.toml').read_text())['mcp_servers']['camofox'],'hermes':yaml.safe_load((h/'.hermes/config.yaml').read_text())['mcp_servers']['camofox']}))`],{encoding:'utf8'}));
const clients={};let sessionId,owner='codex',tabId;
async function call(who,name,args){const r=await clients[who].callTool({name,arguments:args},undefined,{timeout:180000});if(r.isError)throw Error(r.content[0].text);return r.structuredContent || JSON.parse(r.content[0].text);}
try{
 for(const [name,config] of Object.entries(configs)){
  const client=new Client({name:'watch-consumer-acceptance',version:'1'});
  await client.connect(new StdioClientTransport({command:config.command,args:config.args,cwd:config.cwd,env:{PATH:process.env.PATH,HOME:process.env.HOME,...config.env},stderr:'pipe'}));clients[name]=client;
  const tools=await client.listTools();assert.equal(tools.tools.length,26);assert(tools.tools.some(t=>t.name==='camofox_session_watch'));
  console.log(name+': registered MCP exposes 26 tools including session_watch');
 }
 const list=await call('codex','camofox_session_list',{});
 const session=list.sessions.find(s=>s.owner==='codex'&&s.name==='Default'&&s.state==='suspended');assert(session,'No inactive Codex default session available');sessionId=session.id;
 await call('codex','camofox_session_resume',{sessionId});
 const tab=await call('codex','camofox_create_tab',{sessionId,url:'http://126.0.0.1:23161'});tabId=tab.tabId;
 for(const who of ['codex','hermes']){
  if(who==='hermes'){await call('codex','camofox_session_release',{sessionId});await call('hermes','camofox_session_resume',{sessionId});owner='hermes';}
  const opened=await call(who,'camofox_session_watch',{sessionId,open:true});assert.equal(opened.state,'connected');assert.equal(opened.mode,'watch');
  await call(who,'camofox_type',{tabId,selector:'input',text:who+' production watch smoke'});
  const status=await call(who,'camofox_session_status',{sessionId});assert.equal(status.humanControl,false);assert.equal(status.viewer.state,'connected');
  const closed=await call(who,'camofox_session_watch',{sessionId,open:false});assert.equal(closed.state,'closed');
  console.log(who+': desktop open, live native typing, structured status and close verified in production');
 }
}finally{
 if(sessionId){
  await call(owner,'camofox_session_watch',{sessionId,open:false}).catch(()=>{});
  if(tabId)await call(owner,'camofox_close_tab',{tabId}).catch(()=>{});
  if(owner!=='codex'){await call(owner,'camofox_session_release',{sessionId});await call('codex','camofox_session_resume',{sessionId});owner='codex';}
  await call(owner,'camofox_session_suspend',{sessionId});
 }
 for(const client of Object.values(clients))await client.close();
}
