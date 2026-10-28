"""Merge duplicate CSS rules (same selector list, same @layer/@media ancestry) in a file.

Run from the repository root:  python3 scripts/merge-duplicate-css.py <file.css>...

An earlier rule is folded into the last rule with the same selector list. The
earlier declarations are prepended, so the later rule's own declarations still
win. A merge is skipped when any rule between the two sets a related property on
an element that could also match:
  * the rightmost compounds share a class, or either side has no class
    (element/attribute-only selectors), or
  * the two classes appear together in any component className in src/.
Verify with scripts/visual-compare.mjs; the class analysis is a heuristic.
"""
import glob
import itertools
import re
import sys

GROUPS = [
    {"inset", "top", "right", "bottom", "left"},
    {"gap", "row", "column"},
    {"font", "line"},
    {"place", "align", "justify"},
    {"width", "height", "inline", "block", "min", "max", "aspect"},
]


def family(prop):
    prop = prop.strip().lower()
    if prop.startswith("--"):
        return prop
    head = re.sub(r"^-(webkit|moz|ms)-", "", prop).split("-")[0]
    for group in GROUPS:
        if head in group:
            return "|".join(sorted(group))
    return head


def strip_comments(text):
    return re.sub(r"/\*.*?\*/", "", text, flags=re.S)


def unwrap(selector):
    """Turn a CSS module selector into the plain selector it styles."""
    selector = re.sub(r":where\(\.scope\)\s*", "", selector.strip())
    out, i = "", 0
    while i < len(selector):
        if selector.startswith(":global(", i):
            depth, j = 1, i + len(":global(")
            while depth:
                depth += {"(": 1, ")": -1}.get(selector[j], 0)
                j += 1
            out += selector[i + len(":global(") : j - 1]
            i = j
        else:
            out += selector[i]
            i += 1
    return out.strip()


def split_top(text, sep=","):
    parts, depth, cur = [], 0, ""
    for ch in text:
        depth += {"(": 1, ")": -1}.get(ch, 0)
        if ch == sep and depth == 0:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
    parts.append(cur)
    return [p.strip() for p in parts if p.strip()]


def target(selector):
    """Classes and pseudo-element of the rightmost compound selector."""
    plain = unwrap(selector)
    compound = re.split(r"\s*[ >+~]\s*(?![^(]*\))", plain)[-1]
    pseudo = (re.findall(r"::?(?:before|after|placeholder|marker|selection|backdrop|-webkit-[\w-]+)", compound) or [""])[0]
    bare = re.sub(r"\((?:[^()]|\([^()]*\))*\)", "", compound)  # ignore :not(...)/:is(...) arguments
    return set(re.findall(r"\.([\w-]+)", bare)), pseudo.lstrip(":")


# Framework components that render one element carrying exactly the given classes.
PASS_THROUGH = {"Link": "a", "Image": "img"}
ELEMENT = re.compile(r"<([A-Za-z][\w.]*)\b((?:[^<>]|=>|\{[^{}]*\})*?)>")


def class_literals(attrs):
    tokens, prefixes = set(), set()
    for literal in re.findall(r"[\"'`]([^\"'`]*)[\"'`]", attrs):
        for token in re.findall(r"[a-z][a-z0-9-]*", literal):
            (prefixes if token.endswith("-") else tokens).add(token)
    return tokens, prefixes


def cooccurrence():
    """Class pairs rendered on the same element, dynamic class prefixes, and classes
    handed to components (which may add their own classes, so they pair with anything)."""
    pairs, prefixes, wild = set(), {}, set()
    files = glob.glob("src/**/*.tsx", recursive=True)
    # Classes used anywhere in the file that defines each component.
    internal = {}
    for path in files:
        source = open(path).read()
        own = set()
        for match in ELEMENT.finditer(source):
            own |= class_literals(match.group(2))[0]
        for name in re.findall(r"export (?:default )?(?:async )?function ([A-Z]\w*)", source):
            internal[name] = internal.get(name, set()) | own
    for path in files:
        for match in ELEMENT.finditer(open(path).read()):
            name, attrs = match.group(1), match.group(2)
            if "className" not in attrs:
                continue
            tokens, dynamic = class_literals(attrs)
            for prefix in dynamic:
                # A dynamic class such as `tone-${x}` sits only beside this element's classes.
                prefixes.setdefault(prefix, set()).update(tokens | dynamic)
            if not name[0].islower() and name not in PASS_THROUGH:
                inner = internal.get(name.split(".")[-1])
                if inner is None:
                    wild |= tokens  # unknown component: may combine with anything
                else:
                    pairs.update((min(a, b), max(a, b)) for a in tokens for b in inner if a != b)
            pairs.update(itertools.combinations(sorted(tokens), 2))
    return pairs, prefixes, wild


