import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { problem } from "./store.js";
const script = fileURLToPath(
  new URL("../../scripts/proton-provider.py", import.meta.url),
);
async function stopAgent(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve, reject) => {
    let hardDeadline;
    const finish = (error) => {
      clearTimeout(deadline);
      clearTimeout(hardDeadline);
      child.removeListener("exit", onExit);
      child.removeListener("error", onError);
      error ? reject(error) : resolve();
    };
    const onExit = () => finish();
    const onError = (error) => finish(error);
    const deadline = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch (error) {
        finish(error);
        return;
      }
      hardDeadline = setTimeout(() => finish(problem(
        "vpn_handshake_failed",
        "Proton agent did not stop; repair routing before retrying",
        503,
      )), 1000);
    }, 5000);
    child.once("exit", onExit);
    child.once("error", onError);
    try {
      child.kill();
    } catch (error) {
      finish(error);
    }
  });
}
function run(command, args, input, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    let errors = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(problem("proton_timeout", "Proton operation timed out", 503));
    }, timeout);
    child.stdout.on("data", (c) => (output += c));
    child.stderr.on("data", (c) => {
      if (errors.length < 2048) errors += c;
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code !== 0 || signal) {
        let error;
        try {
          error = JSON.parse(output);
        } catch {}
        reject(
          problem(
            error?.code || "proton_unavailable",
            error?.code === "proton_login_required"
              ? "Run scripts/proton-provider.py setup in a local terminal"
              : "Proton operation failed; check account login and installed provider components",
            503,
          ),
        );
      } else {
        try {
          resolve(output ? JSON.parse(output) : {});
        } catch (e) {
          reject(e);
        }
      }
    });
    child.stdin.end(input ? JSON.stringify(input) : undefined);
  });
}
export class ProtonProvider {
  constructor(config) {
    this.config = config;
    this.routes = new Map();
    this.connectQueue = Promise.resolve();
  }
  async provider(action, extra = {}) {
    return (await run(this.config.protonPython, [script], { action, ...extra }))
      .result;
  }
  async status() {
    try {
      return await this.provider("status");
    } catch (e) {
      return { authenticated: false, setupRequired: true, code: e.code };
    }
  }
  countries() {
    return this.provider("countries");
  }
  async resolveCountry(value) {
    if (typeof value !== "string")
      throw problem(
        "invalid_country",
        "Country must be a name or ISO code",
        400,
      );
    const { countries } = await this.countries();
    const found = countries.find(
      (c) =>
        c.code.toLowerCase() === value.trim().toLowerCase() ||
        c.name.toLowerCase() === value.trim().toLowerCase(),
    );
    if (!found)
      throw problem(
        "country_unavailable",
        "Country unavailable for this account",
        422,
      );
    return found.code;
  }
  helper(action, namespace, input) {
    return run("sudo", ["-n", this.config.vpnHelper, action, namespace], input);
  }
  serializeNetwork(action) {
    const pending = this.connectQueue.catch(() => {}).then(action);
    this.connectQueue = pending;
    return pending;
  }
  connect(country, identity) {
    return this.serializeNetwork(() => this.connectUnlocked(country, identity));
  }
  current(route) {
    return !route.stopping && this.routes.get(route.namespace) === route;
  }
  block(route, agent = route.agent) {
    return this.serializeNetwork(async () => {
      if (!this.current(route) || route.agent !== agent) return;
      route.ready = false;
      await this.helper("block", route.namespace);
    });
  }
  async connectUnlocked(country, identity) {
    const p = await this.provider("prepare", { country, identity });
    if (this.routes.size >= p.maxConnections)
      throw problem(
        "vpn_connection_limit",
        "Proton connection limit reached",
        429,
      );
    const namespace = `cf-${process.getuid()}-${createHash("sha256").update(identity).digest("hex").slice(0, 12)}`;
    if (this.routes.has(namespace))
      throw problem("vpn_handshake_failed", "Previous route cleanup is incomplete; repair routing before retrying", 503);
    await this.helper("create", namespace, {
      endpoint: p.endpoint,
      port: p.port,
      publicKey: p.publicKey,
      privateKey: p.privateKey,
    });
    const route = {
      namespace,
      country,
      identity,
      server: p.server,
      domain: p.domain,
      bouncing: p.bouncing,
      ready: false,
    };
    this.routes.set(namespace, route);
    try {
      await this.startAgent(route, p);
      route.refresh = setInterval(
        async () => {
          try {
            await this.renew(route);
          } catch {
            await this.block(route).catch(() => {});
          }
        },
        Math.min(3600000, Math.max(60000, (p.validFor - 300) * 1000)),
      );
      return route;
    } catch (e) {
      await this.disconnectUnlocked(route);
      throw e;
    }
  }
  renew(route) {
    if (!this.current(route)) return Promise.resolve();
    if (route.renewal) return route.renewal;
    route.renewal = this.renewUnlocked(route).finally(() => {
      route.renewal = null;
    });
    return route.renewal;
  }
  async renewUnlocked(route) {
    const fresh = await this.provider("renew", { identity: route.identity });
    // Do not authenticate a replacement while a previous block/down command
    // still owns this namespace. Disconnect can cancel the handshake immediately.
    await this.serializeNetwork(async () => {
      if (!this.current(route)) return;
      await this.startAgent(route, {
        ...fresh,
        domain: route.domain,
        bouncing: route.bouncing,
      });
    });
  }
  async startAgent(route, p) {
    if (!this.current(route) || route.pendingAgent)
      throw problem("vpn_handshake_failed", "Proton route is stopping or already renewing", 503);
    const previous = route.agent;
    const child = spawn("sudo", ["-n", this.config.vpnHelper, "agent", route.namespace], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    // Keep retiring agents reachable while their replacements authenticate.
    (route.agents ||= new Set()).add(child);
    child.once("exit", () => route.agents.delete(child));
    route.pendingAgent = child;
    try {
      await new Promise((resolve, reject) => {
        let buffer = "";
        let ready = false;
        let failed = false;
        const fail = () => {
          if (ready || failed) return;
          failed = true;
          clearTimeout(timer);
          reject(problem("vpn_handshake_failed", "Proton tunnel authentication failed or was cancelled", 503));
        };
        const timer = setTimeout(fail, 30000);
        route.cancelAgentStart = fail;
        child.on("error", fail);
        child.stdin.on("error", fail);
        child.stdout.on("data", chunk => {
          buffer += chunk;
          for (const line of buffer.split("\n").slice(0, -1)) {
            let status;
            try { status = JSON.parse(line); } catch { continue; }
            if (status.ready && !ready && !failed) {
              if (!this.current(route)) { fail(); return; }
              ready = true;
              route.agent = child;
              route.ready = true;
              route.egressCountry = status.country === "UK" ? "GB" : status.country;
              clearTimeout(timer);
              resolve();
            }
          }
          buffer = buffer.split("\n").at(-1);
        });
        child.once("exit", () => {
          clearTimeout(timer);
          if (!ready) fail();
          if (route.agent === child && this.current(route)) {
            route.ready = false;
            this.block(route, child).catch(() => {});
          }
        });
        child.stdin.end(JSON.stringify({
          domain: p.domain,
          agentKey: p.agentKey,
          certificate: p.certificate,
          bouncing: p.bouncing,
        }));
      });
      if (!this.current(route) || child.exitCode !== null || child.signalCode !== null)
        throw problem("vpn_handshake_failed", "Proton route stopped during authentication", 503);
      await stopAgent(previous);
      if (!this.current(route) || child.exitCode !== null || child.signalCode !== null)
        throw problem("vpn_handshake_failed", "Proton route stopped during authentication", 503);
    } catch (error) {
      await stopAgent(child);
      throw error;
    } finally {
      if (route.pendingAgent === child &&
          (route.agent === child || child.exitCode !== null || child.signalCode !== null)) {
        route.pendingAgent = null;
        route.cancelAgentStart = null;
      }
    }
  }
  disconnect(route) {
    route.stopping = true;
    route.ready = false;
    clearInterval(route.refresh);
    route.cancelAgentStart?.();
    return this.serializeNetwork(() => this.disconnectUnlocked(route));
  }
  async disconnectUnlocked(route) {
    route.stopping = true;
    route.ready = false;
    clearInterval(route.refresh);
    route.cancelAgentStart?.();
    const agents = new Set([route.agent, route.pendingAgent, ...(route.agents || [])]);
    await Promise.all([...agents].map(stopAgent));
    route.agent = null;
    // An old cleanup callback must never delete a newer route's namespace.
    if (this.routes.get(route.namespace) !== route) return;
    await this.helper("down", route.namespace);
    this.routes.delete(route.namespace);
  }
}
