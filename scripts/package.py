"""Build a reproducible extension archive without personal files or test audio."""
from pathlib import Path
import json
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
version = json.loads((root / 'extension/manifest.json').read_text())['version']
output = root / 'dist' / f'qq-music-helper-v{version}.zip'
output.parent.mkdir(exist_ok=True)
files = [p for p in (root / 'extension').rglob('*') if p.is_file() and p.name != '.DS_Store']
files += [root / 'README.md', root / 'PRIVACY.md', root / 'THIRD_PARTY_NOTICES.md']
with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
    for path in sorted(files):
        info = ZipInfo(path.relative_to(root).as_posix(), date_time=(2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        info.external_attr = 0o100644 << 16
        archive.writestr(info, path.read_bytes())
with ZipFile(output) as archive:
    if archive.testzip() is not None:
        raise RuntimeError('Package integrity check failed')
print(output)
