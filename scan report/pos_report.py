"""
POS back-office "Sale Summary > Payments" screenshot -> payment lines.

Input is what Docling read off the screenshot (markdown text, optionally its
tables). Output:

    {
      "date": "2026-10-13",                              # day the report starts ('' if not read)
      "period": {"from": "2026-10-13T00:01", "to": "2026-10-13T23:59"},   # "For Period"; time part only if read
      "payments": [{"method": "Cash", "amount": 72.85}, ...],   # names exactly as printed, Total excluded
      "total": 561.64 | None,
      "sum_ok": True | False | None,                     # payments add up to Total (None: no Total)
      "warnings": ["..."],                               # e.g. payments do not add up to Total
      "fixed": None | {"method": "Total", "from": 398.51, "to": 998.51},
      "strategy": "position" | "rows" | "columns",
    }

Payment names are returned as printed. Mapping them to a system's own categories
(Uber Eat -> UberEats, Eftpos + Eftpos offline -> POS eftpos ...) is the calling
system's job, not this service's.

Strategies, in order: "position" (names paired with amounts by their coordinates on the
picture, needs `items` from the Docling engine; the only one immune to reading-order
mix-ups), "rows" (name and amount on one line / table row), "columns" (two separate
lists paired by order; always warned about because a swap keeps the sum right).

Reading quirks handled: '$' read as 'S', "1,782.62" read as "1.782.62", labels and
amounts coming out as separate columns instead of rows, and ONE look-alike digit
(8/9/3 ...) that makes the lines not add up to Total (fixed only when exactly one
change makes the sum right; otherwise numbers are left as read and sum_ok is False).
"""

import re

_DATE_RE = re.compile(r"\b(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})\b")
# optional "$" (or OCR's "S"), then digits with thousands separators, then exactly 2 decimals
_AMOUNT_RE = re.compile(r"^(-?)\s*[$S§]?\s*(\d[\d.,]*[.,]\d{2})$")
_LABEL_RE = re.compile(r"^[A-Za-z][A-Za-z .&'-]*$")
_HEADER_WORDS = {"payment", "amount", "sale summary", "staff summary", "customer summary", "payments",
                 "for period", "to", "drawer", "all", "show", "close"}


def _days_in_month(y: int, m: int) -> int:
    return [31, 29 if (y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)) else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]


def _dates(text: str) -> list[str]:
    out = []
    for d, m, y in _DATE_RE.findall(text):
        d, m, y = int(d), int(m), int(y)
        if 1 <= m <= 12 and 1 <= d <= _days_in_month(y, m):
            out.append(f"{y:04d}-{m:02d}-{d:02d}")
    return out


_PERIOD_RE = re.compile(r"(\d{1,2})[/.-](\d{1,2})[/.-](20\d{2})(?:\s+(\d{1,2}):(\d{2}))?")


def _period(text: str) -> list[str]:
    """'For Period 13/10/2026 00:01 To 13/10/2026 23:59' -> ['2026-10-13T00:01', '2026-10-13T23:59']"""
    out = []
    for d, m, y, hh, mm in _PERIOD_RE.findall(text):
        d, m, y = int(d), int(m), int(y)
        if not (1 <= m <= 12 and 1 <= d <= _days_in_month(y, m)):
            continue
        stamp = f"{y:04d}-{m:02d}-{d:02d}"
        if hh and int(hh) < 24 and int(mm) < 60:
            stamp += f"T{int(hh):02d}:{mm}"
        out.append(stamp)
    return out


def _cents(cell: str) -> int | None:
    m = _AMOUNT_RE.match(cell.strip())
    if not m:
        return None
    digits = re.sub(r"[.,]", "", m.group(2))
    return (-1 if m.group(1) == "-" else 1) * int(digits)


