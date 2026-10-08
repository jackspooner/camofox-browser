const integer = { type: 'integer', minimum: 0 };
const reasons = { type: 'array', items: { type: 'string', enum: ['ref_limit','frame_limit','skipped_frame','timeout','inaccessible','frame_changed','no_interactive_content','not_inspected'] } };
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const refCoverageSchema = object({
  status: { type: 'string', enum: ['complete','partial'] },
  limits: object({ main: integer, perFrame: integer, frames: integer, total: integer }),
  assigned: integer,
  documents: { type: 'array', maxItems: 64, items: object({
    main: { type: 'boolean' }, name: { type: 'string', maxLength: 256 }, origin: { type: ['string','null'], maxLength: 256 },
    assigned: integer, eligible: { type: ['integer','null'], minimum: 0 }, reasons,
  }) },
  documentsOmitted: integer,
  reasons,
});
