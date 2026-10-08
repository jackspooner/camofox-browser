import { VirtualDisplay } from '@camoufox/camoufox';

// Abstract X sockets are network-namespace-local. Filesystem X sockets and
// lock names are shared, so a routed :0 must never create or unlink host :0.
export class WorkerVirtualDisplay extends VirtualDisplay {
  get xvfbArgs() {
    return [...super.xvfbArgs, '-nolisten', 'unix'];
  }

  kill() {
    const child = this.proc;
    if (!child) return;
    if (child.exitCode === null && child.signalCode === null) {
      try { child.kill('SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    this.proc = null;
    // Do not call super.kill(): it unconditionally unlinks shared X files.
  }
}
