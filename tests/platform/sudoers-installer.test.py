import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installer', Path(__file__).resolve().parents[2] / 'scripts/install-agent-sudoers.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def test_rule_is_valid_and_scoped_to_one_helper(self):
        rule = installer.rule_for('jack')
        self.assertEqual(rule.splitlines()[-1], 'jack ALL=(root) NOPASSWD: /usr/local/libexec/camofox-netns')
        with tempfile.NamedTemporaryFile(mode='w') as file:
            file.write(rule)
            file.flush()
            subprocess.run([installer.VISUDO, '-cf', file.name], check=True, capture_output=True)
        for name in ['jack ALL=(ALL) ALL', 'root\nALL', '#0', '']:
            with self.assertRaises(ValueError): installer.rule_for(name)

    def test_install_is_atomic_and_repeatable_and_preserves_other_policy(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(installer, 'root_file'), patch.object(installer.subprocess, 'run') as run:
            destination = Path(directory) / 'zz-camofox-agent'
            unrelated = Path(directory) / 'existing-policy'
            unrelated.write_text('unchanged')
            for _ in range(2): installer.install_rule(installer.rule_for('jack'), destination)
            self.assertEqual(destination.read_text(), installer.rule_for('jack'))
            self.assertEqual(destination.stat().st_mode & 0o777, 0o440)
            self.assertEqual(unrelated.read_text(), 'unchanged')
            self.assertEqual(run.call_count, 6)

    def test_failed_validation_preserves_previous_policy_and_removes_temporary_files(self):
        for previous in [None, installer.rule_for('other')]:
            for failure_at in [1, 2, 3]:
                with self.subTest(previous=previous, failure_at=failure_at), tempfile.TemporaryDirectory() as directory, patch.object(installer, 'root_file'):
                    destination = Path(directory) / 'zz-camofox-agent'
                    if previous: destination.write_text(previous)
                    effects = [None] * (failure_at - 1) + [subprocess.CalledProcessError(1, 'visudo')]
                    with patch.object(installer.subprocess, 'run', side_effect=effects), self.assertRaises(subprocess.CalledProcessError):
                        installer.install_rule(installer.rule_for('jack'), destination)
                    self.assertEqual(destination.read_text() if destination.exists() else None, previous)
                    self.assertEqual(list(Path(directory).glob('.camofox-agent-*')), [])

    def test_unmanaged_policy_and_symlinks_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / 'zz-camofox-agent'
            destination.write_text('unmanaged')
            with patch.object(installer, 'root_file'), self.assertRaisesRegex(ValueError, 'unmanaged'):
                installer.install_rule(installer.rule_for('jack'), destination)
            link = Path(directory) / 'link'
            link.symlink_to(destination)
            with self.assertRaisesRegex(ValueError, 'root-owned regular file'): installer.root_file(link)


if __name__ == '__main__': unittest.main()
