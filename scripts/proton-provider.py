#!/usr/bin/python3
"""Private JSON IPC adapter over Proton's installed, official Python components.

Run `python3 scripts/proton-provider.py setup` in a terminal for interactive
sign-in. Credentials remain in the desktop Secret Service, never Camofox SQLite.
"""
import asyncio
import json
import sys
import subprocess
import keyring.backends.SecretService
from proton.sso import ProtonSSO
from proton.vpn.core.session_holder import SessionHolder, ClientTypeMetadata
from proton.vpn.session import VPNSession
from proton.vpn.session.credentials import VPNSecrets, VPNPubkeyCredentials
from proton.vpn.session.fetcher import VPNSessionFetcher


async def run(request):
    # Select the Secret Service explicitly; never fall back to a plaintext store.
    sso = ProtonSSO(appversion=SessionHolder._get_app_version_header_value(ClientTypeMetadata(type="cli")), user_agent="Camofox-Proton-Integration/1.0", keyring_backend_name="secret_service")
    session = sso.get_default_session(override_class=VPNSession)
    if not session.authenticated:
        if request["action"] == "status":
            return {"authenticated": False, "setupRequired": True}
        raise RuntimeError("proton_login_required: run scripts/proton-provider.py setup in a terminal")
    if request["action"] == "status":
        return {"authenticated": True, "setupRequired": False}
    if not session.loaded:
        await session.fetch_session_data()
    elif session.server_list.expired:
        await session.fetch_server_list()
    elif session.server_list.loads_expired:
        await session.update_server_loads()
    servers = session.server_list
    available = list(servers.get_available_servers(servers.logicals, session.vpn_account.max_tier))
    countries = {("GB" if s.exit_country == "UK" else s.exit_country): s.exit_country_name for s in available}
    if request["action"] == "countries":
        return {"countries": [{"code": c, "name": n} for c,n in sorted(countries.items())], "maxConnections": session.vpn_account.max_connections}
    if request["action"] not in ("prepare", "renew"):
        raise ValueError("Unknown provider action")
    ring = keyring.backends.SecretService.Keyring()
    identity = request["identity"]
    previous = ring.get_password("camofox-proton-tunnels", identity)
    secrets = VPNSecrets(previous)
    if not previous:
        ring.set_password("camofox-proton-tunnels", identity, secrets.ed25519_privatekey)
    certificate = await VPNSessionFetcher(session=session).fetch_certificate(secrets.ed25519_pk_pem)
    credentials = VPNPubkeyCredentials(certificate, secrets)
    if request["action"] == "renew":
        return {"agentKey": credentials.get_ed25519_sk_pem(), "certificate": credentials.certificate_pem,
                "validFor": credentials.certificate_validity_remaining}
    logical = servers.get_fastest_in_country("UK" if request["country"] == "GB" else request["country"])
    physical = logical.get_random_physical_server()
    return {"country": ("GB" if logical.exit_country == "UK" else logical.exit_country), "server": logical.name,
            "endpoint": physical.entry_ip, "port": session.client_config.wireguard_ports.udp[0],
            "publicKey": physical.x25519_pk, "privateKey": credentials.wg_private_key,
            "domain": physical.domain, "bouncing": physical.label,
            "agentKey": credentials.get_ed25519_sk_pem(), "certificate": credentials.certificate_pem,
            "validFor": credentials.certificate_validity_remaining,
            "maxConnections": session.vpn_account.max_connections}


if __name__ == "__main__":
    if len(sys.argv)>1 and sys.argv[1]=="setup":
        sys.exit(subprocess.call(["protonvpn", "signin", input("Proton username: ").strip()]))
    try:
        print(json.dumps({"ok":True,"result":asyncio.run(run(json.load(sys.stdin)))}))
    except Exception as exc:
        # Provider exceptions can include HTTP bodies. Do not expose them to agents.
        print(json.dumps({"ok":False,"code":"proton_login_required" if "proton_login_required" in str(exc) else "proton_provider_error", "errorType":type(exc).__name__}))
        sys.exit(1)
