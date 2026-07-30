"""Inline every ASSET: reference in docs/journey.src.html -> self-contained journey.html."""
import base64
import mimetypes
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "docs" / "journey.src.html"
DST = ROOT / "journey.html"


def data_uri(rel):
    p = (ROOT / rel).resolve()
    if not p.is_relative_to(ROOT):  # ASSET: paths are repo-relative, never escape it
        raise ValueError(f"asset outside repo: {rel}")
    mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    return f"data:{mime};base64," + base64.b64encode(p.read_bytes()).decode()


html = re.sub(r"ASSET:([^\"']+)", lambda m: data_uri(m.group(1)), SRC.read_text(encoding="utf-8"))
DST.write_text(html, encoding="utf-8")
print(f"{DST} {DST.stat().st_size / 1e6:.1f} MB")
