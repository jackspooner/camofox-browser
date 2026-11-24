const offset = {
  type: 'object', required: ['x', 'y'], additionalProperties: false,
  properties: { x: { type: 'number' }, y: { type: 'number' } },
};
export const scrollMovementSchema = {
  type: 'object', required: ['before', 'after', 'delta', 'moved'], additionalProperties: false,
  properties: { before: offset, after: offset, delta: offset, moved: { type: 'boolean' } },
};
