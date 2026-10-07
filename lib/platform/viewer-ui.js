import RFB from '/viewer/assets/core/rfb.js';
const status = document.querySelector('#status'), modeButton = document.querySelector('#mode');
let capability, rfb, mode, changing = false, closed = false;
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
    changing = false; modeButton.disabled = false;
    status.textContent = mode === 'watch' ? 'Watching · agent can work' : 'You control this browser · agent actions paused';
    modeButton.textContent = mode === 'watch' ? 'Take control' : 'Return to agent';
    native('ready');
  });
  connection.addEventListener('disconnect', () => {
    ended.add(connection);
    if (connection !== rfb || changing) return;
    closed = true; modeButton.disabled = true; status.textContent = 'Viewer closed'; native('close');
  });
}
modeButton.onclick = async () => {
  changing = true; modeButton.disabled = true;
  status.textContent = mode === 'watch' ? 'Waiting for the current agent action to finish…' : 'Saving and returning control…';
  try {
    const data = await request('/viewer/control', { action: mode === 'watch' ? 'control' : 'watch' });
    disconnect(); connect(data);
  } catch (e) { changing = false; status.textContent = e.message; modeButton.disabled = false; }
};
document.querySelector('#close').onclick = async () => {
  if (!closed) { closed = true; disconnect(); if (capability) await request('/viewer/control', { action: 'close' }).catch(() => {}); }
  status.textContent = 'Viewer closed'; native('close');
};
window.addEventListener('pagehide', () => {
  if (!closed && capability) fetch('/viewer/control', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + capability }, body: JSON.stringify({ action: 'close' }) }).catch(() => {});
  disconnect();
});
const ticket = location.hash.slice(1); history.replaceState(null, '', location.pathname);
try { connect(await request('/viewer/connect', { ticket })); }
catch (e) { status.textContent = e.message; }
