// The managed x11vnc backend uses RFB 3.8 with None authentication on a private
// Unix socket. During transfer, permit only its handshake, never browser input.
// Commit before forwarding ServerInit, so no two clients can send input.
export function transferHandshake({ toClient, toBackend, ready }) {
  let phase = 'serverVersion', pending = Buffer.alloc(0);
  const version = Buffer.from('RFB 003.008\n');
  function receive(side, data) {
    if (phase === 'ready') return (side === 'client' ? toBackend : toClient)(data);
    if (!phase.startsWith(side)) throw new Error('Unexpected transfer handshake message');
    pending = Buffer.concat([pending, data]);
    if (pending.length > 65560) throw new Error('Transfer handshake too large');
    let length, next;
    switch (phase) {
      case 'serverVersion': length = 12; next = 'clientVersion'; break;
      case 'clientVersion': length = 12; next = 'serverSecurity'; break;
      case 'serverSecurity': length = pending.length ? 1 + pending[0] : 1; next = 'clientSecurity'; break;
      case 'clientSecurity': length = 1; next = 'serverResult'; break;
      case 'serverResult': length = 4; next = 'clientShared'; break;
      case 'clientShared': length = 1; next = 'serverInit'; break;
      case 'serverInit':
        if (pending.length < 24) return;
        length = 24 + pending.readUInt32BE(20); next = 'ready';
        if (length > 65560) throw new Error('Transfer server name too large');
        break;
    }
    if (pending.length < length) return;
    if (pending.length !== length) throw new Error('Unexpected data before transfer ready');
    if (phase.endsWith('Version') && !pending.equals(version)) throw new Error('Unsupported transfer RFB version');
    if (phase === 'serverSecurity' && (pending[0] === 0 || !pending.subarray(1).includes(1))) throw new Error('Unsupported transfer authentication');
    if (phase === 'clientSecurity' && pending[0] !== 1) throw new Error('Unsupported transfer authentication');
    if (phase === 'serverResult' && pending.readUInt32BE() !== 0) throw new Error('Transfer authentication failed');
    // Exclusive ClientInit would disconnect the current viewer before commit.
    if (phase === 'clientShared' && pending[0] !== 1) throw new Error('Transfer requires a shared connection');
    if (phase === 'serverInit' && (!pending.readUInt16BE(0) || !pending.readUInt16BE(2))) throw new Error('Invalid transfer framebuffer');
    const packet = pending; pending = Buffer.alloc(0); phase = next;
    if (phase === 'ready') ready();
    (side === 'client' ? toBackend : toClient)(packet);
  }
  return { client: data => receive('client', data), server: data => receive('server', data) };
}
