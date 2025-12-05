#!/usr/bin/env python3
import sys
import pathlib
import re

if len(sys.argv) != 1 + 1:
    print(f"Usage: {sys.argv[0]} INPUT.html", file=sys.stderr)
    sys.exit(1)

inp = pathlib.Path(sys.argv[1])
html = inp.read_text(encoding="utf-8")


def is_ident_char(c: str) -> bool:
    """JS identifier-ish chars / digits."""
    return c.isalnum() or c in "_$"


def strip_js_comments_and_whitespace(code: str) -> str:
    """
    JS minifier:

    - Preserves all string contents exactly (', ", `).
    - Removes // and /* ... */ comments.
    - Collapses whitespace outside strings/comments.
      * Removes most spaces.
      * Keeps a single space between identifier-like tokens / numbers
        so 'foo bar' doesn't become 'foobar'.

    This is not a full JS parser, but is conservative enough for typical
    app code and far safer than blind regexes.
    """
    out = []
    i = 0
    n = len(code)

    in_single = False   # '
    in_double = False   # "
    in_backtick = False # `
    in_line_comment = False
    in_block_comment = False
    escaped = False

    last_out_char = ""  # last non-whitespace char written

    while i < n:
        c = code[i]

        # In line comment
        if in_line_comment:
            if c == "\n":
                in_line_comment = False
                out.append(c)
                last_out_char = c
            i += 1
            continue

        # In block comment
        if in_block_comment:
            if c == "*" and i + 1 < n and code[i + 1] == "/":
                in_block_comment = False
                i += 2
            else:
                i += 1
            continue

        # In string literal
        if in_single or in_double or in_backtick:
            out.append(c)
            if escaped:
                escaped = False
            else:
                if c == "\\":
                    escaped = True
                elif in_single and c == "'":
                    in_single = False
                elif in_double and c == '"':
                    in_double = False
                elif in_backtick and c == "`":
                    in_backtick = False
            last_out_char = c
            i += 1
            continue

        # Not in string/comment: handle possible comment starts
        if c == "/" and i + 1 < n:
            nxt = code[i + 1]
            if nxt == "/":
                in_line_comment = True
                i += 2
                continue
            elif nxt == "*":
                in_block_comment = True
                i += 2
                continue

        # String starts?
        if c == "'":
            in_single = True
            out.append(c)
            last_out_char = c
            i += 1
            continue
        elif c == '"':
            in_double = True
            out.append(c)
            last_out_char = c
            i += 1
            continue
        elif c == "`":
            in_backtick = True
            out.append(c)
            last_out_char = c
            i += 1
            continue

        # Whitespace outside strings/comments
        if c.isspace():
            # Collapse a run of whitespace
            j = i
            while j < n and code[j].isspace():
                j += 1

            # Find next non-whitespace char
            next_c = ""
            k = j
            while k < n and code[k].isspace():
                k += 1
            if k < n:
                next_c = code[k]

            # Decide whether we need a space
            if is_ident_char(last_out_char) and is_ident_char(next_c):
                # Keep a single space between identifier-like tokens
                out.append(" ")
                last_out_char = " "
            # else: drop whitespace entirely

            i = j
            continue

        # Normal non-whitespace, non-string, non-comment char
        out.append(c)
        last_out_char = c
        i += 1

    return "".join(out)


def minify_css(code: str) -> str:
    # Remove /* ... */ comments
    code = re.sub(r"/\*.*?\*/", "", code, flags=re.DOTALL)
    # Collapse whitespace
    code = re.sub(r"\s+", " ", code)
    # Remove spaces around punctuation
    code = re.sub(r"\s*([{}():;>,=+~])\s*", r"\1", code)
    # Remove unnecessary semicolons before }
    code = re.sub(r";\}", "}", code)
    return code.strip()


# 1) Strip HTML comments (but not inside script/style; we work on those separately)
html = re.sub(r"<!--(?!\[).*?-->", "", html, flags=re.DOTALL)

# 2) Minify JS in <script> blocks
script_re = re.compile(
    r"(<script\b[^>]*>)(.*?)(</script>)",
    flags=re.IGNORECASE | re.DOTALL,
)


def _minify_script(m: re.Match) -> str:
    start, code, end = m.groups()
    return start + strip_js_comments_and_whitespace(code) + end


html = script_re.sub(_minify_script, html)

# 3) Minify CSS in <style> blocks
style_re = re.compile(
    r"(<style\b[^>]*>)(.*?)(</style>)",
    flags=re.IGNORECASE | re.DOTALL,
)


def _minify_style(m: re.Match) -> str:
    start, code, end = m.groups()
    return start + minify_css(code) + end


html = style_re.sub(_minify_style, html)

# 4) Light HTML whitespace tightening outside script/style
#    (script/style already handled above)

# Collapse whitespace sequences
html = re.sub(r"\s+", " ", html)
# Remove spaces between tags
html = re.sub(r">\s+<", "><", html)
html = html.strip()

print(html)