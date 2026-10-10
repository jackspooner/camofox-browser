#!/usr/bin/python3
"""Install only the existing, root-owned Camofox helper's noninteractive grant."""
import json
import os
from pathlib import Path
import pwd
import re
import stat
import subprocess
import tempfile

CONFIG = Path('/etc/camofox-agent.json')
HELPER = Path('/usr/local/libexec/camofox-netns')
DESTINATION = Path('/etc/sudoers.d/zz-camofox-agent')
VISUDO = '/usr/sbin/visudo'
HEADER = '# Managed by Camofox install-agent-sudoers.py; grants only the validated namespace helper.\n'


def root_file(path):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError(f'{path} must be a root-owned regular file, not writable by group/others')


def rule_for(username):
    if not re.fullmatch(r'[a-z_][a-z0-9_-]*\$?', username):
        raise ValueError('Unsupported sudoers username')
    # Arguments remain constrained by the installed helper's UID/operation checks.
    return HEADER + f'{username} ALL=(root) NOPASSWD: {HELPER}\n'


def install_rule(rule, destination=DESTINATION):
    previous = None
    if destination.exists() or destination.is_symlink():
        root_file(destination)
        previous = destination.read_text()
        if not previous.startswith(HEADER):
            raise ValueError(f'Refusing to overwrite unmanaged policy at {destination}')
    subprocess.run([VISUDO, '-c'], check=True)
    # Dotted temporary names are ignored by sudoers includedir processing.
    with tempfile.NamedTemporaryFile(mode='w', dir=destination.parent, prefix='.camofox-agent-', delete=False) as output:
        temporary = Path(output.name)
        output.write(rule)
        output.flush()
        os.fchmod(output.fileno(), 0o440)
    try:
        subprocess.run([VISUDO, '-cf', str(temporary)], check=True)
        os.replace(temporary, destination)
        try:
            subprocess.run([VISUDO, '-c'], check=True)
        except Exception:
            if previous is None:
                destination.unlink()
            else:
                temporary.write_text(previous)
                temporary.chmod(0o440)
                os.replace(temporary, destination)
            raise
    finally:
        temporary.unlink(missing_ok=True)


def main():
    if os.geteuid() != 0:
        raise ValueError('Run sudo python3 scripts/install-agent-sudoers.py in your terminal')
    root_file(CONFIG)
    root_file(HELPER)
    if not os.access(HELPER, os.X_OK):
        raise ValueError('Install the executable Camofox namespace helper first')
    uid = int(json.loads(CONFIG.read_text())['uid'])
    if uid <= 0 or ('SUDO_UID' in os.environ and int(os.environ['SUDO_UID']) not in (0, uid)):
        raise ValueError('Run as the configured Camofox desktop user or root')
    username = pwd.getpwuid(uid).pw_name
    install_rule(rule_for(username))
    print(f'Installed scoped noninteractive helper access for {username}. No service restart or route change performed.')


if __name__ == '__main__':
    main()