def class_tags():
    """HTML tag names each class is rendered on; None when any element is possible."""
    tags = {}
    for path in glob.glob("src/**/*.tsx", recursive=True):
        for match in ELEMENT.finditer(open(path).read()):
            name, attrs = match.group(1), match.group(2)
            if "className" not in attrs:
                continue
            # Components may render anything, except simple pass-through ones.
            tag = name if name[0].islower() else PASS_THROUGH.get(name)
            for token in class_literals(attrs)[0]:
                known = tags.setdefault(token, set())
                if known is None:
                    continue
                if tag is None:
                    tags[token] = None
                else:
                    known.add(tag)
    return tags


PAIRS, PREFIXES, WILD = cooccurrence()
TAGS = class_tags()


def tag_of(selector):
    compound = re.split(r"\s*[ >+~]\s*(?![^(]*\))", unwrap(selector))[-1]
    match = re.match(r"([a-z][a-z0-9]*)", compound)
    return match.group(1) if match else None


def tags_for(classes):
    """Tags the classes could be on, or None when unknown."""
    result = None
    for name in classes:
        known = TAGS.get(name)
        if not known:
            return None
        result = known if result is None else result & known
    return result


def together(a, b):
    if a in WILD or b in WILD or (min(a, b), max(a, b)) in PAIRS:
        return True
    for prefix, beside in PREFIXES.items():
        for x, y in ((a, b), (b, a)):
            if x.startswith(prefix) and (y in beside or any(y.startswith(q) for q in beside if q.endswith("-"))):
                return True
    return False


def specificity(selector):
    """(ids, classes/attributes/pseudo-classes, elements/pseudo-elements) per Selectors 4."""
    ids = classes = elements = 0
    i, text = 0, unwrap(selector)
    while i < len(text):
        c = text[i]
        if text.startswith("::", i):
            elements += 1
            i += 2
            while i < len(text) and (text[i].isalnum() or text[i] in "-_"):
                i += 1
            continue
        if c == ":":
            j = i + 1
            while j < len(text) and (text[j].isalnum() or text[j] in "-_"):
                j += 1
            name = text[i + 1 : j]
            if j < len(text) and text[j] == "(":
                depth, k = 1, j + 1
                while depth:
                    depth += {"(": 1, ")": -1}.get(text[k], 0)
                    k += 1
                inner = text[j + 1 : k - 1]
                if name in ("is", "not", "has"):
                    best = max((specificity(x) for x in split_top(inner)), default=(0, 0, 0))
                    ids, classes, elements = ids + best[0], classes + best[1], elements + best[2]
                elif name != "where":
                    classes += 1
                i = k
                continue
            if name in ("before", "after"):
                elements += 1
            else:
                classes += 1
            i = j
            continue
        if c == "#":
            ids += 1
        elif c in ".[":
            classes += 1
            if c == "[":
                i = text.index("]", i)
        elif (c.isalpha() or c == "*") and (i == 0 or text[i - 1] in " >+~("):
            if c != "*":
                elements += 1
            while i + 1 < len(text) and (text[i + 1].isalnum() or text[i + 1] in "-_"):
                i += 1
        i += 1
    return ids, classes, elements


def may_overlap(selector_a, selector_b):
    for a in split_top(selector_a):
        for b in split_top(selector_b):
            (ca, pa), (cb, pb) = target(a), target(b)
            # Source order only decides between equally specific selectors.
            if pa != pb or specificity(a) != specificity(b):
                continue
            if ca & cb:
                return True
            if not ca or not cb:
                # One side targets a bare tag: overlap only if the class side can be that tag.
                tag = tag_of(a) if not ca else tag_of(b)
                possible = tags_for(cb if not ca else ca)
                if tag is None or possible is None or tag in possible:
                    return True
                continue
            if any(together(x, y) for x in ca for y in cb):
                return True
    return False


