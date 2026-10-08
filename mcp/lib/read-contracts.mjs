export const READ_FIELDS = ['text', 'src', 'currentSrc', 'srcset', 'alt', 'title', 'width', 'height', 'naturalWidth', 'naturalHeight', 'complete', 'role', 'ariaLabel'];
const text = { type: 'string', minLength: 1, maxLength: 2048 };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
export const readInput = {
  tabId: text,
  sessionId: { ...text, description: 'Optional saved session; existing tabs resolve their owning session.' },
  frameSelector: { ...text, description: 'CSS selector for exactly one iframe in the main document; omit for the main document.' },
  selector: { ...text, description: 'CSS selector within the selected document. No script or Playwright engine expressions.' },
  fields: { type: 'array', minItems: 1, maxItems: READ_FIELDS.length, uniqueItems: true, items: { type: 'string', enum: READ_FIELDS }, default: ['text'] },
  limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  maxChars: { type: 'integer', minimum: 1, maximum: 64000, default: 16000 },
};
const fieldValues = Object.fromEntries(READ_FIELDS.map(field => [field,
  { type: ['width','height','naturalWidth','naturalHeight'].includes(field) ? ['number','null'] : field === 'complete' ? ['boolean','null'] : ['string','null'], ...(!['width','height','naturalWidth','naturalHeight','complete'].includes(field) ? { maxLength: 2048 } : {}) },
]));
export const readOutput = object({
  frame: object({ main: { type: 'boolean' }, name: { type: 'string', maxLength: 256 }, origin: { type: ['string','null'], maxLength: 256 } }),
  items: { type: 'array', maxItems: 100, items: object(fieldValues, []) },
  returned: { type: 'integer', minimum: 0, maximum: 100 },
  matched: { type: 'integer', minimum: 0 },
  omittedItems: { type: 'integer', minimum: 0 },
  truncated: { type: 'boolean' },
  omissions: { type: 'array', maxItems: 1301, items: object({ index: { type: ['integer','null'] }, field: { type: ['string','null'], enum: [...READ_FIELDS, null] }, reason: { type: 'string', enum: ['item_limit','string_limit','character_budget','data_url'] } }) },
});

export function readOptions(input) {
  const { selector, frameSelector, fields = ['text'], limit = 20, maxChars = 16000 } = input;
  if (Object.keys(input).some(key => !Object.hasOwn(readInput, key))) throw Object.assign(new Error('Unknown read argument'), { code: 'invalid_request', statusCode: 400 });
  const invalid = message => { throw Object.assign(new Error(message), { code: 'invalid_request', statusCode: 400 }); };
  for (const [key, value] of Object.entries({ selector, frameSelector })) {
    if (key === 'frameSelector' && value === undefined) continue;
    if (typeof value !== 'string' || !value.trim() || value.length > 2048) invalid(`${key} must be a CSS selector of 1–2048 characters`);
  }
  if (!Array.isArray(fields) || !fields.length || fields.length > READ_FIELDS.length || new Set(fields).size !== fields.length || fields.some(f => !READ_FIELDS.includes(f))) invalid('fields must contain unique supported read fields');
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid('limit must be an integer from 1 to 100');
  if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 64000) invalid('maxChars must be an integer from 1 to 64000');
  return { selector, frameSelector, fields, limit, maxChars };
}
