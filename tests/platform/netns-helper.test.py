import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('helper', Path(__file__).resolve().parents[2] / 'scripts/platform/camofox-netns.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

class CleanupTests(unittest.TestCase):
    def run_case(self, *, present=True, interface=True, fail=None, stays_up=False, stays_present=False, delete=True):
        state = {'present':present, 'up':True}
        calls = []
        def run(args, **kwargs):
            calls.append(tuple(args))
            output = b''
            status = 1 if fail and fail(args) else 0
            if status and kwargs.get('check'):
                raise subprocess.CalledProcessError(status, args, stderr=b'fixture failure')
            if args == ('ip','netns','list'):
                output = b'cf-test\n' if state['present'] else b''
            elif args[-3:] == ('-j','link','show'):
                output = json.dumps([{'ifname':'wg0','flags':['UP'] if state['up'] else []}] if interface else []).encode()
            elif args[-3:] == ('set','wg0','down') and not status:
                state['up'] = stays_up
            elif args == ('ip','netns','del','cf-test') and not status:
                state['present'] = stays_present
            return subprocess.CompletedProcess(args,status,stdout=output,stderr=b'')
        with patch.object(helper.subprocess,'run',side_effect=run):
            helper.stop_namespace('cf-test',delete=delete)
        return calls,state

    def test_successful_delete_verifies_absence(self):
        calls,state=self.run_case()
        self.assertFalse(state['present']); self.assertFalse(state['up'])
        self.assertEqual(calls[-1],('ip','netns','list'))

    def test_block_checks_link_state_without_deleting_namespace(self):
        _,state=self.run_case(delete=False)
        self.assertTrue(state['present']);self.assertFalse(state['up'])

    def test_absence_is_idempotent(self):
        calls,_=self.run_case(present=False)
        self.assertEqual(calls,[('ip','netns','list')])

    def test_missing_interface_can_still_delete_namespace(self):
        _,state=self.run_case(interface=False);self.assertFalse(state['present'])

    def test_inspection_failure_is_not_absence(self):
        with self.assertRaises(subprocess.CalledProcessError): self.run_case(fail=lambda args:args==('ip','netns','list'))

    def test_block_failure_propagates(self):
        with self.assertRaises(subprocess.CalledProcessError): self.run_case(fail=lambda args:args[-1]=='down')

    def test_delete_failure_propagates(self):
        with self.assertRaises(subprocess.CalledProcessError): self.run_case(fail=lambda args:'del' in args)

    def test_zero_exit_without_required_postcondition_fails(self):
        with self.assertRaisesRegex(RuntimeError,'remains up'):self.run_case(stays_up=True)
        with self.assertRaisesRegex(RuntimeError,'remains after deletion'):self.run_case(stays_present=True)

class ViewerTests(unittest.TestCase):
    config = {'uid': 1000, 'gid': 1000, 'path': '/usr/bin:/bin',
              'node': '/fixed/node', 'viewerScript': '/fixed/viewer.mjs',
              'stateDir': '/private/state'}
    arguments = ['helper', 'viewer', 'cf-1000-012345abcdef',
                 '00000000-0000-4000-8000-000000000000', ':0', 'watch', 'a'*32]

    def invoke(self, args=None, config=None):
        with patch.object(helper.CFG.__class__, 'read_text', return_value=json.dumps(config or self.config)), \
             patch.object(helper.os, 'geteuid', return_value=0), \
             patch.dict(helper.os.environ, {'SUDO_UID': '1000'}), \
             patch.object(helper.sys, 'argv', args or self.arguments), \
             patch.object(helper.os, 'execvpe') as execute:
            helper.main()
            return execute.call_args

    def test_fixed_viewer_drops_root_and_uses_only_configured_paths(self):
        command, args, env = self.invoke().args
        self.assertEqual(command, 'ip')
        self.assertEqual(args[:8], ['ip','netns','exec','cf-1000-012345abcdef','setpriv',
                                    '--reuid=1000','--regid=1000','--clear-groups'])
        self.assertEqual(args[8:13], ['--no-new-privs','/fixed/node','/fixed/viewer.mjs',
                                     '/private/state',self.arguments[3]])
        self.assertEqual(env, {'PATH':'/usr/bin:/bin','XDG_SESSION_TYPE':'x11'})

    def test_rejects_extra_arguments_paths_modes_and_malformed_identifiers(self):
        for index,value in [(2,'other-namespace'),(3,'../../profile'),(4,':0 -auth /secret'),
                            (5,'shell'),(6,'../../socket')]:
            args = self.arguments.copy();args[index]=value
            with self.subTest(index=index), self.assertRaises(ValueError): self.invoke(args)
        with self.assertRaises(ValueError): self.invoke(self.arguments+['/arbitrary/command'])
        config = self.config.copy(); del config['viewerScript']
        with self.assertRaisesRegex(ValueError,'upgrade required'): self.invoke(config=config)

if __name__ == '__main__':unittest.main()
