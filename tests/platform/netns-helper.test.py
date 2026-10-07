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

if __name__ == '__main__':unittest.main()