def _clean_label(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip(" |:*#-")


def _is_label(s: str) -> bool:
    s = _clean_label(s)
    return bool(s) and bool(_LABEL_RE.match(s)) and s.lower() not in _HEADER_WORDS


def _rows_strategy(markdown: str) -> list[tuple[str, int]]:
    """'| Cash | $72.85 |' or 'Cash $72.85' -> [('Cash', 7285), ...]"""
    out = []
    for raw in markdown.split("\n"):
        line = raw.strip().lstrip("#").strip()
        if not line or re.fullmatch(r"[\s|:\-]+", line) or "/" in line or ":" in line:
            continue
        if "|" in line:
            cells = [c.strip() for c in line.strip("|").split("|")]
            cells = [c for c in cells if c]
            if len(cells) < 2:
                continue
            amount = _cents(cells[-1])
            label = next((c for c in cells[:-1] if _is_label(c)), None)
        else:
            m = re.match(r"^(.*?)\s*(-?\s*[$S§]?\s*\d[\d.,]*[.,]\d{2})$", line)
            if not m:
                continue
            label, amount = (m.group(1) if _is_label(m.group(1)) else None), _cents(m.group(2))
        if label and amount is not None:
            out.append((_clean_label(label), amount))
    return out


def _columns_strategy(markdown: str) -> list[tuple[str, int]]:
    """Labels and amounts read as two separate runs (all names, then all amounts)."""
    labels, amounts = [], []
    for raw in markdown.split("\n"):
        line = raw.strip().lstrip("#").strip().strip("|").strip()
        if not line or "/" in line or ":" in line:
            continue
        if _cents(line) is not None:
            amounts.append(_cents(line))
        elif _is_label(line):
            labels.append(_clean_label(line))
    # the run of labels that ends with Total and is as long as the amounts
    for end in range(len(labels), 0, -1):
        if labels[end - 1].lower() != "total":
            continue
        start = end - len(amounts)
        if start >= 0:
            return list(zip(labels[start:end], amounts))
    return []


def _positioned_strategy(items: list[dict] | None) -> list[tuple[str, int]]:
    """
    Pair names with amounts by POSITION (same row = similar vertical centre, name to the
    left of the amount), so Docling's reading order does not matter.
    items: [{"text", "l", "r", "t", "b", "origin"}], origin 'BOTTOMLEFT' (y grows upward)
    or 'TOPLEFT'.
    """
    if not items:
        return []
    up = any(str(i.get("origin", "")).upper().startswith("BOTTOM") for i in items)
    rows = []  # (yc, left, right, height, text)
    for i in items:
        try:
            top, bottom = float(i["t"]), float(i["b"])
            rows.append(((top + bottom) / 2, float(i["l"]), float(i["r"]), abs(top - bottom), str(i["text"]).strip()))
        except (KeyError, TypeError, ValueError):
            continue
    labels, amounts, pairs = [], [], []
    for yc, l, r, h, text in rows:
        both = re.match(r"^(.*?)\s*(-?\s*[$S§]?\s*\d[\d.,]*[.,]\d{2})$", text)
        if both and _is_label(both.group(1)) and _cents(both.group(2)) is not None:
            pairs.append((yc, _clean_label(both.group(1)), _cents(both.group(2))))  # one item = one row
        elif _cents(text) is not None:
            amounts.append((yc, l, r, h, _cents(text)))
        elif _is_label(text):
            labels.append((yc, l, r, h, _clean_label(text)))
    if not pairs and (not labels or not amounts):
        return []
    heights = sorted(h for _, _, _, h, _ in rows if h > 0)
    tol = 0.8 * (heights[len(heights) // 2] if heights else 1)
    for yc, l, r, h, cents in amounts:
        left_of = [lab for lab in labels if lab[2] <= l + 1e-6 or lab[1] < l]  # label starts left of the amount
        if not left_of:
            continue
        best = min(left_of, key=lambda lab: abs(lab[0] - yc))
        if abs(best[0] - yc) <= tol:
            pairs.append((yc, best[4], cents))
    pairs.sort(key=lambda x: -x[0] if up else x[0])  # top of the picture first
    seen, out = set(), []
    for _, label, cents in pairs:
        key = (label, cents)
        if key in seen:
            continue
        seen.add(key)
        out.append((label, cents))
    return out


_CONFUSABLE = {"0": "8", "3": "89", "4": "9", "5": "6", "6": "58", "8": "039", "9": "834"}


def _repair(values: list[int], total: int) -> tuple[list[int], int, int | None]:
    """-> (values, total, index_changed) ; index -1 = Total. Only when exactly one fix works."""
    if sum(values) == total:
        return values, total, None
    found = {}
    items = list(enumerate(values)) + [(-1, total)]
    for idx, cents in items:
        if cents < 0:
            continue
        digits = str(cents)
        for p, ch in enumerate(digits):
            for rep in _CONFUSABLE.get(ch, ""):
                new = int(digits[:p] + rep + digits[p + 1:])
                new_sum = sum(values) if idx == -1 else sum(values) - cents + new
                new_total = new if idx == -1 else total
                if new_sum == new_total:
                    found[(idx, new)] = True
    if len(found) != 1:
        return values, total, None
    (idx, new), = found
    if idx == -1:
        return values, new, -1
    fixed = list(values)
    fixed[idx] = new
    return fixed, total, idx


def parse_pos_payment_report(markdown: str, tables: list | None = None, items: list | None = None) -> dict:
    dates = _dates(markdown)
    pairs, strategy = _positioned_strategy(items), "position"
    if not any(l.lower() == "total" for l, _ in pairs):
        pairs, strategy = _rows_strategy(markdown), "rows"
    if not any(l.lower() == "total" for l, _ in pairs):
        alt = _columns_strategy(markdown)
        if alt:
            pairs, strategy = alt, "columns"

    total = None
    lines = []
    for label, cents in pairs:
        if label.lower() == "total":
            total = cents
        else:
            lines.append([label, cents])

    fixed = None
    if total is not None and lines:
        values, new_total, idx = _repair([c for _, c in lines], total)
        if idx is not None:
            if idx == -1:
                fixed = {"method": "Total", "from": total / 100, "to": new_total / 100}
                total = new_total
            else:
                fixed = {"method": lines[idx][0], "from": lines[idx][1] / 100, "to": values[idx] / 100}
                lines[idx][1] = values[idx]

    sum_ok = None if total is None else sum(c for _, c in lines) == total
    warnings = []
    if total is None:
        warnings.append("No Total row was read, so the amounts could not be checked.")
    elif not sum_ok:
        warnings.append(
            f"Payments add up to {sum(c for _, c in lines) / 100:.2f} but Total reads {total / 100:.2f}; "
            "a number was probably misread."
        )
    if fixed:
        warnings.append(
            f"'{fixed['method']}' was read as {fixed['from']:.2f} and corrected to {fixed['to']:.2f} "
            "because that is the only single-digit change that makes the payments add up to Total."
        )
    if strategy == "columns":
        warnings.append(
            "Names and amounts were read as two separate lists and paired by reading order, "
            "not by position. The sum check cannot catch two swapped amounts: check each name against its amount."
        )
    stamps = _period(markdown)
    if not stamps:
        warnings.append("No 'For Period' date was read.")
    elif len(stamps) > 1 and stamps[0][:10] != stamps[1][:10]:
        warnings.append("The report period spans more than one day.")
    return {
        "date": dates[0] if dates else "",
        "period": {"from": stamps[0] if stamps else "", "to": stamps[1] if len(stamps) > 1 else (stamps[0] if stamps else "")},
        "payments": [{"method": l, "amount": c / 100} for l, c in lines],
        "total": None if total is None else total / 100,
        "sum_ok": sum_ok,
        "warnings": warnings,
        "fixed": fixed,
        "strategy": strategy,
    }
