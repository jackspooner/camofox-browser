import RFB from '/viewer/assets/core/rfb.js';
const status = document.querySelector('#status'), modeButton = document.querySelector('#mode');
let capability, rfb, mode, changing = false, closed = false;
let connected = false;
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
  updateTabControls();
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

const tabList = document.querySelector('#tabs'), tabStatus = document.querySelector('#tab-status');
let tabTimer, tabPolling = false, tabRefreshRequested = false, selectingTab = false, tabsFresh = false, tabEpoch = 0, activeTabId = null, restoreTabFocus = null, tabError = '';
const tabButtons = new Map();
function updateTabControls(message) {
  const enabled = connected && !changing && !closed && !handoff && !selectingTab && tabsFresh && mode === 'control';
  for (const button of tabButtons.values()) button.disabled = !enabled;
  tabStatus.textContent = message || (closed ? 'Viewer closed' : tabError) || (closed ? 'Viewer closed' : changing || !connected ? 'Connecting tabs…' : selectingTab ? 'Switching tab…' : mode === 'watch' ? 'Following agent · Take control to switch tabs' : 'Select a tab · Agent actions paused');
}
function renderTabs(data) {
  const ids = new Set(data.tabs.map(tab => tab.id));
  const lostFocus = tabList.contains(document.activeElement) && !ids.has(document.activeElement.dataset.tabId);
  for (const [id, button] of tabButtons) if (!ids.has(id)) { button.remove(); tabButtons.delete(id); }
  for (const [index, tab] of data.tabs.entries()) {
    let button = tabButtons.get(tab.id);
    if (!button) {
      button = document.createElement('button'); button.className = 'browser-tab'; button.type = 'button';
      button.setAttribute('role', 'tab'); button.setAttribute('aria-controls', 'screen'); button.dataset.tabId = tab.id;
      button.onclick = () => selectTab(tab.id); tabButtons.set(tab.id, button);
    }
    button.textContent = tab.title.trim() || (['about:blank', 'about:newtab', ''].includes(tab.url) ? 'New tab' : tab.url);
    button.title = tab.url;
    button.setAttribute('aria-selected', String(tab.id === data.activeTabId));
    // Keep existing DOM nodes in place, preserving focus while titles refresh.
    if (tabList.children[index] !== button) tabList.insertBefore(button, tabList.children[index] || null);
  }
  const focused = tabList.contains(document.activeElement) ? document.activeElement : null;
  const entry = focused || tabButtons.get(data.activeTabId) || tabButtons.values().next().value;
  for (const button of tabButtons.values()) button.tabIndex = button === entry ? 0 : -1;
  tabsFresh = true; tabError = ''; updateTabControls();
  if (activeTabId !== data.activeTabId) tabButtons.get(data.activeTabId)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  activeTabId = data.activeTabId;
  const restore = tabButtons.get(restoreTabFocus) || (lostFocus ? entry : null);
  if (restore && !restore.disabled) { restore.focus(); for (const button of tabButtons.values()) button.tabIndex = button === restore ? 0 : -1; restoreTabFocus = null; }
}
async function pollTabs() {
  clearTimeout(tabTimer);
  if (closed) return;
  if (tabPolling) { tabRefreshRequested = true; return; }
  if (capability && connected && !changing && !selectingTab && !tabPolling) {
    tabPolling = true; const epoch = tabEpoch;
    try {
      const data = await request('/viewer/tabs', { action: 'status' }, 4000);
      if (!closed && epoch === tabEpoch && !changing && !selectingTab) renderTabs(data);
    } catch (e) {
      if (!closed && epoch === tabEpoch) { tabsFresh = false; activeTabId = null; for (const button of tabButtons.values()) button.setAttribute('aria-selected', 'false'); tabError = 'Tabs unavailable · ' + e.message; updateTabControls(); }
    } finally { tabPolling = false; }
  }
  if (!closed) tabTimer = setTimeout(pollTabs, tabRefreshRequested ? 0 : 1000);
  tabRefreshRequested = false;
}
async function selectTab(tabId) {
  if (tabButtons.get(tabId)?.disabled || selectingTab || mode !== 'control') return;
  restoreTabFocus = tabList.contains(document.activeElement) ? tabId : null;
  selectingTab = true; tabError = ''; tabEpoch++; updateTabControls();
  let error;
  try { await request('/viewer/tabs', { action: 'select', tabId }, 12000); }
  catch (e) { error = e; }
  finally {
    selectingTab = false; tabsFresh = false; updateTabControls(); await pollTabs();
    if (error && !closed) { tabError = error.message + ' · Refreshing tab state; selection was not retried'; updateTabControls(); }
  }
}
tabList.onkeydown = event => {
  if (['Enter', ' '].includes(event.key) && event.target.matches('.browser-tab')) { event.preventDefault(); if (!event.repeat) event.target.click(); return; }
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = [...tabList.children].filter(button => !button.disabled);
  if (!buttons.length) return;
  event.preventDefault();
  const index = buttons.indexOf(document.activeElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  for (const button of buttons) button.tabIndex = -1;
  buttons[next].tabIndex = 0; buttons[next].focus();
};

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
  changing = true; tabEpoch++; updateTabControls(); modeButton.disabled = acceptButton.disabled = declineButton.disabled = true;
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
async function request(path, body, timeoutMs) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(capability ? { Authorization: 'Bearer ' + capability } : {}) }, body: JSON.stringify(body), ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.problem?.detail || data.error || 'Viewer request failed');
  return data;
}
function connect(data) {
  capability = data.capability; mode = data.mode; tabError = ''; connected = false; tabsFresh = false; tabEpoch++; updateTabControls();
  document.querySelector('#title').textContent = data.title;
  document.title = data.title + ' — Camofox';
  const connection = new RFB(document.querySelector('#screen'), location.origin.replace(/^http/, 'ws') + '/viewer/socket?ticket=' + encodeURIComponent(data.socketTicket));
  rfb = connection; connection.viewOnly = mode === 'watch'; connection.scaleViewport = true; connection.resizeSession = false;
  connection.addEventListener('connect', () => {
    changing = false; connected = true; modeButton.disabled = !!handoff;
    updateTabControls(); pollTabs();
    status.textContent = modeStatus();
    modeButton.textContent = mode === 'watch' ? 'Take control' : 'Return to agent';
    native('ready');
  });
  connection.addEventListener('disconnect', () => {
    ended.add(connection);
    if (connection !== rfb || changing) return;
    closed = true; connected = false; tabEpoch++; clearTimeout(tabTimer); clearTimeout(pollTimer); showHandoff(null); modeButton.disabled = true; status.textContent = 'Viewer closed'; native('close');
  });
}
modeButton.onclick = async () => {
  if (handoff || changing || closed) return;
  changing = true; tabEpoch++; updateTabControls(); modeButton.disabled = true;
  status.textContent = mode === 'watch' ? 'Stopping agent input safely…' : 'Saving and returning control…';
  try {
    const data = await request('/viewer/control', { action: mode === 'watch' ? 'control' : 'watch' });
    disconnect(); connect(data);
  } catch (e) { changing = false; updateTabControls(); pollTabs(); status.textContent = e.message; modeButton.disabled = false; }
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
  clearTimeout(tabTimer); tabEpoch++; clearTimeout(pollTimer); showHandoff(null); status.textContent = 'Viewer closed'; native('close');
};
window.addEventListener('pagehide', () => {
  clearTimeout(tabTimer); tabEpoch++;
  if (!closed && capability) fetch('/viewer/control', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + capability }, body: JSON.stringify({ action: 'close' }) }).catch(() => {});
  disconnect();
});
const ticket = location.hash.slice(1); history.replaceState(null, '', location.pathname);
try { connect(await request('/viewer/connect', { ticket })); pollHandoff(); }
catch (e) { status.textContent = e.message; }
