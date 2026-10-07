import { randomUUID } from "node:crypto";
import { writeFile, rename, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { coordinateClick } from "../coordinate-click.js";
import { createPageLifecycle } from "./page-lifecycle.js";

export async function installWorkerRoutes(app, ctx) {
  const {
    config,
    getSession,
    findTab,
    createTabState,
    getTabGroup,
    attachPopupHandler,
    withTabLock,
  } = ctx;
  const userId = config.workerSession;
  const session = await getSession(userId);
  const registerPage = (page) => {
    const id = randomUUID();
    getTabGroup(session, "default").set(id, createTabState(page));
    attachPopupHandler(page, userId, "default");
    return id;
  };
  const lifecycle = createPageLifecycle({
    context: session.context,
    register: registerPage,
    closing: () => session._closing,
  });
  ctx.setPageCloseHandler(lifecycle.close);
  const captures = new Map();
  let humanControl = false;
  const focusTab = async (id) => {
    const found = findTab(session, id);
    if (found && !humanControl) {
      activeTabId = id;
      await found.tabState.page.bringToFront();
    }
  };
  ctx.setBeforeTabOperation(focusTab);
  let activeTabId = config.workerCheckpoint.tabs?.find((t) => t.active)?.id;
  for (const event of [
    "tab:created",
    "tab:navigated",
    "tab:click",
    "tab:type",
    "tab:scroll",
    "tab:press",
    "tab:snapshot",
    "tab:evaluate",
  ]) {
    ctx.pluginEvents.on(event, ({ tabId }) => {
      if (tabId && findTab(session, tabId) && !humanControl) {
        activeTabId = tabId;
        if (event === "tab:created") focusTab(tabId).catch(() => {});
      }
    });
  }
  const revisions = new WeakMap();
  const bump = (page) => revisions.set(page, (revisions.get(page) || 0) + 1);
  const watchPage = (page) =>
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) bump(page);
    });
  session.context.on("page", watchPage);
  session.context.pages().forEach(watchPage);
  await session.context.exposeBinding("__camofoxPageMoved", ({ page }) =>
    bump(page),
  );
  let lastHumanActivity = 0;
  await session.context.exposeBinding("__camofoxHumanActivity", ({ page }) => {
    if (humanControl) {
      lastHumanActivity = Date.now();
      lifecycle.promote(page);
    }
    for (const group of session.tabGroups.values())
      for (const [id, tab] of group) if (tab.page === page) activeTabId = id;
  });
  await session.context.addInitScript(() => {
    for (const name of ["scroll", "resize"])
      addEventListener(name, () => globalThis.__camofoxPageMoved(), {
        capture: true,
        passive: true,
      });
    for (const name of ["pointerdown", "keydown", "wheel"])
      addEventListener(
        name,
        (e) => {
          if (e.isTrusted) globalThis.__camofoxHumanActivity();
        },
        { capture: true, passive: true },
      );
  });
  const saved = config.workerCheckpoint;
  let cookies = saved.cookies;
  try {
    cookies = JSON.parse(
      await readFile(join(config.nativeProfileDir, "checkpoint.json"), "utf8"),
    ).cookies;
  } catch {}
  if (cookies) await session.context.addCookies(cookies);
  const initialPages = session.context.pages();
  for (const tab of saved.tabs || []) {
    const page = await session.context.newPage();
    let restoreScript;
    if (tab.sessionStorage)
      restoreScript = await page.addInitScript(({ origin, values }) => {
        if (location.origin === origin)
          for (const [k, v] of Object.entries(values))
            sessionStorage.setItem(k, v);
      }, tab.sessionStorage);
    getTabGroup(session, tab.group || "default").set(
      tab.id,
      createTabState(page),
    );
    attachPopupHandler(page, userId, tab.group || "default");
    if (/^https?:\/\//.test(tab.url) || ["about:blank", "about:newtab"].includes(tab.url))
      await page
        .goto(tab.url, { waitUntil: "domcontentloaded", timeout: 30000 })
        .catch(() => {});
    await restoreScript?.dispose();
    await page
      .evaluate(({ x, y }) => scrollTo(x, y), tab.scroll || { x: 0, y: 0 })
      .catch(() => {});
    if (tab.managedPlaceholder === true && page.url() === "about:blank")
      lifecycle.mark(page);
  }
  // Keep a live page while restoring: Firefox closes a persistent context when
  // its last window closes. Register the initial blank page for fresh profiles.
  if (saved.tabs?.length) {
    for (const page of initialPages) await page.close();
  } else {
    for (const page of initialPages) {
      registerPage(page);
      // Only the known launcher-created startup page has disposable provenance.
      if (initialPages.length === 1 && page.url() === "about:blank") lifecycle.mark(page);
    }
  }
  const activeTab = saved.tabs?.find((t) => t.active);
  if (activeTab)
    await findTab(session, activeTab.id)?.tabState.page.bringToFront();
  const getPage = (id) => {
    const found = findTab(session, id);
    if (!found)
      throw Object.assign(new Error("Tab not found"), { statusCode: 404 });
    return found.tabState.page;
  };
  const geometry = async (page) => ({
    revision: revisions.get(page) || 0,
    ...(await page.evaluate(() => ({
      url: location.href,
      width: innerWidth,
      height: innerHeight,
      x: scrollX,
      y: scrollY,
      scale: visualViewport?.scale || 1,
    }))),
  });
  const wrap = (fn) => async (req, res) => {
    try {
      res.json(await fn(req));
    } catch (e) {
      res
        .status(e.statusCode || 500)
        .json({ error: e.message, code: e.code || "worker_error" });
    }
  };
  // Private worker routes are reachable only through the owner-only Unix socket
  // and the per-supervisor bearer key. The public gateway never proxies /internal.
  app.post("/internal/viewer-mode", wrap(async (req) => {
    humanControl = req.body.humanControl === true;
    if (req.body.invalidate) {
      captures.clear();
      for (const group of session.tabGroups.values()) for (const tab of group.values()) {
        tab.refs = new Map(); tab.lastSnapshot = null;
        bump(tab.page);
      }
    }
    return { humanControl, tabIds: [...session.tabGroups.values()].flatMap(g => [...g.keys()]) };
  }));
  ctx.pluginEvents.on("tab:destroyed", ({ tabId }) => {
    if (tabId !== activeTabId || humanControl) return;
    activeTabId = [...session.tabGroups.values()].flatMap(g => [...g.keys()]).find(id => id !== tabId);
    if (activeTabId) focusTab(activeTabId).catch(() => {});
  });
  app.get(
    "/internal/display",
    wrap(async () => {
      if (activeTabId)
        await findTab(session, activeTabId)?.tabState.page.bringToFront();
      return { display: await ctx.getDisplay() };
    }),
  );
  app.get(
    "/internal/checkpoint",
    wrap(async () => {
      await lifecycle.reconcile();
      const tracked = new Set(
        [...session.tabGroups.values()].flatMap((g) =>
          [...g.values()].map((t) => t.page),
        ),
      );
      for (const page of session.context.pages())
        if (!tracked.has(page)) {
          registerPage(page);
        }
      const tabs = [];
      for (const [group, entries] of session.tabGroups)
        for (const [id, tab] of entries) {
          if (tab.page.isClosed()) {
            entries.delete(id);
            continue;
          }
          const state = await tab.page
            .evaluate(() => ({
              scroll: { x: scrollX, y: scrollY },
              active: document.hasFocus(),
              sessionStorage: {
                origin: location.origin,
                values: { ...sessionStorage },
              },
            }))
            .catch(() => ({}));
          tabs.push({ id, group, url: tab.page.url(), ...state,
            ...(lifecycle.isPlaceholder(tab.page) ? { managedPlaceholder: true } : {}),
          });
        }
      const pageOrder = session.context.pages();
      tabs.sort(
        (a, b) =>
          pageOrder.indexOf(findTab(session, a.id).tabState.page) -
          pageOrder.indexOf(findTab(session, b.id).tabState.page),
      );
      const focused = tabs.find((t) => t.active);
      if (!tabs.some((t) => t.id === activeTabId))
        activeTabId = focused?.id || tabs[0]?.id;
      for (const t of tabs) t.active = t.id === activeTabId;
      const checkpoint = {
        sessionId: config.workerSession,
        tabs,
        cookies: await session.context.cookies(),
        lastHumanActivity,
        savedAt: Date.now(),
      };
      const file = join(config.nativeProfileDir, "checkpoint.json");
      await writeFile(`${file}.tmp`, JSON.stringify(checkpoint), {
        mode: 0o600,
      });
      await rename(`${file}.tmp`, file);
      return checkpoint;
    }),
  );
  app.post(
    "/internal/capture",
    wrap(async (req) =>
      withTabLock(req.body.tabId, async () => {
        const page = getPage(req.body.tabId);
        const before = await geometry(page);
        const png = await page.screenshot({
          fullPage: false,
          animations: "disabled",
        });
        const after = await geometry(page);
        if (JSON.stringify(before) !== JSON.stringify(after))
          throw Object.assign(new Error("Page moved during capture"), {
            statusCode: 409,
          });
        for (const [id, c] of captures)
          if (Date.now() - c.created > 300000) captures.delete(id);
        while (captures.size >= 32)
          captures.delete(captures.keys().next().value);
        const id = randomUUID();
        const meta = await sharp(png).metadata();
        captures.set(id, {
          tabId: req.body.tabId,
          png,
          geometry: after,
          created: Date.now(),
          state: "pending",
        });
        return {
          captureId: id,
          png: png.toString("base64"),
          width: meta.width,
          height: meta.height,
          geometry: after,
        };
      }),
    ),
  );
  app.post(
    "/internal/click-target",
    wrap(async (req) => {
      const capture = captures.get(req.body.captureId);
      if (!capture)
        throw Object.assign(new Error("Observation expired; locate again"), {
          statusCode: 409,
          code: "stale_observation",
        });
      return withTabLock(capture.tabId, async () => {
        if (capture.state !== "pending") {
          if (capture.targetNumber !== req.body.targetNumber)
            throw Object.assign(new Error("Observation already consumed"), {
              statusCode: 409,
            });
          return (
            capture.result || {
              ok: false,
              code: "click_outcome_unknown",
              retryable: false,
            }
          );
        }
        const page = getPage(capture.tabId);
        const g = await geometry(page);
        const stale = () => {
          throw Object.assign(new Error("Target changed; locate again"), {
            statusCode: 409,
            code: "stale_observation",
          });
        };
        if (
          Date.now() - capture.created > 300000 ||
          JSON.stringify(g) !== JSON.stringify(capture.geometry)
        )
          stale();
        const fresh = await page.screenshot({
          fullPage: false,
          animations: "disabled",
        });
        const box = req.body.box;
        const { width, height } = await sharp(capture.png).metadata();
        if (
          !box ||
          ![box.x1, box.y1, box.x2, box.y2].every(Number.isFinite) ||
          box.x1 < 0 ||
          box.y1 < 0 ||
          box.x2 > width ||
          box.y2 > height ||
          box.x2 <= box.x1 ||
          box.y2 <= box.y1
        )
          throw Object.assign(new Error("Invalid target box"), {
            statusCode: 400,
          });
        const crop = {
          left: Math.floor(box.x1),
          top: Math.floor(box.y1),
          width: Math.max(1, Math.floor(box.x2) - Math.floor(box.x1)),
          height: Math.max(1, Math.floor(box.y2) - Math.floor(box.y1)),
        };
        const [oldPixels, newPixels] = await Promise.all(
          [capture.png, fresh].map((png) =>
            sharp(png).extract(crop).raw().toBuffer(),
          ),
        );
        if (
          !oldPixels.equals(newPixels) ||
          JSON.stringify(await geometry(page)) !== JSON.stringify(g)
        )
          stale();
        capture.state = "dispatching";
        capture.targetNumber = req.body.targetNumber;
        const coordinates = {
          x: (((box.x1 + box.x2) / 2) * g.width) / width,
          y: (((box.y1 + box.y2) / 2) * g.height) / height,
        };
        await coordinateClick(page, coordinates);
        capture.result = {
          ok: true,
          tabId: capture.tabId,
          coordinates,
          url: page.url(),
        };
        capture.state = "clicked";
        const tab = findTab(session, capture.tabId).tabState;
        tab.refs = new Map();
        tab.lastSnapshot = null;
        return capture.result;
      });
    }),
  );
}
