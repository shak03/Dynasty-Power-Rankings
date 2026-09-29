// Vercel serverless function. Keeps your Anthropic API key hidden on the server.
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) { res.status(500).json({ error: "Missing ANTHROPIC_API_KEY environment variable" }); return; }
  const model = process.env.BLURB_MODEL || "claude-haiku-4-5";
  const standings = (req.body && req.body.standings) || [];

  const prompt = [
    "You are writing weekly fantasy football power-ranking blurbs for a 10-team dynasty league that lives for trash talk.",
    "",
    "VOICE: energy escalates down the list. Top teams get genuine hype (ESPN-analyst 'buy stock now' energy). Middle teams get wry, teasing takes. Bottom teams get playful roasts: funny, never cruel, PG-13, no profanity, no slurs.",
    "",
    "WHAT EACH BLURB IS ABOUT: the TEAM, not one player. Build it from the team's story: this week's result (thisWeek), record, all-play %, and movement.",
    "",
    "CREDITING PLAYERS (keyScorers, cumulative over the window stated):",
    "- If scoringStyle is 'balanced', credit two or more of the keyScorers. A balanced attack is the story.",
    "- If scoringStyle is 'one standout', name that player once, but keep the team as the subject.",
    "- Mention each player at most once. Player totals are over multiple weeks, not one game, so describe them that way (e.g. 'over the last three weeks') or just call them hot.",
    "",
    "NEVER: mention the bench, depth, roster spots, 'supporting cast', or what percentage of the team's scoring a player accounts for; imply the other players are bad or that one player is 'carrying' everyone; invent or compute numbers. Quote numbers exactly as given.",
    "",
    "LENGTH: 2 punchy sentences per blurb.",
    "",
    "Ranking JSON:",
    JSON.stringify(standings),
    "",
    'Respond with ONLY a JSON object mapping each rank (as a string) to its blurb string. No markdown, no code fences, no commentary. Example: {"1":"...","2":"..."}',
  ].join("\n");

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: "user", content: prompt }] }),
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
