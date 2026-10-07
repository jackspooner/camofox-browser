// Read-only production registration smoke; missing-session request cannot alter control.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
const configs=JSON.parse(execFileSync('/usr/bin/python3',['-c',`import json,tomllib,yaml,pathlib
h=pathlib.Path.home()
print(json.dumps({'codex':tomllib.loads((h/'.codex/config.toml').read_text())['mcp_servers']['camofox'],'hermes':yaml.safe_load((h/'.hermes/config.yaml').read_text())['mcp_servers']['camofox']}))`],{encoding:'utf8'}));
for(const [name,c] of Object.entries(configs)){
 const client=new Client({name:'handoff-registration-smoke',version:'1'});
 try {
  await client.connect(new StdioClientTransport({command:c.command,args:c.args,cwd:c.cwd,env:{PATH:process.env.PATH,HOME:process.env.HOME,...c.env},stderr:'pipe'}));
  const catalog=await client.listTools();assert.equal(catalog.tools.length,27);
  const tool=catalog.tools.find(t=>t.name==='camofox_session_control');assert.deepEqual(tool.inputSchema.properties.action.enum,['give','request']);
  const result=await client.callTool({name:tool.name,arguments:{sessionId:'handoff-registration-check-missing-session',action:'give'}});
  assert(result.isError);assert.equal(result.structuredContent.problem.code,'session_not_found');
  console.log(name+': 27 tools, give/request schema and production REST error parity verified.');
 }finally{await client.close();}
}
