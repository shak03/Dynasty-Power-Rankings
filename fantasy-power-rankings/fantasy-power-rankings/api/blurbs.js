// Vercel serverless function. Keeps your Anthropic API key hidden on the server.
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "Missing ANTHROPIC_API_KEY environment variable" }); return; }
  const model = process.env.BLURB_MODEL || "claude-haiku-4-5";
  const standings = (req.body && req.body.standings) || [];

  const prompt =
    "You are writing weekly fantasy football power-ranking blurbs for a 10-team dynasty league that lives for trash talk. " +
    "Voice: escalate ENERGY down the list. Top teams get genuine hype (ESPN-analyst 'buy stock now' energy). " +
    "Middle teams get wry, teasing takes. Bottom teams get playful roasts and dunks \u2014 funny, never cruel, PG-13, no profanity, no slurs. " +
    "Each blurb MUST name that team's hot player and lean on the real numbers provided. Keep each to 2 punchy sentences.\n\n" +
    "Ranking JSON:\n" + JSON.stringify(standings) +
    '\n\nRespond with ONLY a JSON object mapping each rank (as a string) to its blurb string. ' +
    'No markdown, no code fences, no commentary. Example: {"1":"...","2":"..."}';

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1200, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await r.json();
    if (!r.ok) { res.status(r.status).json({ error: data }); return; }
    const text = (data.content || []).map((b) => (b.type === "text" ? b.text : "")).join("").replace(/```json|```/g, "").trim();
    let blurbs = {};
    try { blurbs = JSON.parse(text); } catch (e) { blurbs = {}; }
    res.status(200).json({ blurbs });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
