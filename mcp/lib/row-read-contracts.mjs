import { validateCaptureValue } from './capture-contracts.mjs';

const object = properties => ({
  type: 'object', properties, required: Object.keys(properties), additionalProperties: false,
});
const field = object({
  name: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_]{0,31}$', maxLength: 32 },
  selector: { type: 'string', minLength: 1, maxLength: 2048, description: 'First matching descendant of this row, in document order.' },
  read: { type: 'string', enum: ['text', 'alt', 'title', 'ariaLabel'] },
  type: { type: 'string', enum: ['string', 'number', 'boolean'] },
});
const fields = { type: 'array', minItems: 1, maxItems: 16, items: field, description: 'Use a distinct name for each projected field.' };
const byteLimit = { type: 'integer', minimum: 2, maximum: 64000, default: 16000, description: 'UTF-8 budget for the serialized rows array, including cell statuses and punctuation.' };
export const projectionInput = {
  ...object({ fields, maxBytes: byteLimit }), required: ['fields'],
  description: 'Project repeated elements into typed rows. Supply projection or top-level fields, never both.',
};

export function rowProjection(value) {
  try {
    validateCaptureValue(value, projectionInput, 'projection');
    if (!value.fields.length || new Set(value.fields.map(f => f.name)).size !== value.fields.length)
      throw Error('projection.fields must contain 1–16 uniquely named fields');
  } catch (error) {
    throw Object.assign(error, { code: 'invalid_request', statusCode: 400 });
  }
  return { fields: value.fields, maxBytes: value.maxBytes ?? byteLimit.default };
}

const cell = { oneOf: [
  object({ status: { type: 'string', enum: ['ok'] }, value: { anyOf: [
    { type: 'string', maxLength: 2048 }, { type: 'number' }, { type: 'boolean' },
  ] } }),
  object({
    status: { type: 'string', enum: ['missing_element', 'missing_attribute', 'excluded', 'invalid_conversion', 'string_limit', 'character_budget'] },
    value: { type: ['string', 'null'], enum: [null] },
  }),
] };

export function rowReadOutput(frameSchema) {
  const count = { type: 'integer', minimum: 0 };
  return object({
    frame: frameSchema,
    selector: { type: 'string', maxLength: 2048 },
    fields,
    rows: { type: 'array', maxItems: 100, items: { type: 'object', minProperties: 1, maxProperties: 16, additionalProperties: cell } },
    matched: count, returned: { ...count, maximum: 100 }, omittedRows: count,
    rowBytes: { type: 'integer', minimum: 2, maximum: 64000 },
    stopReason: { type: ['string', 'null'], enum: ['row_limit', 'byte_limit', null] },
    truncated: { type: 'boolean' },
  });
}
