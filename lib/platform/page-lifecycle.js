// Firefox's persistent context exits when its final native window closes.
// Keep exactly one explicitly marked placeholder only when the agent empties it.
// Never infer that an arbitrary blank or new-tab page is disposable.
export function createPageLifecycle({ context, register, closing = () => false }) {
  const placeholders = new WeakSet();
  let tail = Promise.resolve();
  const serial = (fn) => {
    const next = tail.catch(() => {}).then(fn);
    tail = next;
    return next;
  };
  const live = () => context.pages().filter((p) => !p.isClosed());
  const promote = (page) => placeholders.delete(page);
  const mark = (page) => {
    placeholders.add(page);
    // A placeholder becomes an ordinary tab when navigated, including an
    // intentional navigation to about:blank. Human input also calls promote.
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) promote(page);
    });
  };
  return {
    mark,
    promote,
    isPlaceholder: (page) => placeholders.has(page),
    close: (page, dispatch) => serial(async () => {
      if (page.isClosed()) return;
      if (!closing() && live().length === 1) {
        const placeholder = await context.newPage();
        register(placeholder);
        mark(placeholder);
      }
      await dispatch(page);
      if (!page.isClosed()) throw new Error("Native tab did not close");
    }),
    reconcile: () => serial(async () => {
      if (closing()) return;
      for (const page of live()) {
        if (placeholders.has(page) && live().length > 1) {
          await page.close({ runBeforeUnload: false });
        }
      }
    }),
  };
}
