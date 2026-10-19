import importlib.util
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('timeout_helper', Path(__file__).with_name('update-api-read-timeout.py'))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)

FIXTURE = b'''# location ^~ /api { proxy_read_timeout 1s; }\r
server {\r
    server_name evd.drenginyilmaz.net;\r
    location / { proxy_read_timeout 60s; }\r
    location ^~ /api {\r
        proxy_pass http://127.0.0.1:3000;\r
        add_header X-Example "braces { } # ;";\r
        proxy_read_timeout 60s; # keep this comment\r
        proxy_send_timeout 60s;\r
    }\r
}\r
'''


class TimeoutTests(unittest.TestCase):
    def test_exact_edit_and_idempotence(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'site.conf'
            config.write_bytes(FIXTURE)
            mode = stat.S_IMODE(config.stat().st_mode)
            self.assertTrue(helper.update(config))
            expected = FIXTURE.replace(b'proxy_read_timeout 60s; #', b'proxy_read_timeout 1800s; #')
            self.assertEqual(config.read_bytes(), expected)
            self.assertEqual(stat.S_IMODE(config.stat().st_mode), mode)
            before = config.stat().st_mtime_ns
            self.assertFalse(helper.update(config))
            self.assertEqual(config.stat().st_mtime_ns, before)

    def test_unknown_or_ambiguous_configs_are_unchanged(self):
        variants = [
            FIXTURE.replace(b'location ^~ /api {\r', b'location ^~ /api/ {\r'),
            FIXTURE + b'location ^~ /api { proxy_read_timeout 60s; }',
            FIXTURE.replace(b'60s; #', b'90s; #'),
            FIXTURE.replace(b'proxy_read_timeout 60s; #', b'#'),
            FIXTURE.replace(b'60s; #', b'60s; proxy_read_timeout 60s; #'),
            FIXTURE.replace(b'60s; #', b'60s extra; #'),
            FIXTURE[:-3],
        ]
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'site.conf'
            for value in variants:
                with self.subTest(value=value):
                    config.write_bytes(value)
                    with self.assertRaises(ValueError):
                        helper.update(config)
                    self.assertEqual(config.read_bytes(), value)
            self.assertEqual(list(Path(directory).iterdir()), [config])

    def test_atomic_replace_failure_preserves_original(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'site.conf'
            config.write_bytes(FIXTURE)
            with patch.object(helper.os, 'replace', side_effect=OSError('fixture failure')):
                with self.assertRaises(OSError):
                    helper.update(config)
            self.assertEqual(config.read_bytes(), FIXTURE)
            self.assertEqual(list(Path(directory).iterdir()), [config])

    @unittest.skipUnless(os.name == 'posix', 'Symlink creation requires privileges on Windows')
    def test_enabled_site_symlink_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / 'available.conf'
            config.write_bytes(FIXTURE)
            link = Path(directory) / 'enabled.conf'
            link.symlink_to(config)
            self.assertTrue(helper.update(link))
            self.assertTrue(link.is_symlink())
            self.assertIn(b'proxy_read_timeout 1800s;', config.read_bytes())


if __name__ == '__main__':
    unittest.main()
