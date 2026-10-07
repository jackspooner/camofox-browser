// Native desktop handoff acceptance against an isolated staging service.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const runtime=process.env.CAMOFOX_AGENT_STATE_DIR;
if(!runtime?.endsWith('camofox-watch-test'))throw Error('Use isolated camofox-watch-test runtime');
const ui=process.env.CAMOFOX_HANDOFF_UI_DRIVER || fileURLToPath(new URL('./control-ui.py',import.meta.url));
const exec=promisify(execFile), client=new Client({name:'handoff-acceptance',version:'1'});
const fixture=createServer((_req,res)=>res.end('<!doctype html><title>Control handoff acceptance</title><h1>Control handoff acceptance</h1><input aria-label="Note"><button>Demo</button>'));
await new Promise(r=>fixture.listen(0,'127.0.0.1',r));
let sessionId;
const call=async(name,args)=>{const r=await client.callTool({name,arguments:args},undefined,{timeout:120000});if(r.isError)throw Error(r.content[0].text);return r.structuredContent||JSON.parse(r.content[0].text);};
const activate=async label=>{const r=await exec('/usr/bin/python3',[ui,label]);console.log(r.stdout.trim());return r.stdout;};
const ready=async()=>{for(let i=0;i<100;i++){const s=await call('camofox_session_status',{sessionId});if(s.viewer.state==='connected')return s;await new Promise(r=>setTimeout(r,100));}throw Error('Viewer did not reconnect');};
try {
 await client.connect(new StdioClientTransport({command:process.execPath,args:[`--env-file=${runtime}/service.env`,'mcp/server.mjs'],cwd:process.cwd(),env:{...process.env,CAMOFOX_USER_ID:'handoff-acceptance'},stderr:'pipe'}));
 assert.equal((await client.listTools()).tools.length,27);
 const profile=await call('camofox_profile_create',{name:'Control handoff acceptance '+Date.now()});
 sessionId=(await call('camofox_session_create',{profileId:profile.id,name:'Control handoff acceptance'})).id;
 const tab=await call('camofox_create_tab',{sessionId,url:`http://127.0.0.1:${fixture.address().port}`});
 await call('camofox_session_watch',{sessionId,open:true});await ready();
 const give=call('camofox_session_control',{sessionId,action:'give'});
 await new Promise(r=>setTimeout(r,600));
 const tree=await activate('inspect');assert(tree.includes('offering you control'));assert(tree.includes('s to respond'));
 await activate('Accept control');assert.equal((await give).outcome,'accepted');
 assert.equal((await ready()).humanControl,true);
 await assert.rejects(call('camofox_type',{tabId:tab.tabId,selector:'input',text:'blocked'}),/human_control/);
 const decline=call('camofox_session_control',{sessionId,action:'request'});
 await activate('Decline');assert.equal((await decline).outcome,'declined');assert.equal((await ready()).humanControl,true);
 const request=call('camofox_session_control',{sessionId,action:'request'});
 await activate('Return control');assert.equal((await request).outcome,'accepted');assert.equal((await ready()).humanControl,false);
 await call('camofox_snapshot',{tabId:tab.tabId});
 await call('camofox_type',{tabId:tab.tabId,selector:'input',text:'Agent regained control after acceptance'});
 const start=Date.now(), timeout=await call('camofox_session_control',{sessionId,action:'give'});
 assert.equal(timeout.outcome,'timed_out');assert(Date.now()-start>=14900);assert.equal((await ready()).humanControl,false);
 const cancelled=call('camofox_session_control',{sessionId,action:'give'});
 await activate('Close');assert.equal((await cancelled).outcome,'cancelled');
 console.log('PASS: native UI countdown, offer acceptance, blocked mutation, decline, accepted return, resumed typing, 15-second timeout, close cancellation; 27-tool MCP catalogue.');
} finally {
 if(sessionId){await call('camofox_session_watch',{sessionId,open:false}).catch(()=>{});await call('camofox_session_suspend',{sessionId}).catch(()=>{});}
 await client.close();fixture.close();
}
