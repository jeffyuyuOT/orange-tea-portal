import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Payroll 系統設置 › 分店管理 › 「更新並匯入公眾假期」: reads the Queensland
// Government's public-holiday table (https://www.qld.gov.au/recreation/travel/holidays/public)
// and returns every year that is fully published, as
//   { years: { "2027": [{date, name}, ...] }, ekka: { "2027": {date, name} }, latestYear, sourceUrl, fetchedAt, skipped: [...] }
//
// Why a function and not a direct call from the browser: qld.gov.au does not send
// CORS headers, so a browser cannot read it.
//
// Safety checks before a year is returned: every statewide row must have a date,
// each date's weekday must match the weekday written on the page, and Good Friday /
// Easter Sunday / Easter Monday must agree with the computed Easter date. A year
// that fails any check is listed in `skipped` and NOT returned, so a changed page
// layout can never silently push wrong dates into payroll.
//
// Christmas Eve is deliberately not returned: payroll handles the 6pm–midnight
// part-day itself (see splitChristmasEveShift in the payroll page).
//
// Auth: verify_jwt stays on, and the caller must be a developer (is_developer(),
// same boundary as Payroll / BK). No secrets needed.
const SOURCE_URL = "https://www.qld.gov.au/recreation/travel/holidays/public";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// --- parser begin
const MONTHS = ["january","february","march","april","may","june","july","august","september","october","november","december"];
const DAYS = ["sunday","monday","tuesday","wednesday","thursday","friday","saturday"];

