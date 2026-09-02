# Fantasy Power Rankings

A weekly, self-updating power-ranking board for a Sleeper dynasty league.
Pulls live data from Sleeper, computes a 0-100 Power Score, and writes
hype-at-the-top / roast-at-the-bottom blurbs with a hot-hand callout.

## Deploy (no terminal needed)

1. Put this folder on GitHub (create a repo, then Add file -> Upload files,
   and drag everything in).
2. Go to vercel.com, sign in with GitHub, "Add New... -> Project", import the
   repo, and click Deploy. Vercel auto-detects Vite.
3. For the AI blurbs, open your Anthropic key at https://console.anthropic.com
   (add a few dollars of credit), then in Vercel:
   Project -> Settings -> Environment Variables -> add
     ANTHROPIC_API_KEY = sk-ant-...
   then Deployments -> Redeploy.
4. Open your Vercel URL. Change the League ID field if needed and hit Refresh.

## No API key?

Skip step 3 (or delete `api/blurbs.js`). The board still works and falls back
to quick auto-generated takes instead of the AI blurbs.

## Run locally (optional)

    npm install
    npm run dev

Local dev won't have the /api/blurbs function, so it uses the auto-takes.
To test blurbs locally, use the Vercel CLI: `npx vercel dev` with the env var set.

## Tweaks

- Ranking weights / recent window: top of `src/PowerRankings.jsx`.
- Blurb model or voice: `api/blurbs.js` (default model claude-haiku-4-5;
  set a BLURB_MODEL env var to change it, e.g. claude-sonnet-4-6 for punchier writing).
