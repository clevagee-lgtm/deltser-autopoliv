"""Build the transferable, offline HTML from reviewable sources."""
from pathlib import Path
from json import dumps
import sys
root = Path(__file__).resolve().parents[1]
html = (root / "src/page.html").read_text()
for tag, path in [("STYLE","src/style.css"), ("RECOGNITION","src/recognition.js"), ("CONTOURS","src/contours.js"), ("CATALOG","src/catalog.js"), ("PLANNER","src/planner.js"), ("INPUT","src/input.js"), ("UI","src/app.js")]:
    html = html.replace("/*" + tag + "*/", (root/path).read_text() if (root/path).exists() else "")
html = html.replace("/*CSV*/", dumps((root/"data/mp-rotator.csv").read_text()))
out = Path(sys.argv[1]) if len(sys.argv)>1 else root/"dist/index.html"
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(html)
