const target = { type: 'string', minLength: 1, maxLength: 2048 };
export const screenshotFields = {
  mode: { type: 'string', enum: ['viewport', 'element', 'fullPage'], default: 'viewport' },
  selector: { ...target, description: 'One CSS selector in the main document, for element mode.' },
  ref: { ...target, description: 'One current snapshot ref, for element mode.' },
};

export const screenshotVariants = [
  { properties: { mode: { enum: ['viewport', 'fullPage'] } }, not: { anyOf: [{ required: ['selector'] }, { required: ['ref'] }] } },
  ...['selector', 'ref'].map(key => ({
    properties: { mode: { enum: ['element'] } }, required: ['mode', key],
    not: { required: [key === 'ref' ? 'selector' : 'ref'] },
  })),
];

export function screenshotOptions({ mode = 'viewport', ref, selector, tabId, userId, sessionId, ...unknown }) {
  if (Object.keys(unknown).length || !screenshotFields.mode.enum.includes(mode))
    throw new Error('Expected screenshot mode viewport, element or fullPage and supported fields');
  const targets = [ref, selector].filter(value => value !== undefined);
  if (targets.length !== (mode === 'element' ? 1 : 0) ||
      targets.some(value => typeof value !== 'string' || !value.trim() || value.length > target.maxLength))
    throw new Error('Only element mode accepts a target. Supply exactly one nonempty ref or selector of at most 2048 characters');
  return { mode, ...(ref === undefined ? {} : { ref }), ...(selector === undefined ? {} : { selector }) };
}
