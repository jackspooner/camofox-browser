const boundedText = maxLength => ({type: 'string', minLength: 1, maxLength, pattern: '\\S'});
const conditionTimeout = {type: 'integer', minimum: 1, maximum: 30000};
const conditionFields = ['selector', 'text', 'state'];
const readinessFields = ['waitForNetwork', 'dismissConsent'];
const excludes = keys => ({not: {anyOf: keys.map(key => ({required: [key]}))}});

export const waitFields = {
  selector: {...boundedText(2048), description: 'CSS selector in the main document.'},
  text: {...boundedText(512), description: 'Case-sensitive literal substring of rendered main-document text.'},
  state: {type: 'string', enum: ['visible', 'hidden'], description: 'Condition only. Defaults to visible.'},
  timeout: {type: 'integer', default: 10000, description: 'Condition deadline in ms (1–30000), or historical readiness timeout.'},
  waitForNetwork: {type: 'boolean', description: 'Readiness only. Defaults to true.'},
  dismissConsent: {type: 'boolean', description: 'Readiness only. Defaults to false. Enabling this may click a consent control.'},
};
export const waitModes = [
  excludes(conditionFields),
  ...['selector', 'text'].map(key => ({
    required: [key], properties: {timeout: conditionTimeout},
    ...excludes([key === 'selector' ? 'text' : 'selector', ...readinessFields]),
  })),
];
export const waitResult = {
  type: 'object', required: ['ok', 'ready'], additionalProperties: false,
  properties: {ok: {type: 'boolean', enum: [true]}, ready: {type: 'boolean'}},
};
export function waitCondition(input) {
  if (!conditionFields.some(key => Object.hasOwn(input, key))) return null;
  const invalid = message => { throw Object.assign(new Error(message), {code: 'invalid_request', statusCode: 400}); };
  if (Object.keys(input).some(key => !Object.hasOwn(waitFields, key) && !['userId', 'sessionKey', 'sessionId'].includes(key)))
    invalid('Unknown page condition argument.');
  const {selector, text, state = 'visible', timeout = 10000} = input;
  if ((selector !== undefined) === (text !== undefined)) invalid('Supply one CSS selector or one literal text condition.');
  if (readinessFields.some(key => Object.hasOwn(input, key))) invalid('Consent and network options apply only to readiness waits.');
  const key = selector !== undefined ? 'selector' : 'text';
  const value = input[key];
  if (typeof value !== 'string' || !value.trim() || [...value].length > waitFields[key].maxLength)
    invalid(`${key} must contain nonblank text of at most ${waitFields[key].maxLength} characters.`);
  if (!waitFields.state.enum.includes(state)) invalid('state must be visible or hidden.');
  if (!Number.isInteger(timeout) || timeout < conditionTimeout.minimum || timeout > conditionTimeout.maximum)
    invalid('Condition timeout must be an integer from 1 to 30000 ms.');
  return {selector, text, state, timeout};
}
