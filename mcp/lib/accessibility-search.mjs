import { refCoverageSchema } from './ref-coverage.mjs';

const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const count = { type: 'integer', minimum: 0 };
const text = maxLength => ({ type: 'string', minLength: 1, maxLength });
export const searchInput = {
  tabId: text(2048),
  role: { ...text(64), pattern: '^[a-zA-Z][a-zA-Z0-9-]*$', description: 'Exact accessible role, case insensitive.' },
  query: { ...text(256), description: 'Case-insensitive literal substring of the observed accessible name or inline text.' },
  limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
};
export const searchCriteria = [{ required: ['role'] }, { required: ['query'] }];
export function searchOptions(input) {
  const { role, query, limit = 20 } = input;
  if (Object.keys(input).some(key => !Object.hasOwn(searchInput, key)) ||
      (role === undefined && query === undefined) ||
      (role !== undefined && (typeof role !== 'string' || role.length > 64 || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(role))) ||
      (query !== undefined && (typeof query !== 'string' || !query.trim() || query.length > 256)) ||
      !Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw Object.assign(new Error('Supply a role or a literal query of 1–256 characters and a limit of 1–50.'), { code: 'invalid_request', statusCode: 400 });
  }
  return { role: role?.toLowerCase(), query: query?.toLowerCase(), limit };
}
const label = { type: 'string', maxLength: 512 };
export const searchOutput = object({
  items: { type: 'array', maxItems: 50, items: object({
    role: label, name: label, text: label, ref: { type: ['string','null'], pattern: '^e[0-9]+$' },
    frame: object({ index: count, main: { type: 'boolean' }, name: { type: 'string', maxLength: 256 }, origin: { type: ['string','null'], maxLength: 256 } }),
    ancestors: { type: 'array', maxItems: 2, items: object({ role: label, name: label }) },
    clipped: { type: 'boolean' },
  }) },
  matched: count, omittedMatches: count, skippedChars: count, skippedLines: count, changedFrames: count,
  partial: { type: 'boolean' }, refCoverage: refCoverageSchema,
});
