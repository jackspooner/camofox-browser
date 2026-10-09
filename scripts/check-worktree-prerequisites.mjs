#!/usr/bin/env node
// Check native prerequisites without installing or changing runtime resources.
import {spawnSync} from 'node:child_process';
import {lstatSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
if(Number(process.versions.node.split('.')[0])<22)throw Error('Node >=22 is required by the declared engines. Install the .nvmrc version and rerun.');
if(process.platform!=='linux'||process.versions.node!=='24.21.0')console.warn(`Expected Linux/Node 24.21.0; found ${process.platform}/Node ${process.versions.node}. Continuing with readiness checks; live platform support requires separate verification.`);
const env=Object.fromEntries(['PATH','HOME','LANG','TMPDIR','XDG_CACHE_HOME','npm_config_cache','HTTPS_PROXY','HTTP_PROXY','NO_PROXY'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
env.CAMOFOX_SKIP_DOWNLOAD='1';
const run=(command,args,cwd=root)=>{
 const result=spawnSync(command,args,{cwd,env,stdio:'inherit'});
 if(result.error||result.status!==0)throw Error(`${command} failed (${result.status??result.error?.code}). Install prerequisites or repair the reported dependency error, then rerun setup.`);
};
run('git',['rev-parse','--show-toplevel']);
const npmVersion=spawnSync('npm',['--version'],{env,encoding:'utf8'});
if(npmVersion.status!==0)throw Error('npm is unavailable; install npm alongside Node, then rerun.');
console.log('npm '+npmVersion.stdout.trim());
if(!npmVersion.stdout.trim().startsWith('11.'))console.warn('Expected npm 11.x; continuing with lockfile and native-module readiness checks.');
run('python3',['--version']);
for(const relative of ['node_modules','mcp/node_modules'])if(existsSync(join(root,relative))&&lstatSync(join(root,relative)).isSymbolicLink())throw Error(`Refusing shared dependency directory ${relative}. Remove that symlink in this worktree, then rerun.`);
console.log('Node/npm/Python prerequisites ready; dependencies are managed by the adapter.');
