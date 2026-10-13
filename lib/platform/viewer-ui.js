import RFB from '/viewer/assets/core/rfb.js';
const status = document.querySelector('#status'), modeButton = document.querySelector('#mode');
let capability, rfb, mode, changing = false, closed = false;
let paused = false;
const transferButton = document.querySelector('#transfer'), transferPanel = document.querySelector('#transfer-panel');
const transferUrl = document.querySelector('#transfer-url'), copyButton = document.querySelector('#transfer-copy'), transferStatus = document.querySelector('#transfer-status');
let transferTimer, transferDeadline = 0, creatingTransfer = false, transferRevision = 0;
function clearTransfer() {
  // Older running gateways serve this file from disk until their next rollout.
  if (!transferPanel) return;
  transferRevision++;
  clearInterval(transferTimer); transferDeadline = 0; transferUrl.value = ''; transferPanel.hidden = true;
}
function updateTransferButton() {
  if (!transferButton) return;
  transferButton.disabled = !capability || changing || closed || !!handoff || creatingTransfer;
}
if (transferButton) transferButton.onclick = async () => {
  if (transferButton.disabled) return;
  creatingTransfer = true; updateTransferButton(); clearTransfer();
  const revision = transferRevision;
  try {
    const data = await request('/viewer/transfer', {});
    if (closed || changing || handoff || revision !== transferRevision) return;
    transferUrl.value = data.url; transferPanel.hidden = false;
    transferDeadline = performance.now() + data.expiresInSeconds * 1000;
    const tick = () => {
      const seconds = Math.max(0, Math.ceil((transferDeadline - performance.now()) / 1000));
      copyButton.disabled = seconds === 0;
      transferStatus.textContent = seconds ? `Link expires in ${seconds}s` : 'Link expired. Create a new viewer URL to try again.';
      if (!seconds) { clearInterval(transferTimer); transferUrl.value = ''; }
    };
    tick(); transferTimer = setInterval(tick, 1000); transferUrl.focus(); transferUrl.select();
  } catch (e) { if (!closed && revision === transferRevision) { transferPanel.hidden = false; copyButton.disabled = true; transferStatus.textContent = e.message; } }
  finally { creatingTransfer = false; updateTransferButton(); }
};
if (copyButton) copyButton.onclick = async () => {
  if (closed || !transferUrl.value || performance.now() >= transferDeadline) return;
  try {
    if (window.webkit?.messageHandlers?.viewer) {
      native(JSON.stringify({ action: 'copy-viewer-url', url: transferUrl.value }));
      return;
    }
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(transferUrl.value);
    else {
      transferUrl.focus(); transferUrl.select();
      if (!document.execCommand('copy')) throw new Error('Copy unavailable');
    }
    transferStatus.textContent = 'URL copied';
  } catch { transferUrl.focus(); transferUrl.select(); transferStatus.textContent = 'Copy unavailable. Copy the selected URL manually.'; }
};
window.addEventListener('viewer-url-copied', () => { if (!closed && transferDeadline) transferStatus.textContent = 'URL copied'; });
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
  if (pending) clearTransfer();
  updateTransferButton();
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
  const channel = new WebSocket(location.origin.replace(/^http/, 'ws') + '/viewer/socket?ticket=' + encodeURIComponent(data.socketTicket));
  let moved = false;
  channel.addEventListener('close', event => { moved = event.code === 4001 && event.reason === 'viewer_moved'; });
  const connection = new RFB(document.querySelector('#screen'), channel);
  rfb = connection; connection.viewOnly = mode === 'watch'; connection.scaleViewport = true; connection.resizeSession = false;
  connection.addEventListener('connect', () => {
    changing = false; modeButton.disabled = !!handoff; updateTransferButton();
    status.textContent = modeStatus();
    modeButton.textContent = mode === 'watch' ? 'Take control' : 'Return to agent';
    native('ready');
    if (!pollTimer) pollHandoff();
  });
  connection.addEventListener('disconnect', () => {
    ended.add(connection);
    if (connection !== rfb || changing) return;
    closed = true; capability = null; clearTransfer(); clearTimeout(pollTimer); showHandoff(null); modeButton.disabled = stopButton.disabled = resumeButton.disabled = true; status.textContent = moved ? 'Viewer moved to another browser.' : 'Viewer closed'; native('close');
  });
}
modeButton.onclick = async () => {
  if (handoff || changing || closed) return;
  changing = true; modeButton.disabled = true; clearTransfer(); updateTransferButton();
  status.textContent = mode === 'watch' ? 'Stopping agent input safely…' : 'Saving and returning control…';
  try {
    const data = await request('/viewer/control', { action: mode === 'watch' ? 'control' : 'watch' });
    disconnect(); connect(data);
  } catch (e) { changing = false; status.textContent = e.message; modeButton.disabled = false; updateTransferButton(); }
};
stopButton.onclick = async () => {
  if (closed) return;
  clearTransfer();
  stopButton.disabled=true; status.textContent='Stopping current and queued actions…';
  try {showOperations(await request('/viewer/control',{action:'stop'}));status.textContent=modeStatus();}
  catch(e){status.textContent=e.message;}finally{stopButton.disabled=closed;}
};
resumeButton.onclick = async () => {
  if (closed) return;
  clearTransfer();
  resumeButton.disabled=true;
  try{showOperations(await request('/viewer/control',{action:'resume'}));status.textContent=modeStatus();}
  catch(e){status.textContent=e.message;}finally{resumeButton.disabled=false;}
};
document.querySelector('#close').onclick = async () => {
  if (!closed) { closed = true; disconnect(); if (capability) await request('/viewer/control', { action: 'close' }).catch(() => {}); }
  clearTransfer(); clearTimeout(pollTimer); showHandoff(null); status.textContent = 'Viewer closed'; native('close');
};
window.addEventListener('pagehide', () => {
  if (!closed && capability) fetch('/viewer/control', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + capability }, body: JSON.stringify({ action: 'close' }) }).catch(() => {});
  disconnect();
});
const ticket = location.hash.slice(1); history.replaceState(null, '', location.pathname);
try { connect(await request('/viewer/connect', { ticket })); }
catch (e) { status.textContent = e.message; }
