#!/usr/bin/env node
// Delegate setup to the shared owner; the adapter calls underlying native actions.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
const cli=process.env.WORKSPACE2_DEVTASK_CLI;
const command=cli?process.execPath:'devtask';
const args=[...(cli?[cli]:[]),'setup','--repo',root,'--scope',process.argv[2]??'full','--json'];
const result=spawnSync(command,args,{cwd:root,env:process.env,stdio:'inherit'});
if(result.error)throw Error('Install Workspace2DevTasks or configure WORKSPACE2_DEVTASK_CLI, then rerun setup.');
process.exitCode=result.status??1;
