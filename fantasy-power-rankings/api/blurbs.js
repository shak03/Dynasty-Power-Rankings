// Vercel serverless function. Keeps your Anthropic API key hidden on the server.
// Writes the blurbs, fact-checks each one, and asks for one rewrite of any that fail.
// Anything that still fails is left out, and the app shows an accurate auto-written line.

const RULES = [
  "You are writing weekly fantasy football power-ranking blurbs for a 10-team dynasty league that lives for trash talk.",
  "",
  "VOICE: energy escalates down the list. Top teams get genuine hype (ESPN-analyst 'buy stock now' energy). Middle teams get wry, teasing takes. Bottom teams get playful roasts: funny, never cruel, PG-13, no profanity, no slurs.",
  "",
  "SUBJECT: each blurb is about the TEAM. Refer to the manager by the `name` field. Build it from the team's story: thisWeek, record, all-play %, and movement.",
  "",
  "OTHER TEAMS: the ONLY other team a blurb may mention is that team's own opponent, named in its thisWeek field, using exactly that name. Never mention any other team or manager. Movement is about this team's own spot only; don't say it passed or jumped a specific team.",
  "",
  "PLAYERS:",
  "- thisWeekTopScorer is this week's game only. Use it when talking about this week's result.",
  "- keyScorers are totals over several weeks, not one game. Describe them that way (e.g. 'over the last three weeks') and never credit this week's result to them.",
  "- If scoringStyle is 'balanced', credit two or more keyScorers. If it's 'one standout', name that player once and keep the team as the subject.",
  "- Mention each player at most once.",
  "",
  "NEVER: mention the bench, depth, roster spots, the 'supporting cast', or the rest of the roster; say nobody/no one/everyone else; quote what percent of the scoring a player accounts for; imply the other players are bad.",
  "",
  "NUMBERS: only use numbers that appear in that team's own data, exactly as written. Don't calculate new ones.",
  "",
  "LENGTH: 2 punchy sentences per blurb.",
].join("\n");

const FORMAT =
  'Respond with ONLY a JSON object mapping each rank (as a string) to its blurb string. No markdown, no code fences, no commentary. Example: {"1":"...","2":"..."}';

const BANNED = [
  { re: /\bbench(ed|es)?\b/i, why: "mentions the bench" },
  { re: /\bdepth\b/i, why: "talks about depth" },
  { re: /supporting cast/i, why: "talks about the supporting cast" },
  { re: /\broster spots?\b/i, why: "talks about roster spots" },
  { re: /\brest of (the|his|her|their|your|this) (roster|team|lineup|squad|starters)\b/i, why: "talks about the rest of the roster" },
  { re: /\b(nobody|no one|no-one|everyone|everybody) else\b/i, why: "implies the other players are bad" },
  { re: /\bone[- ]man\b/i, why: "calls it a one-man team" },
  { re: /\d+(\.\d+)?\s*%\s*of\s+(the\s+|your\s+|their\s+|his\s+|this\s+)?(team'?s?\s+)?(starter\s+|starting\s+)?(scoring|output|points|production|offense)/i, why: "quotes a scoring-share percentage" },
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mentions = (text, name) =>
  !!name && name.length >= 3 && new RegExp(`(^|[^A-Za-z0-9])${escapeRe(name)}($|[^A-Za-z0-9])`, "i").test(text);
const strip = (text, names) =>
  names.filter(Boolean).reduce((t, n) => t.replace(new RegExp(escapeRe(n), "gi"), " "), text);

export function validate(blurb, m, allMeta, playerNames) {
  if (!blurb || typeof blurb !== "string") return ["missing"];
  const problems = [];
  const t = strip(blurb, playerNames); // "Josh Allen" shouldn't count as a manager named Josh

  const allowed = new Set([...m.ownNames, ...m.oppNames].map((x) => x.toLowerCase()));
  for (const other of allMeta) {
    if (other.rank === m.rank) continue;
    for (const nm of other.ownNames) {
      if (allowed.has(nm.toLowerCase())) continue;
      if (mentions(t, nm)) problems.push(`mentions ${nm}, who was not their opponent this week`);
    }
  }

  for (const b of BANNED) if (b.re.test(t)) problems.push(b.why);

  // Numbers: ignore digits inside names (Aidank2247, Shak03) and small counts/idioms.
  const tn = strip(t, allMeta.flatMap((o) => o.ownNames));
  const bad = (tn.match(/\d+(?:\.\d+)?/g) || []).filter((raw) => {
    const n = parseFloat(raw);
    if (!raw.includes(".") && n < 20) return false;
    return !m.numbers.some((a) => Math.abs(a - n) < 0.051 || Math.round(a) === n || Math.floor(a) === n);
  });
  if (bad.length) problems.push(`uses number(s) that aren't in its data: ${[...new Set(bad)].join(", ")}`);

  return [...new Set(problems)];
}

function parseBlurbs(data) {
  const text = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("").replace(/```json|```/g, "").trim();
  try { return JSON.parse(text); } catch (e) { return {}; }
}

async function ask(key, model, prompt) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model, max_tokens: 1600, temperature: 0.7, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(JSON.stringify(data));
  return parseBlurbs(data);
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "Missing ANTHROPIC_API_KEY environment variable" }); return; }
  const model = process.env.BLURB_MODEL || "claude-haiku-4-5";
  const { standings = [], meta = [], playerNames = [] } = req.body || {};
  const metaByRank = Object.fromEntries(meta.map((m) => [String(m.rank), m]));

  const check = (blurbs, ranks) =>
    ranks.map((rk) => ({ rk, problems: metaByRank[rk] ? validate(blurbs[rk], metaByRank[rk], meta, playerNames) : [] }))
      .filter((x) => x.problems.length);

  try {
    const blurbs = await ask(key, model, [RULES, "", "Ranking JSON:", JSON.stringify(standings), "", FORMAT].join("\n"));
    const allRanks = standings.map((s) => String(s.rank));
    let failures = check(blurbs, allRanks);

    if (failures.length) {
      const redo = failures.map((f) => standings.find((s) => String(s.rank) === f.rk));
      const notes = failures
        .map((f) => `Rank ${f.rk}: previous attempt "${blurbs[f.rk] || ""}" was rejected because it ${f.problems.join("; ")}.`)
        .join("\n");
      const retry = await ask(key, model, [
        RULES, "",
        "These blurbs broke the rules. Rewrite ONLY these ranks, fixing every problem listed:", notes, "",
        "Data for these teams:", JSON.stringify(redo), "", FORMAT,
      ].join("\n"));
      for (const f of failures) blurbs[f.rk] = retry[f.rk];
      failures = check(blurbs, failures.map((f) => f.rk));
      for (const f of failures) delete blurbs[f.rk]; // app fills these with an accurate auto-written line
    }

    res.status(200).json({ blurbs, replaced: failures.map((f) => ({ rank: f.rk, problems: f.problems })) });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
