#!/usr/bin/python3
"""Runs inside one tunnel namespace as the desktop user, with secrets on stdin."""
import asyncio
import json
import sys
from proton.vpn.platform.local_agent import Listener, AgentFeatures, State

async def main():
    args=json.load(sys.stdin)
    failed=asyncio.Event()
    def status(value):
        if value.state == State.CONNECTED:
            print(json.dumps({"ready":True, "country":value.connection_details.device_country if value.connection_details else None, "ip":value.connection_details.device_ip if value.connection_details else None}),flush=True)
        else:
            failed.set()
    def error(_value):
        failed.set()
    listener=await Listener.connect(args['domain'],args['agentKey'],args['certificate'])
    task=listener.listen(status,error)
    await listener.request_features(AgentFeatures(bouncing=args.get('bouncing') or None))
    waiter=asyncio.create_task(failed.wait())
    await asyncio.wait([task,waiter],return_when=asyncio.FIRST_COMPLETED)
    task.cancel();waiter.cancel()
    raise RuntimeError('Proton local-agent connection ended')
try:
    asyncio.run(main())
except Exception:
    print(json.dumps({"ready":False,"code":"proton_agent_disconnected"}),flush=True)
    sys.exit(1)
