// Playwright serializes this function into the selected document.
export function readRows({ selector, projection, limit, maxChars }) {
  const { fields, maxBytes } = projection;
  const excluded = 'input,textarea,select,option,script,style,template,[contenteditable]:not([contenteditable="false" i])';
  const attributes = { alt: 'alt', title: 'title', ariaLabel: 'aria-label' };
  const encoder = new TextEncoder();
  let matches;
  try {
    matches = document.querySelectorAll(selector);
    // Validate every field even when this document contains no matching rows.
    const empty = document.createDocumentFragment();
    for (const field of fields) empty.querySelector(field.selector);
  } catch {
    return { selectorError: true };
  }

  function boundedText(element, budget) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.nodeType === Node.TEXT_NODE) return NodeFilter.FILTER_ACCEPT;
        return node.matches(excluded) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP;
      },
    });
    let value = '', node;
    while (value.length <= budget && (node = walker.nextNode()))
      value += node.substringData(0, budget + 1 - value.length);
    return value;
  }

  let remaining = maxChars;
  const omitted = status => ({ status, value: null });
  function cell(row, field) {
    const element = row.querySelector(field.selector);
    if (!element) return omitted('missing_element');
    if (element.closest(excluded)) return omitted('excluded');
    const budget = Math.min(2048, remaining);
    const raw = field.read === 'text' ? boundedText(element, budget) : element.getAttribute(attributes[field.read]);
    if (raw === null) return omitted('missing_attribute');
    remaining -= Math.min(raw.length, budget);
    if (raw.length > budget) return omitted(budget < 2048 ? 'character_budget' : 'string_limit');

    let value = raw;
    if (field.type === 'number') {
      const decimal = raw.trim();
      if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(decimal)) return omitted('invalid_conversion');
      value = Number(decimal);
      if (!Number.isFinite(value)) return omitted('invalid_conversion');
    } else if (field.type === 'boolean') {
      const literal = raw.trim();
      if (literal !== 'true' && literal !== 'false') return omitted('invalid_conversion');
      value = literal === 'true';
    }
    return { status: 'ok', value };
  }

  const rows = [];
  let rowBytes = 2, stopReason = null, truncated = false;
  for (let i = 0; i < Math.min(limit, matches.length); i++) {
    const row = Object.fromEntries(fields.map(f => [f.name, cell(matches[i], f)]));
    const bytes = encoder.encode(JSON.stringify(row)).length + (i ? 1 : 0);
    if (rowBytes + bytes > maxBytes) {
      stopReason = 'byte_limit';
      break;
    }
    rows.push(row);
    rowBytes += bytes;
    if (Object.values(row).some(c => c.status === 'string_limit' || c.status === 'character_budget')) truncated = true;
  }
  if (!stopReason && rows.length < matches.length) stopReason = 'row_limit';
  return {
    selector, fields, rows, rowBytes, matched: matches.length, returned: rows.length,
    omittedRows: matches.length - rows.length, stopReason, truncated: truncated || stopReason !== null,
  };
}
