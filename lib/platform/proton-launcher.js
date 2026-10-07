import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { problem } from "./store.js";
const script = fileURLToPath(
  new URL("../../scripts/proton-provider.py", import.meta.url),
);
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
  async connect(country, identity) {
    const pending = this.connectQueue
      .catch(() => {})
      .then(() => this.connectUnlocked(country, identity));
    this.connectQueue = pending;
    return pending;
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
            route.ready = false;
            await this.helper("block", namespace).catch(() => {});
          }
        },
        Math.min(3600000, Math.max(60000, (p.validFor - 300) * 1000)),
      );
      return route;
    } catch (e) {
      await this.disconnect(route);
      throw e;
    }
  }
  async renew(route) {
    const fresh = await this.provider("renew", { identity: route.identity });
    if (this.routes.get(route.namespace) !== route) return;
    await this.startAgent(route, {
      ...fresh,
      domain: route.domain,
      bouncing: route.bouncing,
    });
  }
  async startAgent(route, p) {
    const previous = route.agent;
    const child = spawn(
      "sudo",
      ["-n", this.config.vpnHelper, "agent", route.namespace],
      { stdio: ["pipe", "pipe", "ignore"] },
    );
    await new Promise((resolve, reject) => {
      let buffer = "";
      let ready = false;
      const timer = setTimeout(() => {
        child.kill();
        reject(
          problem(
            "vpn_handshake_failed",
            "Proton tunnel authentication did not become ready",
            503,
          ),
        );
      }, 30000);
      child.stdout.on("data", (chunk) => {
        buffer += chunk;
        for (const line of buffer.split("\n").slice(0, -1)) {
          try {
            const status = JSON.parse(line);
            if (status.ready && !ready) {
              ready = true;
              route.ready = true;
              route.egressCountry =
                status.country === "UK" ? "GB" : status.country;
              clearTimeout(timer);
              resolve();
            }
          } catch {}
        }
        buffer = buffer.split("\n").at(-1);
      });
      child.on("error", reject);
      child.once("exit", () => {
        clearTimeout(timer);
        if (!ready)
          reject(
            problem(
              "vpn_handshake_failed",
              "Proton tunnel authentication failed",
              503,
            ),
          );
        if (route.agent === child) {
          route.ready = false;
          this.helper("block", route.namespace).catch(() => {});
        }
      });
      child.stdin.end(
        JSON.stringify({
          domain: p.domain,
          agentKey: p.agentKey,
          certificate: p.certificate,
          bouncing: p.bouncing,
        }),
      );
    });
    route.agent = child;
    previous?.kill();
  }
  async disconnect(route) {
    clearInterval(route.refresh);
    route.ready = false;
    this.routes.delete(route.namespace);
    const child = route.agent;
    route.agent = null;
    child?.kill();
    await this.helper("down", route.namespace);
  }
}
