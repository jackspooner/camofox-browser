// Read metadata independently of input locks so an unresponsive page cannot
// block Stop/handoff. Retain one native read per page until it actually settles.
export function createViewerTabs({ context, entries, getActive, setActive, humanControl, withTabLock, activity, modeVersion = () => 0, metadataTimeoutMs = 500 }) {
  const reads = new WeakMap();
  let statusFlight;
  const fail = (code, detail, statusCode = 409) => Object.assign(new Error(detail), { code, statusCode });
  const metadata = async page => {
    let read = reads.get(page);
    if (!read) {
      read = page.title().then(title => ({ title: title.slice(0, 512) }))
        .catch(() => null).finally(() => reads.delete(page));
      reads.set(page, read);
    }
    let timer;
    try { return await Promise.race([read, new Promise(resolve => { timer = setTimeout(() => resolve(null), metadataTimeoutMs); })]); }
    finally { clearTimeout(timer); }
  };
  const status = () => {
    if (statusFlight) return statusFlight;
    statusFlight = (async () => {
      const managed = new Map(entries().map(([id, tab]) => [tab.page, id]));
      const pages = context.pages().filter(page => managed.has(page) && !page.isClosed());
      const records = await Promise.all(pages.map(async page => ({ page, id: managed.get(page), ...await metadata(page) })));
      const current = new Map(entries());
      const live = records.filter(row => !row.page.isClosed() && current.get(row.id)?.page === row.page);
      const active = getActive();
      // Firefox's document.hasFocus() can lag behind bringToFront() on the
      // virtual display. Use the worker's managed selection, also checkpointed.
      return {
        tabs: live.map(row => ({ id: row.id, title: row.title || '', url: row.page.url() })),
        activeTabId: live.some(row => row.id === active) ? active : null,
      };
    })().finally(() => { statusFlight = null; });
    return statusFlight;
  };
  const select = async (id, { version = modeVersion(), deadline = Date.now() + 5000 } = {}) => {
    if (!humanControl()) throw fail('viewer_busy', 'Take control before selecting a tab');
    return withTabLock(id, async signal => {
      if (!humanControl() || version !== modeVersion() || Date.now() >= deadline) throw fail('viewer_busy', 'Browser control changed or selection expired; refresh the tab list');
      const page = new Map(entries()).get(id)?.page;
      if (!page || page.isClosed()) throw fail('tab_not_found', 'This tab has closed; refresh the tab list', 404);
      await page.bringToFront();
      signal?.throwIfAborted();
      if (page.isClosed()) throw fail('tab_not_found', 'This tab closed during selection; refresh the tab list', 404);
      setActive(id);
      activity();
      return { selectedTabId: id };
    }, 5000);
  };
  return { status, select };
}