def parse(text):
    rules, stack, i, seg = [], [], 0, 0
    while i < len(text):
        if text.startswith("/*", i):
            i = text.index("*/", i + 2) + 2
            continue
        c = text[i]
        if c in "\"'":
            j = i + 1
            while text[j] != c:
                j += 2 if text[j] == "\\" else 1
            i = j + 1
            continue
        if c == "{":
            stack.append((text[seg:i].strip(), seg, i + 1))
            seg = i + 1
        elif c == "}":
            header, hstart, bstart = stack.pop()
            if not header.startswith("@"):
                ancestry = tuple(re.sub(r"\s+", " ", strip_comments(h)) for h, _, _ in stack)
                rules.append((hstart, bstart, i, strip_comments(header).strip(), ancestry))
            seg = i + 1
        elif c == ";":
            seg = i + 1
        i += 1
    return rules


def declarations(body):
    out, depth, cur, quote = [], 0, "", None
    for ch in strip_comments(body):
        if quote:
            cur += ch
            quote = None if ch == quote else quote
            continue
        if ch in "\"'":
            quote = ch
        depth += {"(": 1, ")": -1}.get(ch, 0)
        if ch == ";" and depth == 0:
            out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    out.append(cur.strip())
    return [d for d in out if ":" in d]


def movable(text, rule, between):
    """True when no rule between the pair sets a related property on a possibly shared element."""
    families = {family(d.split(":", 1)[0]) for d in declarations(text[rule[1] : rule[2]])}
    for other in between:
        touched = {family(d.split(":", 1)[0]) for d in declarations(text[other[1] : other[2]])}
        if (touched & families or "all" in touched) and may_overlap(other[3], rule[3]):
            return False
    return True


def insert(text, body_start, body, decls, prepend):
    pad = (re.search(r"\n([ \t]*)\S", body) or re.match(r"()", "")).group(1) or "  "
    added = "".join(f"\n{pad}{d};" for d in decls)
    if prepend:
        return text[:body_start] + added + text[body_start:]
    end = body_start + len(body.rstrip())
    tail = "" if body.rstrip().endswith((";", "{")) or not body.strip() else ";"
    return text[:end] + tail + added + text[end:]


def remove(text, rule):
    start = rule[0]
    # Keep any comment that precedes the selector; it usually describes a section.
    header = text[rule[0] : rule[1]]
    if "*/" in header:
        start = rule[0] + header.rindex("*/") + 2
    while start > 0 and text[start - 1] in " \t":
        start -= 1
    if start > 0 and text[start - 1] == "\n":
        start -= 1
    return text[:start] + text[rule[2] + 1 :]


def merge_once(text):
    rules = parse(text)
    groups = {}
    for index, rule in enumerate(rules):
        if "{" in text[rule[1] : rule[2]]:
            continue
        key = (re.sub(r"\s+", " ", rule[3]), rule[4])
        groups.setdefault(key, []).append(index)
    for indexes in groups.values():
        for early_index, last_index in zip(indexes, indexes[1:]):
            early, last = rules[early_index], rules[last_index]
            between = [r for r in rules if early[2] < r[0] and r[2] < last[0]]
            if movable(text, early, between):
                # Fold the earlier rule down; the later rule's own declarations still win.
                moved = declarations(text[early[1] : early[2]])
                later = text[last[1] : last[2]]
                own = {d.split(":", 1)[0].strip() for d in declarations(later)}
                keep = [d for d in moved if d.split(":", 1)[0].strip() not in own]
                text = insert(text, last[1], later, keep, prepend=True)
                return remove(text, early), True
            if movable(text, last, between):
                # Fold the later rule up; append so it still overrides the earlier declarations.
                moved = declarations(text[last[1] : last[2]])
                body = text[early[1] : early[2]]
                text = remove(text, last)
                return insert(text, early[1], body, moved, prepend=False), True
    return text, False


def merge(path):
    text, count = open(path).read(), 0
    while True:
        text, changed = merge_once(text)
        if not changed:
            break
        count += 1
    open(path, "w").write(text)
    return count


if __name__ == "__main__":
    total = 0
    for path in sys.argv[1:]:
        count = merge(path)
        total += count
        if count:
            print(f"{path}: merged {count}")
    print(f"Merged {total} duplicate rules.")
