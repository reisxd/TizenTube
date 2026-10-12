"""Build an unsigned TizenTube diagnostics .wgt from a released TizenTubeOld.wgt.

The result keeps the release's package/app/service IDs and its unmodified service bundle
(service/dist/index.js), but swaps in diag/index.html as the UI and points the service at
diag/service/diag.js, which instruments startup and then loads the real bundle.

Usage: python build_diag.py <TizenTubeOld.wgt> <out.wgt>
Sign and install the output with Apps2Samsung (Samsung certificate + partner signing).
"""
import sys
import zipfile
from pathlib import Path

HERE = Path(__file__).parent
KEEP = ('config.xml', 'icon.png', 'icon_16b9.png', 'service/dist/index.js')


def main(src, dst):
    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(dst, 'w', zipfile.ZIP_DEFLATED) as zout:
        config = zin.read('config.xml').decode('utf-8')
        if 'src="service/dist/index.js"' not in config:
            sys.exit('config.xml has no service/dist/index.js service entry; is this TizenTubeOld.wgt?')
        config = config.replace('src="service/dist/index.js"', 'src="service/diag.js"')
        # The UI reads the service's log from the package data folder ("wgt-private").
        config = config.replace(
            '<tizen:profile',
            '<tizen:privilege name="http://tizen.org/privilege/filesystem.read"></tizen:privilege>\n'
            '    <tizen:privilege name="http://tizen.org/privilege/filesystem.write"></tizen:privilege>\n'
            '    <tizen:profile', 1)
        for name in KEEP:
            data = config.encode('utf-8') if name == 'config.xml' else zin.read(name)
            zout.writestr(name, data)
        zout.write(HERE / 'index.html', 'index.html')
        zout.write(HERE / 'service' / 'diag.js', 'service/diag.js')
    print(f'wrote {dst}')


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
