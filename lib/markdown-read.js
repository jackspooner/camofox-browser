import { readSelectedDocument } from './bounded-read.js';
import { markdownInput } from '../mcp/lib/markdown-contracts.mjs';
import { readOptions } from '../mcp/lib/read-contracts.mjs';

// This function runs inside the selected document. Stream its light DOM once,
// pruning subtrees before visiting children or reading their text.
export function renderMarkdown({ selector, maxChars }) {
  let region = document.body;
  if (selector !== undefined) {
    let matches;
    try { matches = document.querySelectorAll(selector); }
    catch { return { selectorError: true }; }
    if (matches.length !== 1) return { matches: matches.length };
    region = matches[0];
  }

  let markdown = '', separator = '', stopped = false, visited = 0, sourceLeft = 256000;
  const omissions = new Set();
  const stop = reason => { omissions.add(reason); stopped = true; };
  const append = value => {
    if (!value || stopped) return;
    const piece = separator + value;
    separator = '';
    const remaining = maxChars - markdown.length;
    if (piece.length <= remaining) { markdown += piece; return; }
    // Never split a UTF-16 surrogate pair at the caller's ceiling.
    let end = remaining;
    if (end && /[\uD800-\uDBFF]/.test(piece[end - 1])) end--;
    markdown += piece.slice(0, end);
    stop('character_budget');
  };
  const space = () => { if (markdown && !separator && !markdown.endsWith(' ')) separator = ' '; };
  const newline = count => {
    if (markdown && separator !== '\n\n') separator = '\n'.repeat(count);
  };

  const ignored = 'head,nav,[role="navigation"],script,style,noscript,template,iframe,object,embed,img,picture,audio,video,canvas,svg,input,textarea,select,option,button,datalist,output,[contenteditable]:not([contenteditable="false" i]),[role="textbox"],[hidden],[inert],[aria-hidden="true" i]';
  function excluded(el) {
    if (el.matches(ignored) || el.isContentEditable) return true;
    const style = getComputedStyle(el);
    return style.display === 'none' || style.visibility !== 'visible' ||
      style.opacity === '0' || style.contentVisibility === 'hidden';
  }

  function text(node, ctx) {
    let count = Math.min(node.length, sourceLeft);
    if (count < node.length && count && /[\uD800-\uDBFF]/.test(node.substringData(count - 1, 1))) count--;
    const raw = node.substringData(0, count);
    sourceLeft -= count;
    if (ctx.pre) {
      append(raw.replace(/\n/g, '\n    '));
    } else {
      const normalized = raw.replace(/\s+/gu, ' ');
      if (normalized.startsWith(' ')) space();
      const body = normalized.trim();
      if (body) append(body.replace(/&/g, '&amp;').replace(/</g, '&lt;')
        .replace(/([\\*_\[\]|#~>!+\x60-])/g, '\\$1').replace(/^(\d{1,9})([.)])/, '$1\\$2'));
      if (normalized.endsWith(' ')) space();
    }
    if (count < node.length) stop('source_limit');
  }

  function href(el) {
    const raw = el.getAttribute('href');
    if (!raw) return '';
    if (raw.length > 2048 || document.baseURI.length > 2048) { omissions.add('link_limit'); return ''; }
    let url;
    try { url = new URL(raw, document.baseURI); } catch { return ''; }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
    const destination = url.href.replace(/[()<>\\]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
    if (destination.length > 2048) { omissions.add('link_limit'); return ''; }
    return destination;
  }

  function children(el, depth, ctx) {
    for (let child = el.firstChild; child && !stopped; child = child.nextSibling)
      visit(child, depth + 1, ctx);
  }
  function visit(node, depth, ctx) {
    if (++visited > 10000) { stop('node_limit'); return; }
    if (depth > 64) { omissions.add('depth_limit'); return; }
    if (node.nodeType === Node.TEXT_NODE) { text(node, ctx); return; }
    if (node.nodeType !== Node.ELEMENT_NODE || excluded(node)) return;
    const tag = node.localName;
    if (tag === 'details' && !node.open) {
      const summary = node.querySelector(':scope > summary');
      if (summary) visit(summary, depth + 1, ctx);
      return;
    }
    if (ctx.pre) { children(node, depth, ctx); return; }
    if (tag === 'table') {
      if (ctx.table) { omissions.add('nested_table'); return; }
      newline(2);
      children(node, depth, { ...ctx, table: { header: true } });
      newline(2);
    } else if (tag === 'tr' && ctx.table) {
      newline(1);
      const row = { cells: 0 };
      children(node, depth, { ...ctx, row });
      if (!row.cells) return;
      append('|');
      if (ctx.table.header) {
        newline(1);
        append('|' + ' --- |'.repeat(row.cells));
        ctx.table.header = false;
      }
      newline(1);
    } else if ((tag === 'td' || tag === 'th') && ctx.row) {
      ctx.row.cells++;
      append('| ');
      children(node, depth, { ...ctx, cell: true });
      space();
    } else if (tag === 'a') {
      const destination = href(node);
      if (destination) append('[');
      children(node, depth, ctx);
      if (destination) append('](' + destination + ')');
    } else if (ctx.cell) {
      if (['br', 'p', 'div'].includes(tag)) space();
      children(node, depth, ctx);
      if (tag === 'p' || tag === 'div') space();
    } else if (tag === 'ul' || tag === 'ol') {
      newline(ctx.list ? 1 : 2);
      const list = { depth: (ctx.list?.depth || 0) + 1, ordered: tag === 'ol', next: node.start ?? 1 };
      children(node, depth, { ...ctx, list });
      newline(ctx.list ? 1 : 2);
    } else if (tag === 'li') {
      newline(1);
      const list = ctx.list;
      if (list?.ordered && node.hasAttribute('value')) list.next = node.value;
      append('    '.repeat(Math.max(0, (list?.depth || 1) - 1)) + (list?.ordered ? (list.next++) + '. ' : '- '));
      children(node, depth, { ...ctx, itemStart: markdown.length });
      newline(1);
    } else if (/^h[1-6]$/.test(tag)) {
      newline(2); append('#'.repeat(Number(tag[1])) + ' ');
      children(node, depth, ctx); newline(2);
    } else if (tag === 'pre') {
      newline(2); append('    ');
      children(node, depth, { ...ctx, pre: true }); newline(2);
    } else if (tag === 'br') {
      newline(1);
    } else {
      const block = ['p', 'div', 'article', 'section', 'main', 'blockquote', 'header', 'footer'].includes(tag);
      if (block && markdown.length !== ctx.itemStart) newline(2);
      children(node, depth, ctx);
      if (block) newline(2);
    }
  }

  // A selected region may itself be inside an excluded subtree.
  let visible = Boolean(region);
  for (let ancestor = region?.parentElement, depth = 0; ancestor; ancestor = ancestor.parentElement) {
    if (++depth > 64) { omissions.add('depth_limit'); visible = false; break; }
    if (excluded(ancestor) || (ancestor.localName === 'details' && !ancestor.open &&
        !ancestor.querySelector(':scope > summary')?.contains(region))) { visible = false; break; }
  }
  if (visible) visit(region, 0, {});
  return { markdown, truncated: omissions.size > 0, omissions: [...omissions] };
}

export async function readMarkdown(page, { selector, frameSelector, maxChars = markdownInput.maxChars.default }, timeoutMs) {
  readOptions({ selector: selector === undefined ? 'body' : selector, frameSelector, maxChars });
  const result = await readSelectedDocument(page, { selector, frameSelector, maxChars }, renderMarkdown, timeoutMs);
  if (result.matches === 0)
    throw Object.assign(new Error('selector must match one region in the selected document'), { code: 'invalid_target', statusCode: 400 });
  if (result.matches > 1)
    throw Object.assign(new Error('selector matches multiple regions; narrow the selector'), { code: 'ambiguous_target', statusCode: 409 });
  return result;
}
