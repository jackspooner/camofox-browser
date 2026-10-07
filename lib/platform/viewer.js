import { WebSocketServer } from 'ws';
import { connect } from 'node:net';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { startViewer, startDesktop } from './viewer-launcher.js';
import { workerJson } from './worker-launcher.js';
import { problem } from './store.js';

export const viewerStatus = w => ({ state: w?.viewer?.state || 'closed', mode: w?.viewer?.mode || 'watch' });
export function installViewer(app, server, supervisor, config, launchers = { startViewer, startDesktop }) {
  const tickets = new Map(), capabilities = new Map(), sockets = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2 * 1024 * 1024 });
  const origin = `http://127.0.0.1:${config.port}`;
  const secret = () => randomBytes(32).toString('hex');
  const sameOrigin = req => req.headers.origin === origin;
  app.use('/viewer/assets', express.static(config.novncDir, { dotfiles: 'deny' }));
  /**
   * @openapi
   * {"/viewer/app.js":{"get":{"operationId":"camofox_viewer_client","tags":["Browser"],"summary":"Viewer client module","description":"Viewer browser transport; not an agent tool. POST requests require the exact local Origin. Capabilities are confined to one viewer.","security":[],"x-internal":true,"x-agent-notes":{"sideEffects":"none","consistency":{"refresh":"Read session status"}},"responses":{"200":{"description":"Viewer asset"}}}}}
   */
  app.get('/viewer/app.js', (_req, res) => res.sendFile(fileURLToPath(new URL('./viewer-ui.js', import.meta.url))));
  /**
   * @openapi
   * {"/viewer":{"get":{"operationId":"camofox_viewer_shell","tags":["Browser"],"summary":"Authenticated viewer shell","description":"Viewer browser transport; not an agent tool. POST requests require the exact local Origin. Capabilities are confined to one viewer.","security":[],"x-internal":true,"x-agent-notes":{"sideEffects":"none","consistency":{"refresh":"Read session status"}},"responses":{"200":{"description":"Viewer asset"}}}}}
   */
  app.get('/viewer', (_req, res) => res.set({
    'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws:; img-src 'self' data:; frame-ancestors 'none'",
  }).send(`<!doctype html><html><head><meta charset="utf-8"><title>Camofox viewer</title></head><body style="margin:0;height:100vh;display:flex;flex-direction:column;overflow:hidden;background:#15171c;color:#eee;font:15px system-ui"><header style="padding:12px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;flex:none"><strong id="title">Camofox</strong><span id="status" role="status">Connecting…</span><button id="mode" disabled>Take control</button><button id="close">Close</button></header><section id="handoff" hidden aria-label="Control request" style="padding:14px 20px;background:#26394e;border-block:1px solid #7092b5;flex:none"><strong id="handoff-message"></strong> <span id="handoff-timer" role="timer"></span><div style="margin-top:10px;display:flex;gap:12px"><button id="handoff-accept">Accept</button><button id="handoff-decline">Decline</button></div></section><main id="screen" style="flex:1;min-height:0;min-width:0;overflow:hidden"></main><script type="module" src="/viewer/app.js"></script></body></html>`));
  const clientState = t => {
    const socketTicket = secret();
    sockets.set(socketTicket, { t, generation: t.generation, expires: Date.now() + 60000 });
    clearTimeout(t.expiry);
    t.expiry = setTimeout(() => t.close(), 60000);
    return { capability: t.capability, socketTicket, mode: t.mode, title: t.title };
  };
  const authenticate = req => {
    const t = capabilities.get((req.headers.authorization || '').replace(/^Bearer /, ''));
    if (!sameOrigin(req) || !t || t.closed) throw problem('viewer_unauthorized', 'Viewer capability expired or invalid', 403);
    return t;
  };
  /**
   * @openapi
   * {"/viewer/connect":{"post":{"operationId":"camofox_viewer_connect","tags":["Browser"],"summary":"Exchange a single-use viewer ticket","description":"Viewer browser transport; not an agent tool. POST requests require the exact local Origin. Capabilities are confined to one viewer.","security":[],"x-internal":true,"x-agent-notes":{"sideEffects":"Exchange a single-use viewer ticket","consistency":{"refresh":"Read session status"}},"responses":{"200":{"description":"Viewer result","content":{"application/json":{"schema":{"type":"object","additionalProperties":false,"required":["capability","socketTicket","mode","title"],"properties":{"capability":{"type":"string"},"socketTicket":{"type":"string"},"mode":{"type":"string","enum":["watch","control"]},"title":{"type":"string"}}}}}},"400":{"description":"Viewer request failed","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AgentError"}}}},"403":{"description":"Viewer request failed","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AgentError"}}}},"409":{"description":"Viewer request failed","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AgentError"}}}},"503":{"description":"Viewer request failed","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AgentError"}}}}},"requestBody":{"required":true,"content":{"application/json":{"schema":{"type":"object","required":["ticket"],"additionalProperties":false,"properties":{"ticket":{"type":"string"}}}}}}}}}
   */
  app.post('/viewer/connect', (req, res) => {
    if (typeof req.body?.ticket !== 'string' || Object.keys(req.body).some(k => k !== 'ticket')) throw problem('invalid_request', 'A viewer ticket is required', 400);
    const t = tickets.get(req.body.ticket);
    if (!sameOrigin(req) || !t || t.closed || Date.now() > t.expires)
      throw problem('viewer_unauthorized', 'Viewer ticket expired or already used', 403);
    tickets.delete(t.token);
    capabilities.set(t.capability, t);
    res.set('Cache-Control', 'no-store').json(clientState(t));
  });
  /**
   * @openapi
   * {"/viewer/control":{"post":{"operationId":"camofox_viewer_control","tags":["Browser"],"summary":"Change viewer control mode or close the viewer","description":"Viewer browser transport; not an agent tool. POST requests require the exact local Origin. Capabilities are confined to one viewer.","security":[{"ViewerCapabilityAuth":[]}],"x-internal":true,"x-agent-notes":{"sideEffects":"Change viewer control mode or close the viewer","consistency":{"refresh":"Read session status"}},"responses":{"200":{"description":"Viewer result","content":{"application/json":{"schema":{"oneOf":[{"type":"object","additionalProperties":false,"required":["capability","socketTicket","mode","title"],"properties":{"capability":{"type":"string"},"socketTicket":{"type":"string"},"mode":{"type":"string","enum":["watch","control"]},"title":{"type":"string"}}},{"type":"object","required":["closed"],"additionalProperties":false,"properties":{"closed":{"type":"boolean","enum":[true]}}}]}}}},"400":{"description":"Viewer request failed","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AgentError"}}}},"403":{"description":"Viewer request failed","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AgentError"}}}},"409":{"description":"Viewer request failed","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AgentError"}}}},"503":{"description":"Viewer request failed","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AgentError"}}}}},"requestBody":{"required":true,"content":{"application/json":{"schema":{"type":"object","required":["action"],"additionalProperties":false,"properties":{"action":{"type":"string","enum":["watch","control","close"]}}}}}}}}}
   */
  app.post('/viewer/control', async (req, res) => {
    const t = authenticate(req);
    if (!['watch', 'control', 'close'].includes(req.body?.action) || Object.keys(req.body).some(k => k !== 'action')) throw problem('invalid_request', 'Invalid viewer action', 400);
    if (req.body.action === 'close') { await t.close(); return res.json({ closed: true }); }
    if (t.transition) throw problem('viewer_busy', 'A viewer mode change is already pending');
    finishHandoff(t, 'cancelled');
    res.set('Cache-Control', 'no-store').json(await changeMode(t, req.body.action));
  });
  async function changeMode(t, mode) {
    if (t.transition) throw problem('viewer_busy', 'A viewer mode change is already pending');
    t.transition = true;
    // Reserve immediately, before waiting for the current operation's session lock.
    t.w.humanControl = true;
    try {
      const state = await supervisor.serial(t.id, async () => {
        if (t.closed || supervisor.workers.get(t.id) !== t.w) throw problem('session_suspended', 'Viewer session ended');
        stopStream(t);
        await workerMode(t, mode === 'control', mode === 'watch');
        if (mode === 'watch') await supervisor.checkpoint(t.id);
        t.mode = mode;
        t.vnc = await launchers.startViewer(config.stateDir, t.id, t.display, t.mode);
        if (t.closed) { stopStream(t); throw problem('viewer_busy', 'Viewer closed during mode change'); }
        monitorBackend(t);
        t.state = 'opening';
        t.w.humanControl = t.mode === 'control';
        return clientState(t);
      });
      return state;
    } catch (e) { await t.close(); throw e; }
    finally { t.transition = false; }
  }
  function finishHandoff(t, outcome, error) {
    const h = t.handoff;
    if (!h) return;
    clearTimeout(h.timer); t.handoff = null;
    if (error) h.reject(error);
    else h.resolve({ sessionId: t.id, requestId: h.id, action: h.action, outcome, ...viewerStatus(t.w) });
  }
  function pendingHandoff(t) {
    if (t.handoff?.phase === 'pending' && Date.now() >= t.handoff.deadline) finishHandoff(t, 'timed_out');
    const h = t.handoff;
    return h ? { requestId: h.id, action: h.action, phase: h.phase, remainingMs: Math.max(0, h.deadline - Date.now()) } : null;
  }
  /**
   * @openapi
   * {"/viewer/handoff":{"post":{"operationId":"camofox_viewer_handoff","tags":["Browser"],"summary":"Read or answer an agent control handoff in the viewer","description":"Viewer capability and exact local Origin required. Status does not count as activity. Responses must arrive within the server-enforced 15-second deadline.","security":[{"ViewerCapabilityAuth":[]}],"x-internal":true,"x-agent-notes":{"sideEffects":"Accepting switches control mode; declining resolves the agent request without changing mode","consistency":{"refresh":"Read session status and obtain a fresh snapshot after return to agent"}},"requestBody":{"required":true,"content":{"application/json":{"schema":{"oneOf":[{"type":"object","additionalProperties":false,"required":["action"],"properties":{"action":{"type":"string","enum":["status"]}}},{"type":"object","additionalProperties":false,"required":["action","requestId","accept"],"properties":{"action":{"type":"string","enum":["respond"]},"requestId":{"type":"string"},"accept":{"type":"boolean"}}}]}}}},"responses":{"200":{"description":"Pending request or accepted mode transition","content":{"application/json":{"schema":{"oneOf":[{"type":"object","additionalProperties":false,"required":["pending"],"properties":{"pending":{"type":"object","nullable":true,"additionalProperties":false,"required":["requestId","action","phase","remainingMs"],"properties":{"requestId":{"type":"string"},"action":{"type":"string","enum":["give","request"]},"phase":{"type":"string","enum":["pending","switching"]},"remainingMs":{"type":"integer","minimum":0}}}}},{"type":"object","additionalProperties":false,"required":["capability","socketTicket","mode","title"],"properties":{"capability":{"type":"string"},"socketTicket":{"type":"string"},"mode":{"type":"string","enum":["watch","control"]},"title":{"type":"string"}}}]}}}},"400":{"description":"Viewer request failure","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AgentError"}}}},"403":{"description":"Viewer request failure","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AgentError"}}}},"409":{"description":"Viewer request failure","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AgentError"}}}},"503":{"description":"Viewer request failure","content":{"application/json":{"schema":{"$ref":"#/components/schemas/AgentError"}}}}}}}}
   */
  app.post('/viewer/handoff', async (req, res) => {
    const t = authenticate(req);
    const { action, requestId, accept } = req.body || {};
    if (action === 'status' && Object.keys(req.body).every(k => k === 'action'))
      return res.set('Cache-Control', 'no-store').json({ pending: pendingHandoff(t) });
    if (action !== 'respond' || typeof requestId !== 'string' || typeof accept !== 'boolean' || Object.keys(req.body).some(k => !['action', 'requestId', 'accept'].includes(k)))
      throw problem('invalid_request', 'Use status or respond with requestId and boolean accept', 400);
    pendingHandoff(t);
    const h = t.handoff;
    if (!h || h.id !== requestId || h.phase !== 'pending') throw problem('handoff_expired', 'This control request has expired or was already answered', 409);
    supervisor.touch(t.id);
    if (!accept) { finishHandoff(t, 'declined'); return res.json({ pending: null }); }
    h.phase = 'switching'; clearTimeout(h.timer);
    try {
      const state = await changeMode(t, h.action === 'give' ? 'control' : 'watch');
      finishHandoff(t, 'accepted');
      res.set('Cache-Control', 'no-store').json(state);
    } catch (e) { finishHandoff(t, 'cancelled', e); throw e; }
  });
  function stopStream(t) {
    t.generation++;
    for (const [key, value] of sockets) if (value.t === t) sockets.delete(key);
    clearInterval(t.heartbeat);
    t.backend?.destroy(); t.ws?.close(); t.vnc?.stop();
    t.backend = t.ws = t.vnc = null;
  }
  async function workerMode(t, humanControl, invalidate = false) {
    if (invalidate) for (const [key, observation] of supervisor.observations)
      if (observation.sessionId === t.id) supervisor.observations.delete(key);
    const state = await workerJson(t.w.socket, supervisor.config.workerKey, 'POST', '/internal/viewer-mode', { humanControl, invalidate });
    if (invalidate) t.w.requireFreshSnapshot = new Set(state.tabIds || []);
  }
  function monitorBackend(t) {
    const vnc = t.vnc;
    vnc.child.once('exit', () => { if (t.vnc === vnc && !t.closed) t.close(); });
  }
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, origin), entry = sockets.get(url.searchParams.get('ticket'));
    if (url.pathname !== '/viewer/socket' || !sameOrigin(req) || !entry || entry.t.closed || Date.now() > entry.expires || entry.generation !== entry.t.generation) { socket.destroy(); return; }
    sockets.delete(url.searchParams.get('ticket'));
    const { t, generation } = entry;
    wss.handleUpgrade(req, socket, head, ws => {
      t.ws = ws; clearTimeout(t.expiry);
      const backend = connect(t.vnc.socket); t.backend = backend;
      backend.on('connect', () => { t.state = 'connected'; });
      backend.on('data', data => { if (ws.readyState === 1) ws.send(data); });
      ws.on('message', data => {
        if (generation !== t.generation || t.closed) return;
        if (t.mode === 'control' && (data[0] === 4 || data[0] === 5)) supervisor.touch(t.id);
        backend.write(data);
      });
      const disconnected = () => { if (generation === t.generation && !t.closed) t.close(); };
      backend.on('error', disconnected); backend.on('close', disconnected);
      ws.on('close', disconnected); ws.on('error', disconnected);
      let alive = true;
      t.heartbeat = setInterval(() => { if (!alive) return ws.terminate(); alive = false; ws.ping(); }, 15000);
      ws.on('pong', () => { alive = true; });
    });
  });
  async function create(id, owner, kind) {
    const w = supervisor.workers.get(id);
    const session = supervisor.store.checkOwner(id, owner);
    if (!w || session.state !== 'active') throw problem('session_suspended', 'Resume the session first');
    if (w.viewer) throw problem('viewer_busy', 'A viewer is already open for this session');
    const { display } = await workerJson(w.socket, supervisor.config.workerKey, 'GET', '/internal/display');
    const profile = supervisor.store.profiles().find(p => p.id === session.profileId);
    const t = { id, w, display, kind, mode: kind === 'desktop' ? 'watch' : 'control', state: 'opening', generation: 0, token: secret(), capability: secret(), expires: Date.now() + 60000, title: `${profile?.name || 'Camofox'} · ${session.name}` };
    t.close = ({ checkpoint = true } = {}) => {
      if (t.closed) return t.closing || Promise.resolve();
      t.closed = true; clearTimeout(t.expiry);
      tickets.delete(t.token); capabilities.delete(t.capability); stopStream(t); t.desktop?.close();
      const controlled = w.humanControl;
      if (w.viewer === t) w.viewer = null;
      finishHandoff(t, 'cancelled');
      const finish = async () => {
        if (checkpoint && controlled && supervisor.workers.get(id) === w) {
          try { await workerMode(t, false, true); await supervisor.checkpoint(id); }
          catch { await supervisor.suspendUnlocked(id, supervisor.store.session(id).owner, { force: true }); }
        }
        w.humanControl = false;
      };
      if (!checkpoint || !controlled) { w.humanControl = false; return Promise.resolve(); }
      t.closing = supervisor.serial(id, finish).catch(() => {});
      return t.closing;
    };
    w.viewer = t; w.humanControl = t.mode === 'control';
    try {
      await workerMode(t, w.humanControl);
      t.vnc = await launchers.startViewer(config.stateDir, id, display, t.mode); monitorBackend(t);
      tickets.set(t.token, t); t.expiry = setTimeout(() => t.close(), 60000);
      if (kind === 'desktop') t.desktop = await launchers.startDesktop(config, `${origin}/viewer#${t.token}`, t.title, () => t.close());
      if (t.closed) { t.desktop?.close(); throw problem('viewer_failed', 'Viewer closed before startup completed', 503); }
      return t;
    } catch (e) { t.close({ checkpoint: false }); await workerMode(t, false, true).catch(() => {}); throw e; }
  }
  const open = async (id, owner) => supervisor.serial(id, async () => {
    const t = await create(id, owner, 'link');
    return { sessionId: id, url: `${origin}/viewer#${t.token}`, expiresInSeconds: 60, humanControl: true };
  });
  open.watch = async (id, owner, shouldOpen) => {
    supervisor.store.checkOwner(id, owner);
    if (!shouldOpen) return supervisor.serial(id, async () => {
      supervisor.store.checkOwner(id, owner);
      const w = supervisor.workers.get(id), t = w?.viewer;
      if (t?.kind === 'link') throw problem('viewer_busy', 'A manual login link viewer is open');
      const controlled = w?.humanControl;
      t?.close({ checkpoint: false });
      if (controlled && t) {
        try { await workerMode(t, false, true); await supervisor.checkpoint(id); }
        catch (e) { await supervisor.suspendUnlocked(id, owner, { force: true }); throw e; }
      }
      return { sessionId: id, ...viewerStatus(supervisor.workers.get(id)) };
    });
    return supervisor.serial(id, async () => {
      supervisor.store.checkOwner(id, owner);
      let t = supervisor.workers.get(id)?.viewer;
      if (t?.kind === 'link') throw problem('viewer_busy', 'A manual login link viewer is open');
      if (t) t.desktop?.present(); else t = await create(id, owner, 'desktop');
      return { sessionId: id, ...viewerStatus(supervisor.workers.get(id)) };
    });
  };
  open.control = async (id, owner, action) => {
    supervisor.store.checkOwner(id, owner);
    if (!['give', 'request'].includes(action)) throw problem('invalid_request', 'action must be give or request', 400);
    const w = supervisor.workers.get(id), t = w?.viewer;
    if (!w || supervisor.store.session(id).state !== 'active') throw problem('session_suspended', 'Resume the session first');
    if (!t || t.closed || t.state !== 'connected') throw problem('viewer_not_connected', 'Open the watch window and wait for it to connect first', 409);
    if (t.transition || t.handoff) throw problem('viewer_busy', 'A control request or mode change is already pending');
    supervisor.touch(id);
    const requestId = secret();
    if (t.mode === (action === 'give' ? 'control' : 'watch'))
      return { sessionId: id, requestId, action, outcome: 'already_in_mode', ...viewerStatus(w) };
    // Do not hold the session lock while waiting for the user's answer.
    return new Promise((resolve, reject) => {
      const h = { id: requestId, action, phase: 'pending', deadline: Date.now() + 15000, resolve, reject };
      t.handoff = h;
      h.timer = setTimeout(() => finishHandoff(t, 'timed_out'), 15000);
      t.desktop?.present();
    });
  };
  return open;
}
