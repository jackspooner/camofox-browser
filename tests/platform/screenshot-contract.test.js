import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import {TOOL_DEFS,buildRequest} from '../../mcp/lib/tool-contracts.mjs';
import {browserOperation} from '../../mcp/lib/operation-contracts.mjs';

test('screenshot options agree across discovery, request construction and read policy', () => {
  const tool = TOOL_DEFS.find(tool => tool.name === 'camofox_screenshot');
  const validate = new AjvJsonSchemaValidator().getValidator(tool.inputSchema);
  const request = args => buildRequest(tool.name,args,{userId:'test'});
  for (const options of [{},{mode:'viewport'},{mode:'fullPage'},{mode:'element',ref:'e3'},
    {mode:'element',selector:'[title="a & b"]'}]) {
    const args = {tabId:'t',sessionId:'s',...options};
    assert(validate(args).valid);
    const spec = request(args), url = new URL(spec.path,'http://fixture');
    assert.equal(browserOperation(spec.method,spec.path).mutation,false);
    assert.equal(url.searchParams.get('mode') ?? 'viewport',options.mode ?? 'viewport');
    for (const field of ['ref','selector']) assert.equal(url.searchParams.get(field) ?? undefined,options[field]);
    assert.equal(url.searchParams.get('sessionId'),'s');
  }
  for (const options of [{mode:'full'},{mode:'element'},{selector:'a'},{mode:'viewport',ref:'e3'},
    {mode:'element',ref:'e3',selector:'a'},{mode:'element',selector:'a'.repeat(2049)},{fullPage:true}]) {
    const args = {tabId:'t',...options};
    assert.equal(validate(args).valid,false);
    assert.throws(() => request(args));
  }
});

test('both screenshot HTTP routes document the binary response and their own options', () => {
  for (const [file,supervised] of [['openapi.json',false],['agent-openapi.json',true]]) {
    const spec = JSON.parse(readFileSync(new URL('../../'+file,import.meta.url)));
    const op = spec.paths['/tabs/{tabId}/screenshot'].get;
    const ok = op.responses[200];
    assert.deepEqual(ok.content,{'image/png':{schema:{type:'string',format:'binary'}}});
    assert.equal(!!ok.headers?.['X-Camofox-Capture'],supervised);
    const names = op.parameters.map(p => p.name);
    assert.equal(names.includes('fullPage'),!supervised);
    for (const name of ['mode','selector','ref']) assert.equal(names.includes(name),supervised);
  }
});
