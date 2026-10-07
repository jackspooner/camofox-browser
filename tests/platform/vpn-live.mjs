import { ProtonProvider } from "../../lib/platform/proton-launcher.js";
import { loadPlatformConfig } from "../../lib/config.js";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
const vpn = new ProtonProvider(loadPlatformConfig());
const routes = [];
const command = (ns, code) =>
  spawnSync(
    "sudo",
    [
      "-n",
      "ip",
      "netns",
      "exec",
      ns,
      "setpriv",
      "--reuid=1000",
      "--regid=1000",
      "--clear-groups",
      "/usr/bin/python3",
      "-c",
      code,
    ],
    { encoding: "utf8" },
  );
try {
  for (const country of ["GB", "NL"]) {
    const route = await vpn.connect(country, `acceptance-${country}`);
    routes.push(route);
    console.log("Tunnel authenticated", country, route.namespace);
    const result = command(
      route.namespace,
      "import urllib.request,json;d=json.load(urllib.request.urlopen(urllib.request.Request('https://api.protonvpn.ch/vpn/v1/location',headers={'x-pm-appversion':'linux-vpn-cli@5.8.7'}),timeout=15));print(json.dumps({k:d[k] for k in ['IP','Country'] if k in d}))",
    );
    assert.equal(result.status, 0, result.stderr);
    const egress = JSON.parse(result.stdout);
    assert(
      ["GB", "UK"].includes(country)
        ? ["GB", "UK"].includes(egress.Country)
        : egress.Country === country,
    );
    console.log("Verified egress country", country);
  }
  await vpn.renew(routes[0]);
  assert.equal(routes[0].ready, true);
  console.log("Certificate renewal reauthenticated the existing tunnel");
  await vpn.helper("block", routes[0].namespace);
  const blocked = command(
    routes[0].namespace,
    "import socket;socket.create_connection(('1.1.1.1',443),timeout=3)",
  );
  assert.notEqual(blocked.status, 0);
  console.log("Tunnel failure blocks traffic");
  const ipv6 = command(
    routes[1].namespace,
    "import socket;s=socket.socket(socket.AF_INET6,socket.SOCK_STREAM);s.settimeout(3);s.connect(('2606:4700:4700::1111',443))",
  );
  assert.notEqual(ipv6.status, 0);
  console.log("Untunnelled IPv6 blocked");
} finally {
  for (const r of routes) await vpn.disconnect(r).catch(() => {});
}
