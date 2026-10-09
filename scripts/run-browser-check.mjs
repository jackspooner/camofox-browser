// Browser tests require explicit operator-prepared resources, never automatic fetches.
import {spawnSync} from 'node:child_process';
import {accessSync,constants,existsSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {isAbsolute,resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
const suites={unit:'test:unit',plugins:'test:plugins',e2e:'test:e2e'};
const suite=suites[process.argv[2]];
if(!suite)throw Error('Select unit, plugins or e2e.');
const executable=process.env.CAMOFOX_EXECUTABLE_PATH;
if(!executable||!existsSync(executable)||!isAbsolute(executable))throw Error('Set CAMOFOX_EXECUTABLE_PATH to a separately prepared compatible browser before verification. Browser acquisition is not part of development checks.');
accessSync(executable,constants.X_OK);
const parent=resolve('.cutlery/devtask');mkdirSync(parent,{recursive:true});
const directory=mkdtempSync(join(parent,'browser-tests-'));
// Unix socket paths have a small byte limit; keep private temporary roots short.
const temporary=mkdtempSync(join(tmpdir(),'cf-test-'));
const env={...process.env,TMPDIR:temporary,CAMOFOX_SKIP_DOWNLOAD:'1',CAMOUFOX_EXECUTABLE:executable,CAMOUFOX_EXECUTABLE_PATH:executable,CAMOFOX_EXECUTABLE_PATH:executable,CAMOFOX_DISABLE_DEFAULT_ADDONS:'1',XDG_CACHE_HOME:join(directory,'cache'),CAMOFOX_CRASH_REPORT_ENABLED:'false',CAMOFOX_PROFILE_DIR:join(directory,'profiles'),CAMOFOX_COOKIES_DIR:join(directory,'cookies'),CAMOFOX_UPLOADS_DIR:join(directory,'uploads'),CAMOFOX_TRACES_DIR:join(directory,'traces'),CAMOFOX_AGENT_STATE_DIR:join(directory,'agent')};
try{const result=spawnSync('npm',['run',suite],{env,stdio:'inherit'});if(result.error)throw result.error;process.exitCode=result.status??1;}
finally{rmSync(directory,{recursive:true,force:true});rmSync(temporary,{recursive:true,force:true});}