// label regex -> canonical payroll name. Order matters ("good friday" must not match "the day after good friday").
const ROWS = [
  { key: "ny", re: /^new year/, name: "New Year's Day" },
  { key: "au", re: /^australia day/, name: "Australia Day" },
  { key: "gf", re: /^good friday/, name: "Good Friday" },
  { key: "dgf", re: /^(the )?day after good friday/, name: "Day after Good Friday" },
  { key: "es", re: /^easter sunday/, name: "Easter Sunday" },
  { key: "em", re: /^easter monday/, name: "Easter Monday" },
  { key: "anzac", re: /^anzac/, name: "Anzac Day" },
  { key: "lab", re: /^labour day/, name: "Labour Day" },
  { key: "ekka", re: /^royal queensland show/, name: "Royal Queensland Show (Ekka) - Brisbane" },
  { key: "kb", re: /^(king|queen)['’]?s birthday/, name: "King's Birthday" },
  { key: "ce", re: /^christmas eve/, name: "Christmas Eve" },
  { key: "cd", re: /^christmas day/, name: "Christmas Day" },
  { key: "bd", re: /^boxing day/, name: "Boxing Day" },
];
const REQUIRED = ["ny","au","gf","dgf","es","em","anzac","lab","kb","cd","bd"];

function decode(s: string): string {
  return s
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&(rsquo|lsquo|#8217|#8216|#39|apos);/gi, "'")
    .replace(/&ndash;|&mdash;|&#8211;|&#8212;/gi, "-")
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(Number(n)));
}
function cellText(html: string): string {
  return decode(html.replace(/<sup[\s\S]*?<\/sup>/gi, " ").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}
function pad(n: number): string { return String(n).padStart(2, "0"); }
function easter(y: number): string { // Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${y}-${pad(month)}-${pad(day)}`;
}
function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function weekday(iso: string): number { return new Date(iso + "T00:00:00Z").getUTCDay(); }

// "Saturday 1 January and Monday 3 January" -> ["2028-01-01","2028-01-03"]; throws if a written weekday disagrees with the date.
function datesInCell(text: string, year: number): string[] {
  const out: string[] = [];
  const re = new RegExp(`(?:\\b(${DAYS.map((d) => d.slice(0, 3)).join("|")})[a-z]*\\.?,?\\s+)?\\b(\\d{1,2})\\s+(${MONTHS.map((m) => m.slice(0, 3)).join("|")})[a-z]*`, "gi");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const day = Number(m[2]), mon = MONTHS.findIndex((x) => x.slice(0, 3) === m![3].toLowerCase().slice(0, 3));
    if (mon < 0 || day < 1 || day > 31) continue;
    const iso = `${year}-${pad(mon + 1)}-${pad(day)}`;
    if (new Date(iso + "T00:00:00Z").getUTCMonth() !== mon) throw new Error(`invalid date "${m[0]}" in ${year}`);
    if (m[1] && DAYS[weekday(iso)].slice(0, 3) !== m[1].toLowerCase().slice(0, 3)) {
      throw new Error(`weekday mismatch: "${m[0]}" is not a ${m[1]} in ${year}`);
    }
    out.push(iso);
  }
  return out;
}

export function parseQldHolidays(html: string) {
  const tables = html.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const table = tables.find((t) => /royal queensland show/i.test(t) && /boxing day/i.test(t));
  if (!table) throw new Error("holiday table not found on the page");
  const rows = (table.match(/<tr[\s\S]*?<\/tr>/gi) ?? []).map((tr) =>
    [...tr.matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => cellText(c[1]))
  );
  const header = rows.find((r) => r.filter((c) => /^20\d\d$/.test(c)).length >= 1);
  if (!header) throw new Error("year header row not found");
  const yearCols: { col: number; year: number }[] = [];
  header.forEach((c, i) => { if (/^20\d\d$/.test(c)) yearCols.push({ col: i, year: Number(c) }); });

  const byKey: Record<string, string[]> = {};
  for (const r of rows) {
    const label = (r[0] ?? "").toLowerCase().replace(/\s*\(.*$/, "").replace(/\s*\d+$/, "").trim();
    const def = ROWS.find((x) => x.re.test(label));
    if (def) byKey[def.key] = r;
  }
  const years: Record<string, { date: string; name: string }[]> = {};
  const ekka: Record<string, { date: string; name: string }> = {};
  const skipped: { year: number; reason: string }[] = [];
  for (const { col, year } of yearCols) {
    try {
      const got: Record<string, string[]> = {};
      for (const def of ROWS) {
        const row = byKey[def.key];
        if (!row || row[col] === undefined) { got[def.key] = []; continue; }
        got[def.key] = datesInCell(row[col], year);
      }
      for (const k of REQUIRED) if (!got[k]?.length) throw new Error(`no date for ${ROWS.find((x) => x.key === k)!.name}`);
      const es = easter(year);
      if (got.es[0] !== es || got.gf[0] !== addDays(es, -2) || got.dgf[0] !== addDays(es, -1) || got.em[0] !== addDays(es, 1)) {
        throw new Error("Easter dates do not match the computed Easter");
      }
      const list: { date: string; name: string }[] = [];
      for (const def of ROWS) {
        if (def.key === "ekka" || def.key === "ce") continue;
        got[def.key].forEach((d, i) => list.push({ date: d, name: i === 0 ? def.name : `${def.name} (additional)` }));
      }
      list.sort((a, b) => (a.date < b.date ? -1 : 1));
      years[String(year)] = list;
      if (got.ekka?.length) {
        if (weekday(got.ekka[0]) !== 3) throw new Error("Ekka date is not a Wednesday");
        ekka[String(year)] = { date: got.ekka[0], name: "Royal Queensland Show (Ekka) - Brisbane" };
      }
    } catch (e) {
      skipped.push({ year, reason: String((e as Error).message ?? e) });
    }
  }
  const ys = Object.keys(years).map(Number).sort((a, b) => a - b);
  if (!ys.length) throw new Error("no fully published year could be read: " + JSON.stringify(skipped));
  return { years, ekka, latestYear: ys[ys.length - 1], skipped };
}
// --- parser end

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: isDev, error: devErr } = await supabase.rpc("is_developer");
    if (devErr || isDev !== true) return json({ error: "Developer only" }, 403);

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20_000);
    let resp: Response;
    try {
      resp = await fetch(SOURCE_URL, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OT-Portal payroll holiday update)", Accept: "text/html" },
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) return json({ error: `qld.gov.au returned HTTP ${resp.status}` }, 502);
    const html = await resp.text();
    let parsed;
    try {
      parsed = parseQldHolidays(html);
    } catch (e) {
      return json({ error: `Could not read the holiday table: ${(e as Error).message}` }, 502);
    }
    return json({ ...parsed, sourceUrl: SOURCE_URL, fetchedAt: new Date().toISOString() });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
