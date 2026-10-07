import RFB from '/viewer/assets/core/rfb.js';
const status = document.querySelector('#status'), modeButton = document.querySelector('#mode');
let capability, rfb, mode, changing = false, closed = false;
let paused = false;
const stopButton=document.querySelector('#stop'),resumeButton=document.querySelector('#resume'),operationStatus=document.querySelector('#operation');
function showOperations(data) {
  paused=!!data.automationPaused; resumeButton.hidden=!paused;
  const op=data.operations?.find(o=>o.state!=='queued')||data.operations?.[0];
  operationStatus.textContent=op ? `${op.kind} · ${op.state} · ${Math.floor((Date.now()-op.created)/1000)}s · ${op.progress.total!==undefined?`${op.progress.completed||0}/${op.progress.total}`:'working…'}` : paused?'Automation paused':'';
  operationStatus.setAttribute("aria-label",operationStatus.textContent);
  if(!changing&&!closed)status.textContent=modeStatus();
  stopButton.disabled=closed;
}
let handoff = null, pollTimer, countdownTimer, polling = false;
const banner = document.querySelector('#handoff'), acceptButton = document.querySelector('#handoff-accept'), declineButton = document.querySelector('#handoff-decline');
const modeStatus = () => mode === 'watch' ? (paused ? 'Watching · automation paused' : 'Watching · agent can work') : 'You control this browser · agent actions paused';
function showHandoff(pending) {
  clearInterval(countdownTimer);
  const previous = handoff;
  handoff = pending;
  banner.hidden = !pending;
  modeButton.disabled = changing || !!pending || closed;
  if (!pending) {
    if (previous && !changing) status.textContent = 'Control request ended · agent notified';
    return;
  }
  document.querySelector('#handoff-message').textContent = pending.action === 'give' ? 'The agent is offering you control of this browser.' : 'The agent is asking you to return control.';
  acceptButton.textContent = pending.action === 'give' ? 'Accept control' : 'Return control';
  const deadline = performance.now() + pending.remainingMs;
  const update = () => {
    const seconds = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    const switching = pending.phase === 'switching' || changing;
    document.querySelector('#handoff-timer').textContent = switching ? 'Accepted · switching control…' : `${seconds}s to respond`;
    banner.setAttribute('aria-label', document.querySelector('#handoff-message').textContent + ' ' + document.querySelector('#handoff-timer').textContent);
    acceptButton.disabled = declineButton.disabled = switching || seconds === 0;
  };
  update(); countdownTimer = setInterval(update, 100);
}
async function pollHandoff() {
  if (closed) return;
  if (capability && !polling) {
    polling = true;
    try {
      const data = await request('/viewer/handoff', { action: 'status' });
      if (!closed) {showOperations(data);if(!changing)showHandoff(data.pending);}
    } catch (e) {
      if (!closed && !changing) { showHandoff(null); status.textContent = e.message; }
    } finally { polling = false; }
  }
  pollTimer = setTimeout(pollHandoff, 250);
}
async function answerHandoff(accept) {
  if (!handoff || changing || closed) return;
  const requestId = handoff.requestId;
  changing = true; modeButton.disabled = acceptButton.disabled = declineButton.disabled = true;
  document.querySelector('#handoff-timer').textContent = accept ? 'Accepted · switching control…' : 'Declining…';
  try {
    const data = await request('/viewer/handoff', { action: 'respond', requestId, accept });
    showHandoff(null);
    if (data.socketTicket) { disconnect(); connect(data); }
    else { changing = false; modeButton.disabled = false; status.textContent = 'Request declined · agent notified'; }
  } catch (e) { changing = false; showHandoff(null); status.textContent = e.message; }
}
acceptButton.onclick = () => answerHandoff(true);
declineButton.onclick = () => answerHandoff(false);
const ended = new WeakSet();
const disconnect = () => { if (rfb && !ended.has(rfb)) rfb.disconnect(); };
const native = message => window.webkit?.messageHandlers?.viewer?.postMessage(message);
async function request(path, body) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(capability ? { Authorization: 'Bearer ' + capability } : {}) }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.problem?.detail || data.error || 'Viewer request failed');
  return data;
}
function connect(data) {
  capability = data.capability; mode = data.mode;
  document.querySelector('#title').textContent = data.title;
  document.title = data.title + ' — Camofox';
  const connection = new RFB(document.querySelector('#screen'), location.origin.replace(/^http/, 'ws') + '/viewer/socket?ticket=' + encodeURIComponent(data.socketTicket));
  rfb = connection; connection.viewOnly = mode === 'watch'; connection.scaleViewport = true; connection.resizeSession = false;
  connection.addEventListener('connect', () => {
    changing = false; modeButton.disabled = !!handoff;
    status.textContent = modeStatus();
    modeButton.textContent = mode === 'watch' ? 'Take control' : 'Return to agent';
    native('ready');
  });
  connection.addEventListener('disconnect', () => {
    ended.add(connection);
    if (connection !== rfb || changing) return;
    closed = true; clearTimeout(pollTimer); showHandoff(null); modeButton.disabled = true; status.textContent = 'Viewer closed'; native('close');
  });
}
modeButton.onclick = async () => {
  if (handoff || changing || closed) return;
  changing = true; modeButton.disabled = true;
  status.textContent = mode === 'watch' ? 'Stopping agent input safely…' : 'Saving and returning control…';
  try {
    const data = await request('/viewer/control', { action: mode === 'watch' ? 'control' : 'watch' });
    disconnect(); connect(data);
  } catch (e) { changing = false; status.textContent = e.message; modeButton.disabled = false; }
};
stopButton.onclick = async () => {
  stopButton.disabled=true; status.textContent='Stopping current and queued actions…';
  try {showOperations(await request('/viewer/control',{action:'stop'}));status.textContent=modeStatus();}
  catch(e){status.textContent=e.message;}finally{stopButton.disabled=closed;}
};
resumeButton.onclick = async () => {
  resumeButton.disabled=true;
  try{showOperations(await request('/viewer/control',{action:'resume'}));status.textContent=modeStatus();}
  catch(e){status.textContent=e.message;}finally{resumeButton.disabled=false;}
};
document.querySelector('#close').onclick = async () => {
  if (!closed) { closed = true; disconnect(); if (capability) await request('/viewer/control', { action: 'close' }).catch(() => {}); }
  clearTimeout(pollTimer); showHandoff(null); status.textContent = 'Viewer closed'; native('close');
};
window.addEventListener('pagehide', () => {
  if (!closed && capability) fetch('/viewer/control', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + capability }, body: JSON.stringify({ action: 'close' }) }).catch(() => {});
  disconnect();
});
const ticket = location.hash.slice(1); history.replaceState(null, '', location.pathname);
try { connect(await request('/viewer/connect', { ticket })); pollHandoff(); }
catch (e) { status.textContent = e.message; }
