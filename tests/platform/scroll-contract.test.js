import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildRequest, TOOL_DEFS } from '../../mcp/lib/tool-contracts.mjs';
import { scrollTab } from '../../lib/scroll.js';

test('both HTTP contracts and the MCP adapter expose the targeted scroll example', () => {
  const tool = TOOL_DEFS.find(def => def.name === 'camofox_scroll');
  const example = readFileSync(new URL('../../skills/camofox/references/usage/examples/scroll-a-container.md', import.meta.url), 'utf8');
  const args = JSON.parse(example.match(/camofox_scroll\((\{[^\n]+\})\)/)[1]);
  const request = buildRequest(tool.name, args, {userId:'fixture'});
  assert.equal(request.path, '/tabs/TAB_ID/scroll');
  assert.deepEqual(request.body, {selector:'#bins', direction:'down', amount:100, userId:'fixture'});
  for (const file of ['openapi.json','agent-openapi.json']) {
    const spec = JSON.parse(readFileSync(new URL('../../' + file, import.meta.url)));
    const op = spec.paths['/tabs/{tabId}/scroll'].post;
    const input = op.requestBody.content['application/json'].schema;
    assert(!input.required.includes('selector'));
    assert.equal(input.properties.selector.maxLength, tool.inputSchema.properties.selector.maxLength);
    assert.deepEqual(input.properties.direction.enum, tool.inputSchema.properties.direction.enum);
    const result = op.responses[200].content['application/json'].schema;
    assert.equal(result.properties.movement.$ref, '#/components/schemas/ScrollMovement');
    assert.deepEqual(spec.components.schemas.ScrollMovement, tool.outputSchema.properties.movement);
  }
});

test('invalid scroll arguments fail before browser input', async () => {
  for (const [args, code] of [
    [{selector:null}, 'invalid_selector'], [{selector:' '}, 'invalid_selector'],
    [{selector:'a'.repeat(2049)}, 'invalid_selector'],
    [{amount:Infinity}, 'invalid_request'], [{direction:'sideways'}, 'invalid_request'],
  ]) {
    await assert.rejects(scrollTab({}, {direction:'down', amount:100, ...args}), {code});
  }
});
