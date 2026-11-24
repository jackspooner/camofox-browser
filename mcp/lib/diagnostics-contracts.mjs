export const EVENT_CAPACITY = 64;
export const READ_LIMIT = 32;
const cursor = {
  type: 'string',
  pattern: '^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\\.(?:0|[1-9][0-9]{0,14})$',
  maxLength: 52,
  description: 'Exclusive cursor returned by this tab and diagnostic window.',
};
const count = {type: 'integer', minimum: 0};
const id = {type: 'string', minLength: 1};
export const diagnosticsInput = {
  tabId: id,
  action: {type: 'string', enum: ['start', 'read', 'stop']},
  cursor,
  limit: {type: 'integer', minimum: 1, maximum: READ_LIMIT},
};
export function validateDiagnostics(args) {
  if (args.action !== 'read' && (args.cursor !== undefined || args.limit !== undefined))
    throw new Error('Only read accepts cursor or limit');
  if (args.cursor !== undefined && (args.cursor.length > cursor.maxLength || !new RegExp(cursor.pattern).test(args.cursor)))
    throw new Error('Invalid diagnostic cursor');
}
const event = {
  type: 'object', additionalProperties: false,
  required: ['sequence', 'documentId', 'kind', 'severity', 'summary'],
  properties: {
    sequence: {type: 'integer', minimum: 1}, documentId: id,
    kind: {type: 'string', enum: ['console', 'pageerror']},
    severity: {type: 'string', enum: ['warning', 'error']},
    summary: {type: ['string', 'null'], maxLength: 160},
  },
};
export const diagnosticsOutput = {
  type: 'object', additionalProperties: false,
  required: ['tabId', 'active', 'events', 'nextCursor', 'evicted', 'missed', 'hasMore'],
  properties: {
    tabId: id, active: {type: 'boolean'},
    events: {type: 'array', items: event, maxItems: READ_LIMIT},
    nextCursor: {...cursor, type: ['string', 'null']},
    evicted: count, missed: count, hasMore: {type: 'boolean'},
  },
};
