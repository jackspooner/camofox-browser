import { readFrame, readInput } from './read-contracts.mjs';

export const markdownInput = {
  tabId: readInput.tabId,
  sessionId: readInput.sessionId,
  frameSelector: readInput.frameSelector,
  selector: { ...readInput.selector, description: 'Optional CSS selector matching exactly one content region. Defaults to the document body.' },
  maxChars: readInput.maxChars,
};

export const markdownOutput = {
  type: 'object',
  required: ['frame', 'markdown', 'truncated', 'omissions'],
  additionalProperties: false,
  properties: {
    frame: readFrame,
    markdown: { type: 'string', maxLength: readInput.maxChars.maximum },
    truncated: { type: 'boolean' },
    omissions: {
      type: 'array', uniqueItems: true, maxItems: 6,
      items: { type: 'string', enum: ['character_budget', 'node_limit', 'depth_limit', 'source_limit', 'link_limit', 'nested_table'] },
    },
  },
};
