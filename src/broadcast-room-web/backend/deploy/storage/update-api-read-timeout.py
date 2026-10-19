"""Narrow nginx config edit only; caller owns backup, nginx -t, rollback and reload."""

import argparse
import os
import re
import stat
import tempfile
from pathlib import Path


TOKEN = re.compile(rb'''\s+|\#[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[{};]|[^\s{};\#"']+''')


def updated_config(data):
    tokens = []
    offset = 0
    for match in TOKEN.finditer(data):
        if match.start() != offset:
            raise ValueError('Unsupported nginx syntax; refusing to edit')
        offset = match.end()
        value = match.group()
        if not value.isspace() and not value.startswith(b'#'):
            tokens.append((value, match.start(), match.end()))
    if offset != len(data):
        raise ValueError('Unsupported nginx syntax; refusing to edit')

    targets = []
    stack = []
    statement = []
    for token in tokens:
        value = token[0]
        if value == b'{':
            if not statement:
                raise ValueError('Missing block header')
            block = {'header': [item[0] for item in statement], 'directives': []}
            if block['header'] == [b'location', b'^~', b'/api']:
                targets.append(block)
            stack.append(block)
            statement = []
        elif value == b'}':
            if statement or not stack:
                raise ValueError('Malformed nginx block')
            stack.pop()
        elif value == b';':
            if not statement:
                raise ValueError('Empty nginx directive')
            if stack:
                stack[-1]['directives'].append(statement)
            statement = []
        else:
            statement.append(token)
    if stack or statement:
        raise ValueError('Incomplete nginx config')
    if len(targets) != 1:
        raise ValueError('Expected exactly one location ^~ /api block')
    directives = [items for items in targets[0]['directives'] if items[0][0] == b'proxy_read_timeout']
    if len(directives) != 1 or len(directives[0]) != 2:
        raise ValueError('Expected exactly one direct proxy_read_timeout value')
    value, start, end = directives[0][1]
    if value not in (b'60s', b'1800s'):
        raise ValueError('Expected proxy_read_timeout 60s or 1800s')
    return data[:start] + b'1800s' + data[end:]


def update(path):
    # sites-enabled commonly contains a symlink; retain it and edit its target.
    target = Path(path).resolve(strict=True)
    before = target.stat()
    if not stat.S_ISREG(before.st_mode):
        raise ValueError('Config must be a regular file')
    original = target.read_bytes()
    result = updated_config(original)
    if result == original:
        return False
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=target.parent, prefix='.' + target.name + '.', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(result)
            stream.flush()
            if os.name == 'posix':
                os.fchown(stream.fileno(), before.st_uid, before.st_gid)
            os.chmod(temporary, stat.S_IMODE(before.st_mode))
            os.fsync(stream.fileno())
        current = target.stat()
        if (current.st_ino, current.st_dev, current.st_mtime_ns, current.st_size) != (before.st_ino, before.st_dev, before.st_mtime_ns, before.st_size) or target.read_bytes() != original:
            raise ValueError('Config changed during edit; refusing to overwrite')
        os.replace(temporary, target)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('config_path', type=Path, help='Explicit nginx site config path')
    args = parser.parse_args()
    try:
        changed = update(args.config_path)
    except (OSError, ValueError) as error:
        parser.exit(1, f'Refused: {error}\n')
    print('Updated /api proxy_read_timeout to 1800s.' if changed else 'Already set to 1800s; unchanged.')


if __name__ == '__main__':
    main()
