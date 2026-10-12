"""Build the unsigned "TizenTube LAN" launcher .wgt for TVs without web.service.

It opens YouTube TV through standalone/service/proxy-host.js running on another machine.

Usage: python build_remote.py <proxy origin, e.g. http://192.168.10.20:8100> <out.wgt>
Sign and install the output with Apps2Samsung (Samsung certificate).
"""
import re
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).parent
STANDALONE = HERE.parent / 'standalone'


def main(origin, dst):
    origin = origin.rstrip('/')
    if not re.fullmatch(r'https?://[^/\s"]+', origin):
        sys.exit(f'not an origin: {origin}')
    index = (HERE / 'index.html').read_text(encoding='utf-8')
    assert '__PROXY_ORIGIN__' in index
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
        zout.write(HERE / 'config.xml', 'config.xml')
        zout.writestr('index.html', index.replace('__PROXY_ORIGIN__', origin))
        zout.write(STANDALONE / 'icon.png', 'icon.png')
        zout.write(STANDALONE / 'icon_16b9.png', 'icon_16b9.png')
    print(f'wrote {dst} (proxy {origin})')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
