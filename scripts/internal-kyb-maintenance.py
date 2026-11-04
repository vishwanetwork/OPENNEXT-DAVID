"""Run a fixed, read-only inspection inside the authorized production container."""
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import shlex
import time
import urllib.parse

import websocket

HOST = os.environ['ONEPANEL_HOST'].rstrip('/')
KEY = os.environ['ONEPANEL_API_KEY']
assert urllib.parse.urlsplit(HOST).hostname == '18.188.54.73'
assert urllib.parse.urlsplit(HOST).port == 37414
assert KEY
START, END = 'OPENNEXT_KYB_RESULT_START', 'OPENNEXT_KYB_RESULT_END'


def main():
    timestamp = str(int(time.time()))
    token = hashlib.md5(('1panel' + KEY + timestamp).encode()).hexdigest()
    query = urllib.parse.urlencode(dict(source='container', containerid='opennext-homepage',
                                       command='/bin/sh', user='root', cols=240, rows=50))
    url = HOST.replace('http://', 'ws://', 1).replace('https://', 'wss://', 1)
    url += '/api/v2/hosts/terminal/container?' + query
    source = Path(__file__).with_name('internal-kyb-inspect.py').read_bytes()
    payload = 'import base64,gzip;exec(gzip.decompress(base64.b64decode(' + repr(base64.b64encode(gzip.compress(source)).decode()) + ')))'
    command = '/opt/spotbot/bin/python -c ' + shlex.quote(payload) + '\r'
    assert len(command.encode()) < 3500, 'Terminal command exceeds its input budget'
    print(json.dumps({'event': 'terminal_connecting'}), flush=True)
    # Raw auth files, environment variables and credentials remain on the production host.
    ws = websocket.create_connection(url, timeout=20, header={
        '1Panel-Token': token, '1Panel-Timestamp': timestamp}, origin=HOST)
    print(json.dumps({'event': 'terminal_connected'}), flush=True)
    try:
        ws.send(json.dumps(dict(type='cmd', data=base64.b64encode(command.encode()).decode())))
        output = ''
        deadline = time.monotonic() + 60
        while time.monotonic() < deadline:
            message = ws.recv()
            if not message:
                raise RuntimeError('Production terminal closed before returning a result')
            value = json.loads(message)
            if value.get('type') != 'cmd':
                continue
            output += base64.b64decode(value.get('data', '')).decode(errors='replace')
            if START in output and END in output.split(START, 1)[1]:
                result = json.loads(output.split(START, 1)[1].split(END, 1)[0])
                if result.get('event') != 'production_kyb_inspection':
                    print(json.dumps({'event': 'guest_inspection_failed', 'errorType': result.get('errorType')}), flush=True)
                    raise RuntimeError('Production inspection failed')
                assert {row['email'] for row in result['accounts']} == {
                    'harry@vishwalab.com', 'david.lee@vishwalab.com', 'evan@vishwanetwork.xyz'}
                print(json.dumps(result), flush=True)
                ws.send(json.dumps(dict(type='cmd', data=base64.b64encode(b'exit\r').decode())))
                return
        raise TimeoutError('Production inspection exceeded its deadline')
    finally:
        ws.close()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        # Do not expose handshake responses, shell output or request headers in CI logs.
        print(json.dumps({'event': 'maintenance_failed', 'errorType': type(exc).__name__}), flush=True)
        raise SystemExit(1)
