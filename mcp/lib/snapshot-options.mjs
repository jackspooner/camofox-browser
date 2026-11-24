const revisionPattern = '^text-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
const validRevision = new RegExp(revisionPattern);

export const snapshotOptions = {
  strictRefs: { type: 'boolean', description: 'Return a single-use strictObservationId for an exact-node ref click.' },
  includeScreenshot: { type: 'boolean', default: true, description: 'Set false to omit the screenshot and its image bytes.' },
  delta: { type: 'boolean', default: false, description: 'Compare canonical accessibility text. Start without a baseRevision to receive text and its revision. Use offset only for ordinary pagination.' },
  baseRevision: { type: 'string', pattern: revisionPattern, maxLength: 41, description: 'With delta:true, compare against this tab’s retained text revision. Read-only.' },
};

export function snapshotOptionError({ includeScreenshot, strictRefs, delta, baseRevision, offset, format }) {
  if (strictRefs !== undefined && typeof strictRefs !== 'boolean') return 'strictRefs must be boolean';
  if (includeScreenshot !== undefined && typeof includeScreenshot !== 'boolean') return 'includeScreenshot must be boolean';
  if (delta !== undefined && typeof delta !== 'boolean') return 'delta must be boolean';
  if (baseRevision !== undefined && (!delta || typeof baseRevision !== 'string' || !validRevision.test(baseRevision) || baseRevision.length !== 41))
    return 'baseRevision requires delta=true and a text revision from a previous snapshot';
  if (delta && ((offset !== undefined && offset !== 0 && offset !== '0') || (format !== undefined && format !== 'text')))
    return 'delta requires offset zero and text format';
}

// Express query values are strings. Leave malformed or repeated values as
// received so validation rejects them before any browser work.
export function snapshotQueryError(query) {
  const boolean = value => value === 'true' ? true : value === 'false' ? false : value;
  return snapshotOptionError({ ...query, strictRefs: boolean(query.strictRefs), delta: boolean(query.delta), includeScreenshot: boolean(query.includeScreenshot) });
}
