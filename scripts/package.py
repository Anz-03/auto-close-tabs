"""Build an upload ZIP using only extension runtime files (Python 3 stdlib)."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parent.parent
manifest = json.loads((root / "manifest.json").read_text())
files = ["manifest.json", "background.js", "manager.js", "policy.js",
         "popup.html", "popup.css", "popup.js"]
files += [f"icons/icon-{size}.png" for size in (16, 32, 48, 128)]
output = root / "release" / f"auto-close-tabs-{manifest['version']}-edge.zip"
output.parent.mkdir(exist_ok=True)
with ZipFile(output, "w", ZIP_DEFLATED) as archive:
    for name in files:
        archive.write(root / name, name)
with ZipFile(output) as archive:
    assert archive.testzip() is None
    assert "manifest.json" in archive.namelist()
print(output)
