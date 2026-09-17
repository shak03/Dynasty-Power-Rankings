# Fantasy Power Rankings

A weekly, self-updating power-ranking board for a Sleeper dynasty league.
Pulls live data from Sleeper, computes a 0-100 Power Score, writes
hype-at-the-top / roast-at-the-bottom blurbs with a hot-hand callout, and can
push the whole board to Discord as an image.

## Deploy (no terminal needed)

1. Put this folder on GitHub (create a repo, then Add file -> Upload files).
2. On Vercel: Add New -> Project -> import the repo. Set the Root Directory to
   `fantasy-power-rankings` if your files are nested in that folder. Deploy.
3. AI blurbs: add an environment variable in Vercel
   (Settings -> Environment Variables): ANTHROPIC_API_KEY = sk-ant-...
   (key from https://console.anthropic.com, needs a few dollars of credit).
4. Discord auto-post (optional): add DISCORD_WEBHOOK_URL = the webhook URL from
   your Discord channel (Server Settings -> Integrations -> Webhooks ->
   New Webhook -> pick channel -> Copy Webhook URL).
5. Redeploy after adding env vars. Open your URL and hit Refresh.

## Getting it into Discord

- **Download image** button: builds a PNG of the board you can drag into any
  channel. No setup required.
- **Post to Discord** button: posts that image straight to your channel. Needs
  the DISCORD_WEBHOOK_URL env var (step 4). Your webhook stays hidden on the
  server via `api/discord.js`.

## No API key / no webhook?

The board still works. Without ANTHROPIC_API_KEY it uses quick auto-takes
instead of AI blurbs. Without DISCORD_WEBHOOK_URL, use the Download button.

## Tweaks

- Ranking weights / recent window: top of `src/PowerRankings.jsx`.
- Blurb model or voice: `api/blurbs.js` (default claude-haiku-4-5; set a
  BLURB_MODEL env var to change it, e.g. claude-sonnet-4-6).
