const generations = new WeakMap();
const watched = new WeakSet();

export function trackRefFrames(page) {
  if (watched.has(page)) return;
  watched.add(page);
  page.on('framenavigated', frame => generations.set(frame, (generations.get(frame) || 0) + 1));
}
export function frameRefIdentity(frame) {
  return { frameObject: frame, frameGeneration: generations.get(frame) || 0 };
}
export function currentRefFrame(page, info) {
  const frame = info.frameObject;
  return frame && !frame.isDetached() && page.frames().includes(frame) &&
    info.frameGeneration === (generations.get(frame) || 0) ? frame : null;
}

export function annotateFrameSnapshot(yaml, refs, frame = null) {
  const byKey = new Map();
  for (const [id, info] of refs) {
    if ((info.frameObject || null) === frame)
      byKey.set(`${info.role}:${info.name}:${info.nth}`, id);
  }
  const counts = new Map();
  return yaml.split('\n').map(line => {
    const match = line.match(/^(\s*-\s+)(\w+)(\s+"([^"]*)")?(.*)$/);
    if (!match) return line;
    const [, prefix, role, nameMatch, name = '', suffix] = match;
    const key = `${role.toLowerCase()}:${name}`;
    const nth = counts.get(key) || 0;
    counts.set(key, nth + 1);
    const ref = byKey.get(`${key}:${nth}`);
    return ref ? `${prefix}${role}${nameMatch || ''} [${ref}]${suffix}` : line;
  }).join('\n');
}
