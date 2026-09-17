// Receives a PNG (base64) from the app and posts it to your Discord channel.
// The webhook URL lives only in the DISCORD_WEBHOOK_URL env var, never in the page.
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) { res.status(500).json({ error: "Missing DISCORD_WEBHOOK_URL environment variable" }); return; }
  try {
    const { image, filename, content } = req.body || {};
    if (!image) { res.status(400).json({ error: "No image provided" }); return; }
    const buf = Buffer.from(image, "base64");
    const form = new FormData();
    form.append("payload_json", JSON.stringify({ content: content || "" }));
    form.append("files[0]", new Blob([buf], { type: "image/png" }), filename || "rankings.png");
    const r = await fetch(webhook, { method: "POST", body: form });
    if (!r.ok) { const t = await r.text(); res.status(r.status).json({ error: t }); return; }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
