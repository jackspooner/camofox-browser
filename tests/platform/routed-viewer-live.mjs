// Default: isolated gateway, helper/config, profiles and real Proton US routing.
// --installed: explicit post-deployment smoke via installed Codex/Hermes MCP
// registrations, creating two clearly named profiles and leaving them suspended.
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import express from 'express';
import { loadPlatformConfig } from '../../lib/config.js';
import { Supervisor } from '../../lib/platform/supervisor.js';
import { ProtonProvider } from '../../lib/platform/proton-launcher.js';
import { installPlatformRoutes } from '../../lib/platform/routes.js';
import { installViewer } from '../../lib/platform/viewer.js';
import { startDesktop } from '../../lib/platform/viewer-launcher.js';

const installed = process.argv.includes('--installed');
const config = loadPlatformConfig(), exec = promisify(execFile);
let supervisor, server, stateDir, configurations;
const activate = async label => { await exec('/usr/bin/python3', ['tests/platform/control-ui.py', label]); };
try {
  if (installed) {
    configurations = JSON.parse(execFileSync('/usr/bin/python3', ['-c', `import json,tomllib,yaml,pathlib
h=pathlib.Path.home()
print(json.dumps({'codex':tomllib.loads((h/'.codex/config.toml').read_text())['mcp_servers']['camofox'],'hermes':yaml.safe_load((h/'.hermes/config.yaml').read_text())['mcp_servers']['camofox']}))`], { encoding: 'utf8' }));
  } else {
    const cache = process.argv[2]; assert(cache && !cache.startsWith('--'), 'Pass the installed browser cache directory');
    stateDir = mkdtempSync(join(tmpdir(), 'cf-route-'));
    symlinkSync(resolve(cache), join(stateDir, 'cache'));
    Object.assign(config, { stateDir, accessKey: randomUUID(), vpnHelper: join(stateDir, 'helper.py') });
    const cfgPath = join(stateDir, 'helper.json');
    writeFileSync(config.vpnHelper, readFileSync('scripts/platform/camofox-netns.py', 'utf8').replace("CFG = pathlib.Path('/etc/camofox-agent.json')", `CFG = pathlib.Path(${JSON.stringify(cfgPath)})`), { mode: 0o755 });
    writeFileSync(cfgPath, JSON.stringify({ uid: process.getuid(), gid: process.getgid(), home: process.env.HOME,
      stateDir, node: process.execPath, path: process.env.PATH,
      bootstrapScript: resolve('scripts/platform/worker-bootstrap.mjs'),
      viewerScript: resolve('scripts/platform/viewer-backend.mjs'), agentScript: resolve('scripts/platform/proton-agent.py') }), { mode: 0o600 });
    execFileSync('sudo', ['-n','chown','root:root',config.vpnHelper,cfgPath]);
    supervisor = new Supervisor(config, new ProtonProvider(config));
    const app = express(); app.use(express.json()); server = createServer(app);
    await new Promise(r => server.listen(0, '127.0.0.1', r)); config.port = server.address().port;
    const viewer = installViewer(app, server, supervisor, config);
    app.use((req,res,next) => req.headers.authorization === `Bearer ${config.accessKey}` ? next() : res.sendStatus(401));
    installPlatformRoutes(app, supervisor, config, viewer);
    app.use((error,_req,res,_next) => res.status(error.statusCode || 500).json({ code:error.code, error:error.message }));
    configurations = Object.fromEntries(['codex','hermes'].map(name => [name, { command:process.execPath,args:['mcp/server.mjs'],cwd:process.cwd(),env:{
      CAMOFOX_BASE_URL:`http://127.0.0.1:${config.port}`,CAMOFOX_ACCESS_KEY:config.accessKey,CAMOFOX_API_KEY:config.accessKey,CAMOFOX_USER_ID:`${name}-viewer-acceptance`,
    } }]));
  }
  for (const [identity, registration] of Object.entries(configurations)) {
    const client = new Client({ name:'routed-viewer-acceptance',version:'1' });
    let sessionId, desktop;
    const call = async (name,args) => {
      const result = await client.callTool({ name,arguments:args }, undefined, { timeout:240000 });
      const value = result.structuredContent || JSON.parse(result.content[0].text);
      if (result.isError) throw Error(JSON.stringify(value));
      if (!value.pending) return value;
      for (;;) {
        const state = await call('camofox_operation_status',{operationId:value.operation.id});
        if (state.operation.state === 'completed') return state.result;
        if (['failed','cancelled','outcome_unknown'].includes(state.operation.state)) throw Error(JSON.stringify(state));
        await delay(100);
      }
    };
    const ready = async predicate => {
      for(let i=0;i<100;i++) {
        const s=await call('camofox_session_status',{sessionId});
        if(predicate(s))return s;await delay(100);
      }
      throw Error('Viewer status deadline');
    };
    try {
      await client.connect(new StdioClientTransport({ command:registration.command,args:registration.args,cwd:registration.cwd,
        env:{PATH:process.env.PATH,HOME:process.env.HOME,...registration.env},stderr:'pipe' }));
      assert.equal((await client.listTools()).tools.length,30);
      const profile=await call('camofox_profile_create',{name:`Viewer fix acceptance ${identity} ${Date.now()}`});
      sessionId=(await call('camofox_session_create',{profileId:profile.id,name:`Control handoff acceptance ${identity}`})).id;
      for(const country of [null,'US']) {
        if(country)await call('camofox_session_route',{sessionId,country});
        const tab=await call('camofox_create_tab',{sessionId,url:'https://api.protonvpn.ch/vpn/v1/location'});
        const egress=async()=>JSON.parse((await call('camofox_evaluate',{tabId:tab.tabId,expression:"fetch('/vpn/v1/location',{headers:{'x-pm-appversion':'linux-vpn-cli@5.8.7'}}).then(r=>r.text())"})).result);
        if(country)assert.equal((await egress()).Country,'US');
        const marker=`${identity} ${country || 'direct'} viewer verified`;
        await call('camofox_evaluate',{tabId:tab.tabId,expression:`document.body.innerHTML=${JSON.stringify('<h1>'+marker+'</h1><input aria-label="Test input">')};document.body.style='background:#246840;color:white;font:28px sans-serif;padding:60px';true`});
        await call('camofox_session_watch',{sessionId,open:true});
        await ready(s=>s.viewer.state==='connected' && !s.humanControl);
        await call('camofox_session_watch',{sessionId,open:true});
        await activate('Take control'); await ready(s=>s.humanControl);
        await activate('Return to agent'); await ready(s=>s.viewer.state==='connected'&&!s.humanControl);
        await call('camofox_snapshot',{tabId:tab.tabId});
        await call('camofox_type',{tabId:tab.tabId,selector:'input',text:'control returned',mode:'fill'});
        assert.equal((await call('camofox_evaluate',{tabId:tab.tabId,expression:"document.querySelector('input').value"})).result,'control returned');
        await call('camofox_session_watch',{sessionId,open:false});
        const login=await call('camofox_session_viewer',{sessionId});
        desktop=await startDesktop(config,login.url,`Control handoff acceptance ${identity} login`,()=>{});
        await ready(s=>s.viewer.state==='connected'&&s.humanControl);
        await activate('Close'); desktop.close(); desktop=null;
        await ready(s=>s.viewer.state==='closed'&&!s.humanControl);
        if(country)assert.equal((await egress()).Country,'US');
        console.log(`PASS ${installed?'installed registration':'isolated adapter'} ${identity} ${country||'direct'}: watch, repeat-open, takeover/return, typing, login viewer, close${country?', US egress preserved':''}`);
      }
    } finally {
      desktop?.close();
      if(sessionId) {
        await call('camofox_session_watch',{sessionId,open:false}).catch(()=>{});
        await call('camofox_session_suspend',{sessionId}).catch(error=>console.error('Acceptance suspension failed:',error.message));
      }
      await client.close();
    }
  }
} finally {
  if(supervisor)await supervisor.close();
  if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}
  if(stateDir)rmSync(stateDir,{recursive:true,force:true});
}
