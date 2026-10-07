#!/usr/bin/python3
"""Root helper: fixed namespace operations, no shell or arbitrary command API.
Install a root-owned configuration at /etc/camofox-agent.json and this script at
/usr/local/libexec/camofox-netns. Caller must match the configured desktop UID.
"""
import base64
import ipaddress
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile

CFG = pathlib.Path('/etc/camofox-agent.json')
def command(*args, **kw):
    return subprocess.run(args,check=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,**kw)

def namespace_exists(namespace):
    return any(line.split()[0] == namespace for line in
               command('ip', 'netns', 'list').stdout.decode().splitlines() if line.strip())

def tunnel_links(namespace):
    return json.loads(command('ip', '-n', namespace, '-j', 'link', 'show').stdout)

def stop_namespace(namespace, delete=False):
    # Absence is an idempotent success; a failed inspection is not absence.
    if not namespace_exists(namespace):
        return
    links = tunnel_links(namespace)
    if any(link.get('ifname') == 'wg0' for link in links):
        command('ip', '-n', namespace, 'link', 'set', 'wg0', 'down')
        if any(link.get('ifname') == 'wg0' and 'UP' in link.get('flags', [])
               for link in tunnel_links(namespace)):
            raise RuntimeError('Tunnel remains up after block')
    if delete:
        command('ip', 'netns', 'del', namespace)
        if namespace_exists(namespace):
            raise RuntimeError('Namespace remains after deletion')

def main():
    cfg=json.loads(CFG.read_text())
    uid=int(cfg['uid']);gid=int(cfg['gid'])
    if os.geteuid()!=0 or int(os.environ.get('SUDO_UID','-1'))!=uid:
        raise ValueError('Unauthorized helper caller')
    action,namespace=sys.argv[1:3]
    if not re.fullmatch(r'cf-'+str(uid)+r'-[a-f0-9]{12}',namespace):
        raise ValueError('Invalid namespace')
    dns=pathlib.Path('/etc/netns')/namespace
    if action=='create':
        p=json.load(sys.stdin)
        endpoint=ipaddress.ip_address(p['endpoint'])
        if endpoint.version!=4 or not endpoint.is_global: raise ValueError('Invalid endpoint')
        for key in ['publicKey','privateKey']:
            if len(base64.b64decode(p[key],validate=True))!=32:raise ValueError('Invalid WireGuard key')
        port=int(p['port'])
        if not 1<=port<=65535:raise ValueError('Invalid port')
        interface='wg'+namespace[-10:]
        command('ip','netns','add',namespace)
        try:
            command('ip','link','add',interface,'type','wireguard')
            keydir=pathlib.Path('/etc/wireguard/camofox')
            keydir.mkdir(parents=True,exist_ok=True,mode=0o700)
            with tempfile.NamedTemporaryFile(mode='w',dir=keydir) as private:
                private.write(p['privateKey']);private.flush()
                command('wg','set',interface,'private-key',private.name,'peer',p['publicKey'],'endpoint',f'{endpoint}:{port}','allowed-ips','0.0.0.0/0','persistent-keepalive','25')
            # The UDP socket stays in the host namespace; cleartext has only wg0.
            command('ip','link','set',interface,'netns',namespace)
            command('ip','-n',namespace,'link','set',interface,'name','wg0')
            command('ip','-n',namespace,'addr','add','10.2.0.2/32','dev','wg0')
            command('ip','-n',namespace,'link','set','lo','up')
            command('ip','netns','exec',namespace,'sysctl','-q','-w','net.ipv6.conf.all.disable_ipv6=1','net.ipv6.conf.default.disable_ipv6=1')
            command('ip','-n',namespace,'link','set','wg0','up')
            command('ip','-n',namespace,'route','add','default','dev','wg0')
            dns.mkdir(mode=0o755,parents=True,exist_ok=True)
            dns.chmod(0o755)
            (dns/'resolv.conf').write_text('nameserver 10.2.0.1\n')
            (dns/'resolv.conf').chmod(0o644)
            print(json.dumps({'namespace':namespace}))
        except Exception:
            subprocess.run(['ip','link','del',interface],capture_output=True)
            subprocess.run(['ip','netns','del',namespace],capture_output=True)
            raise
    elif action in ('block','down'):
        stop_namespace(namespace, delete=action == 'down')
        if action=='down':
            (dns/'resolv.conf').unlink(missing_ok=True)
            if dns.exists():dns.rmdir()
    elif action in ('worker','agent'):
        # ip netns exec supplies the namespace-specific resolver mount. setpriv
        # drops root and all supplemental groups before running any user code.
        prefix=['ip','netns','exec',namespace,'setpriv',f'--reuid={uid}',f'--regid={gid}','--clear-groups','--no-new-privs']
        if action=='agent':
            args=['/usr/bin/python3',cfg['agentScript']]
            env={'PATH':'/usr/bin:/bin','HOME':cfg['home']}
        else:
            profile,socket,session=sys.argv[3:6]
            p=pathlib.Path(profile).resolve();root=pathlib.Path(cfg['stateDir']).resolve()
            if p.parent!=root/'profiles' or not re.fullmatch(r'[a-f0-9-]{36}',p.name) or pathlib.Path(socket).parent.resolve()!=root or not re.fullmatch(r'[a-f0-9-]{36}',session):
                raise ValueError('Invalid worker paths')
            # Read only after dropping root by passing a node --env-file argument.
            env={'PATH':cfg['path'],'HOME':cfg['home']}
            args=['flock','-n','-F',str(p/'profile.lock'),cfg['node'],cfg['bootstrapScript'],str(p/'worker-env.json')]
        os.execvpe('ip',prefix+args,env)
    else:
        raise ValueError('Unknown helper operation')

if __name__=='__main__':
    try:main()
    except Exception as exc:
        print('Camofox namespace operation failed: '+type(exc).__name__,file=sys.stderr)
        if isinstance(exc, subprocess.CalledProcessError): print(exc.stderr.decode(errors='replace'),file=sys.stderr)
        sys.exit(1)
