#!/usr/bin/env node
// Restore declared dependencies locally; never start services or modify profiles.
import {spawnSync} from 'node:child_process';
import {lstatSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
if(process.platform!=='linux'||Number(process.versions.node.split('.')[0])!==24)throw Error('Worktree setup is verified on Linux with Node 24. Put Node 24 and npm on PATH.');
const env=Object.fromEntries(['PATH','HOME','LANG','TMPDIR','XDG_CACHE_HOME','npm_config_cache','HTTPS_PROXY','HTTP_PROXY','NO_PROXY'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
env.CAMOFOX_SKIP_DOWNLOAD='1';
const run=(command,args,cwd=root)=>{
 const result=spawnSync(command,args,{cwd,env,stdio:'inherit'});
 if(result.error||result.status!==0)throw Error(`${command} failed (${result.status??result.error?.code}). Install prerequisites or repair the reported dependency error, then rerun setup.`);
};
run('git',['rev-parse','--show-toplevel']);
run('npm',['--version']);
run('python3',['--version']);
for(const relative of ['node_modules','mcp/node_modules'])if(existsSync(join(root,relative))&&lstatSync(join(root,relative)).isSymbolicLink())throw Error(`Refusing shared dependency directory ${relative}. Remove that symlink in this worktree, then rerun.`);
run('npm',['ci','--no-audit','--no-fund']);
run('npm',['ci','--no-audit','--no-fund'],join(root,'mcp'));
run(process.execPath,['--check','server.js']);
run(process.execPath,['-e',"const Database=require('better-sqlite3');new Database(':memory:').close();require('sharp');console.log('Native dependencies ready')"]);
run('npm',['run','generate-openapi']);
run('git',['diff','--exit-code','--','package-lock.json','mcp/package-lock.json','openapi.json','agent-openapi.json','lib/platform/routes.js','openclaw.plugin.json']);
run(process.execPath,['--test','tests/platform/contracts.test.js']);
console.log('Worktree ready. Browser/VPN/viewer acceptance needs separately configured resources; no service was started.');
