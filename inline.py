#!/usr/bin/env python3
import sys
import pathlib
import re
import base64

if len(sys.argv) not in (2, 3):
    print(f"Usage: {sys.argv[0]} INPUT.html [OUTPUT.html]", file=sys.stderr)
    sys.exit(1)

src_path = pathlib.Path(sys.argv[1]).resolve()
if len(sys.argv) == 3:
    dst_path = pathlib.Path(sys.argv[2]).resolve()
else:
    dst_path = src_path  # in-place if only one arg

base_dir = src_path.parent
html = src_path.read_text(encoding="utf-8")

# ----------------------------------------------------------------------
# 1) Inline CSS: <link rel="stylesheet" href="style/main.css">
# ----------------------------------------------------------------------

def inline_css(match: re.Match) -> str:
    href = match.group("href")
    css_path = (base_dir / href).resolve()
    css = css_path.read_text(encoding="utf-8")
    return f"<style>\n{css}\n</style>"

css_re = re.compile(
    r'<link[^>]*\brel=["\']stylesheet["\'][^>]*\bhref=["\'](?P<href>[^"\']+)["\'][^>]*>',
    flags=re.IGNORECASE,
)

html = css_re.sub(inline_css, html)

# ----------------------------------------------------------------------
# 2) Inline JS: <script src="..."></script>
#    Preserve other attributes, just remove src and embed file contents.
# ----------------------------------------------------------------------

def inline_js(match: re.Match) -> str:
    before = match.group("before")  # e.g. "<script ..." (no closing ">")
    src = match.group("src")
    after = match.group("after")    # ">" plus any trailing attrs/whitespace
    close_tag = match.group("close_tag")  # "</script>"

    js_path = (base_dir / src).resolve()
    js = js_path.read_text(encoding="utf-8")

    # Rebuild opening tag without src=...
    opening = before + after
    opening_clean = re.sub(r'\s+src=["\'][^"\']+["\']', "", opening, flags=re.IGNORECASE)

    return f"{opening_clean}\n{js}\n{close_tag}"

script_re = re.compile(
    r'(?P<before><script[^>]*?)\s+src=["\'](?P<src>[^"\']+)["\'](?P<after>[^>]*>)(?P<close_tag>\s*</script>)',
    flags=re.IGNORECASE | re.DOTALL,
)

html = script_re.sub(inline_js, html)

# ----------------------------------------------------------------------
# 3) Inline favicon: <link rel="icon" href="favicon.svg" ...>
#    -> <link rel="icon" type="image/svg+xml"
#           href="data:image/svg+xml;base64,AAAA..." >
# ----------------------------------------------------------------------

def inline_icon(match: re.Match) -> str:
    href = match.group("href")
    icon_path = (base_dir / href).resolve()
    data = icon_path.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")

    # We deliberately throw away the old tag and emit a clean one.
    # No reuse of original quoting = no interference from SVG internals.
    return (
        '<link rel="icon" type="image/svg+xml" '
        f'href="data:image/svg+xml;base64,{b64}">'
    )

icon_re = re.compile(
    r'<link[^>]*\brel=["\']icon["\'][^>]*\bhref=["\'](?P<href>[^"\']+)["\'][^>]*>',
    flags=re.IGNORECASE,
)

html = icon_re.sub(inline_icon, html)

# ----------------------------------------------------------------------
# 4) Write result
# ----------------------------------------------------------------------

dst_path.parent.mkdir(parents=True, exist_ok=True)
dst_path.write_text(html, encoding="utf-8")