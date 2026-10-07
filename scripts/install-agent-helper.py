#!/usr/bin/python3
"""Install the fixed root helper; run with sudo from the source checkout."""
import json
import os
import pathlib
import pwd
import shutil
root=pathlib.Path(__file__).resolve().parents[1]
uid=int(os.environ['SUDO_UID']); user=pwd.getpwuid(uid)
state=pathlib.Path(user.pw_dir)/'services/runtime/camofox-agent'
node=pathlib.Path(user.pw_dir)/'services/infrastructure/node/node-v24.21.0-linux-x64/bin/node'
config={'uid':uid,'gid':user.pw_gid,'home':user.pw_dir,'stateDir':str(state),'node':str(node),'serverScript':str(root/'server.js'),'bootstrapScript':str(root/'scripts/platform/worker-bootstrap.mjs'),'agentScript':str(root/'scripts/platform/proton-agent.py'),'path':str(node.parent)+':/usr/local/bin:/usr/bin:/bin'}
pathlib.Path('/etc/camofox-agent.json').write_text(json.dumps(config));os.chmod('/etc/camofox-agent.json',0o600)
pathlib.Path('/usr/local/libexec').mkdir(exist_ok=True)
shutil.copyfile(root/'scripts/platform/camofox-netns.py','/usr/local/libexec/camofox-netns');os.chmod('/usr/local/libexec/camofox-netns',0o755)
print('Installed fixed namespace helper. No host routes changed.')
