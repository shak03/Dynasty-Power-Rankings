import React, { useState, useEffect, useRef, useCallback } from "react";
import { toPng } from "html-to-image";
import NICKNAMES from "./nicknames.js";

// ---- Config ----------------------------------------------------------------
const DEFAULT_LEAGUE_ID = "1398034562679869441";
const SLEEPER = "https://api.sleeper.app/v1";
const WEIGHTS = { allPlay: 0.4, points: 0.25, recent: 0.25, record: 0.1 };
const RECENT_WINDOW = 3;

const cache = { players: null };

const PROXIES = [
  (u) => u,
  (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}`,
  (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`,
];
async function smartFetch(url) {
  let lastErr;
  for (const wrap of PROXIES) {
    try {
      const r = await fetch(wrap(url));
      if (r.ok) return await r.json();
      lastErr = new Error(`HTTP ${r.status}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("Request failed");
}

// ---- Palette ---------------------------------------------------------------
const C = {
  bg: "#0a1410", panel: "#102018", panelHi: "#16291f", line: "rgba(232,240,234,0.10)",
  chalk: "#e8f0ea", muted: "#7f978a", gold: "#e8b23a", up: "#43d17a", down: "#ef6b5e", flame: "#ff9147",
};
const displayFont = "'Oswald','Arial Narrow','Helvetica Neue Condensed',system-ui,sans-serif";
const bodyFont = "-apple-system,'Segoe UI',Roboto,Helvetica,Arial,system-ui,sans-serif";

// ---- Math ------------------------------------------------------------------
function normalize(map) {
  const vals = Object.values(map);
  const min = Math.min(...vals), max = Math.max(...vals);
  const out = {};
  for (const k of Object.keys(map)) out[k] = max === min ? 50 : ((map[k] - min) / (max - min)) * 100;
  return out;
}
function scoredWeeks(weekly) {
  return Object.keys(weekly).map(Number)
    .filter((w) => weekly[w].some((t) => (t.points || 0) > 0))
    .sort((a, b) => a - b);
}
function computeRankings(weekly, upto, rosterIds) {
  const weeks = scoredWeeks(weekly).filter((w) => w <= upto);
  const totalPoints = {}, recentPoints = {}, wins = {}, games = {}, allPlayWins = {}, allPlayGames = {};
  rosterIds.forEach((id) => {
    totalPoints[id] = 0; recentPoints[id] = 0; wins[id] = 0; games[id] = 0; allPlayWins[id] = 0; allPlayGames[id] = 0;
  });
  const recentSet = new Set(weeks.slice(-RECENT_WINDOW));
  weeks.forEach((w) => {
    const teams = weekly[w];
    const byRoster = {};
    teams.forEach((t) => (byRoster[t.roster_id] = t.points || 0));
    rosterIds.forEach((id) => {
      const p = byRoster[id] || 0;
      totalPoints[id] += p;
      if (recentSet.has(w)) recentPoints[id] += p;
    });
    const byMatchup = {};
    teams.forEach((t) => {
      if (t.matchup_id == null) return;
      (byMatchup[t.matchup_id] = byMatchup[t.matchup_id] || []).push(t);
    });
    Object.values(byMatchup).forEach((pair) => {
      if (pair.length !== 2) return;
      const [a, b] = pair;
      games[a.roster_id]++; games[b.roster_id]++;
      if ((a.points || 0) > (b.points || 0)) wins[a.roster_id]++;
      else if ((b.points || 0) > (a.points || 0)) wins[b.roster_id]++;
      else { wins[a.roster_id] += 0.5; wins[b.roster_id] += 0.5; }
    });
    rosterIds.forEach((id) => {
      const mine = byRoster[id] || 0;
      rosterIds.forEach((other) => {
        if (other === id) return;
        allPlayGames[id]++;
        if (mine > (byRoster[other] || 0)) allPlayWins[id]++;
        else if (mine === (byRoster[other] || 0)) allPlayWins[id] += 0.5;
      });
    });
  });
  const allPlayPct = {}, recordPct = {};
  rosterIds.forEach((id) => {
    allPlayPct[id] = allPlayGames[id] ? allPlayWins[id] / allPlayGames[id] : 0;
    recordPct[id] = games[id] ? wins[id] / games[id] : 0;
  });
  const nAll = normalize(allPlayPct), nPts = normalize(totalPoints), nRec = normalize(recentPoints), nWL = normalize(recordPct);
  const rows = rosterIds.map((id) => ({
    rosterId: id,
    score: Math.round(WEIGHTS.allPlay * nAll[id] + WEIGHTS.points * nPts[id] + WEIGHTS.recent * nRec[id] + WEIGHTS.record * nWL[id]),
    pf: totalPoints[id], wins: wins[id], losses: games[id] - wins[id], allPlayPct: allPlayPct[id],
  }));
  rows.sort((a, b) => b.score - a.score || b.pf - a.pf);
  rows.forEach((r, i) => (r.rank = i + 1));
  return rows;
}
// A player counts as a "key scorer" if he's within 60% of the team's top starter;
// scoring is "balanced" if the #2 starter is within 80% of the #1.
const KEY_SCORER_RATIO = 0.6;
const BALANCED_RATIO = 0.8;

function scorers(weekly, rosterId, upto, players) {
  const weeks = scoredWeeks(weekly).filter((w) => w <= upto).slice(-RECENT_WINDOW);
  const byPlayer = {}; let starterTotal = 0;
  weeks.forEach((w) => {
    const t = weekly[w].find((x) => x.roster_id === rosterId);
    if (!t || !t.starters) return;
    t.starters.forEach((pid, i) => {
      if (!pid || pid === "0") return;
      const pts = (t.starters_points && t.starters_points[i]) || 0;
      byPlayer[pid] = (byPlayer[pid] || 0) + pts;
      starterTotal += pts;
    });
  });
  const ranked = Object.keys(byPlayer)
    .map((pid) => ({ pid, pts: byPlayer[pid] }))
    .filter((x) => x.pts > 0)
    .sort((a, b) => b.pts - a.pts);
  if (!ranked.length) return null;
  const describe = ({ pid, pts }) => {
    const p = players && players[pid];
    const name = (p && (p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" "))) || null;
    return {
      name, pos: (p && p.position) || "", team: (p && p.team) || "",
      pts: Math.round(pts * 10) / 10,
      share: starterTotal ? Math.round((pts / starterTotal) * 100) : 0,
    };
  };
  return {
    top: describe(ranked[0]),
    others: ranked.slice(1, 3).filter((x) => x.pts >= KEY_SCORER_RATIO * ranked[0].pts).map(describe),
    balanced: ranked.length > 1 && ranked[1].pts >= BALANCED_RATIO * ranked[0].pts,
    windowWeeks: weeks.length,
  };
}

function nickFor(username) {
  if (!username) return "";
  const key = Object.keys(NICKNAMES).find((k) => k.toLowerCase() === String(username).toLowerCase());
  return (key && NICKNAMES[key] && NICKNAMES[key].trim()) || "";
}

function playerInfo(pid, players) {
  const p = players && players[pid];
  return {
    name: (p && (p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" "))) || null,
    pos: (p && p.position) || "",
  };
}

// This week's actual game, straight from Sleeper: result, both scores, opponent.
function weekResult(weekly, week, rosterId) {
  const teams = weekly[week] || [];
  const me = teams.find((t) => t.roster_id === rosterId);
  if (!me || me.matchup_id == null) return null;
  const opp = teams.find((t) => t.matchup_id === me.matchup_id && t.roster_id !== rosterId);
  if (!opp) return null;
  const a = me.points || 0, b = opp.points || 0;
  return {
    res: a > b ? "Won" : a < b ? "Lost" : "Tied",
    me: a, opp: b, oppId: opp.roster_id,
    margin: Math.round(Math.abs(a - b) * 10) / 10,
  };
}

// The team's top starter in THIS week's game only.
function thisWeekTop(weekly, week, rosterId, players) {
  const t = (weekly[week] || []).find((x) => x.roster_id === rosterId);
  if (!t || !t.starters) return null;
  let best = null;
  t.starters.forEach((pid, i) => {
    if (!pid || pid === "0") return;
    const pts = (t.starters_points && t.starters_points[i]) || 0;
    if (!best || pts > best.pts) best = { pid, pts };
  });
  if (!best || best.pts <= 0) return null;
  return { ...playerInfo(best.pid, players), pts: Math.round(best.pts * 10) / 10 };
}

function moveText(d) {
  if (d === "NEW") return "first ranking of the season";
  if (!d) return "no change from last week";
  const n = Math.abs(d);
  return `${d > 0 ? "up" : "down"} ${n} spot${n > 1 ? "s" : ""} from last week`;
}

// ---- Blurbs ----------------------------------------------------------------
// Accurate fallback, used for any team whose AI blurb fails the fact check.
function templateBlurb(row, who, hot, total, wr, oppName) {
  let stars = "the lineup", plural = false;
  if (hot) {
    const names = [hot.top, ...(hot.balanced ? hot.others : [])].map((p) => p.name).filter(Boolean);
    if (names.length) {
      plural = names.length > 1;
      stars = plural ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    }
  }
  const keep = plural ? "keep" : "keeps";
  const game = wr
    ? `${wr.res === "Won" ? "Beat" : wr.res === "Lost" ? "Fell to" : "Tied"} ${oppName} ${wr.me.toFixed(1)}-${wr.opp.toFixed(1)} this week. `
    : "";
  if (row.rank === 1) return `${game}${who} stays on top, and ${stars} ${keep} this team rolling.`;
  if (row.rank === total) return `${game}${who} sits in the basement for now. Time for ${stars} to turn it around.`;
  if (row.rank <= 3) return `${game}${who} is firmly in contention, and ${stars} ${keep} this team dangerous.`;
  if (row.rank >= total - 2) return `${game}${who} is sliding toward the wheel of punishment. Time for ${stars} to turn it around.`;
  return `${game}${who} is stuck in the muddled middle, but ${stars} ${keep} things interesting.`;
}

async function generateBlurbs(rows, ctx) {
  const { callName, namesOf, hots, deltas, results, weekTops, week } = ctx;
  const standings = [], meta = [], playerNames = new Set();
  rows.forEach((r) => {
    const id = r.rosterId, hot = hots[id], wr = results[id], tw = weekTops[id];
    const n = hot ? hot.windowWeeks : 0;
    const scorersList = hot ? [hot.top, ...hot.others] : [];
    scorersList.forEach((p) => p.name && playerNames.add(p.name));
    if (tw && tw.name) playerNames.add(tw.name);
    standings.push({
      rank: r.rank,
      name: callName(id),
      powerScore: r.score,
      movement: moveText(deltas[id]),
      record: `${r.wins}-${r.losses}`,
      pointsFor: Math.round(r.pf),
      allPlayWinPct: Math.round(r.allPlayPct * 100),
      thisWeek: wr
        ? `${wr.res} ${wr.me.toFixed(1)}-${wr.opp.toFixed(1)} against ${callName(wr.oppId)} (margin ${wr.margin.toFixed(1)})`
        : "no game this week",
      thisWeekTopScorer: tw ? `${tw.name || "a starter"}${tw.pos ? " (" + tw.pos + ")" : ""}: ${tw.pts} pts this week` : "unknown",
      scoringStyle: hot ? (hot.balanced ? "balanced" : "one standout") : "unknown",
      keyScorers: scorersList.map((p) =>
        `${p.name || "a starter"}${p.pos ? " (" + p.pos + ")" : ""}: ${p.pts} pts over the last ${n} week${n === 1 ? "" : "s"}`),
    });
    const numbers = [r.rank, r.score, r.wins, r.losses, r.pf, Math.round(r.allPlayPct * 100), week, n,
      typeof deltas[id] === "number" ? Math.abs(deltas[id]) : null,
      wr && wr.me, wr && wr.opp, wr && wr.margin, tw && tw.pts, ...scorersList.map((p) => p.pts)]
      .filter((x) => typeof x === "number" && isFinite(x));
    meta.push({ rank: r.rank, ownNames: namesOf(id), oppNames: wr ? namesOf(wr.oppId) : [], numbers });
  });
  const res = await fetch("/api/blurbs", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ standings, meta, playerNames: [...playerNames] }),
  });
  if (!res.ok) throw new Error("blurb service error");
  const data = await res.json();
  if (!data.blurbs || Object.keys(data.blurbs).length === 0) throw new Error("no blurbs");
  return data.blurbs;
}

// ---- UI bits ---------------------------------------------------------------
function Movement({ delta }) {
  if (delta === "NEW") return <span style={{ color: C.muted, fontSize: 12 }}>new</span>;
  if (delta === 0 || delta == null) return <span style={{ color: C.muted, fontSize: 14 }}>{"\u2014"}</span>;
  const up = delta > 0;
  return <span style={{ color: up ? C.up : C.down, fontSize: 13, fontWeight: 600 }}>{up ? "\u25B2" : "\u25BC"}{Math.abs(delta)}</span>;
}
function btn(kind) {
  const base = { border: "none", borderRadius: 8, padding: "9px 16px", fontWeight: 700, cursor: "pointer" };
  if (kind === "primary") return { ...base, background: C.gold, color: "#1a1205" };
  return { ...base, background: C.panelHi, color: C.chalk, border: `1px solid ${C.line}` };
}
function TeamCard({ row, name, hot, delta, blurb, isTop, isBottom, i, result, oppLabel }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "72px 1fr auto", gap: 16, alignItems: "center",
      padding: "18px", borderRadius: 10,
      background: isTop ? `linear-gradient(90deg, rgba(232,178,58,0.14), ${C.panelHi})` : C.panel,
      border: `1px solid ${isTop ? "rgba(232,178,58,0.35)" : C.line}`,
    }}>
      <div style={{ textAlign: "center", lineHeight: 1 }}>
        <div style={{ fontFamily: displayFont, fontWeight: 700, fontSize: isTop ? 58 : 46, color: isTop ? C.gold : C.chalk }}>{row.rank}</div>
        <div style={{ marginTop: 4 }}><Movement delta={delta} /></div>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: displayFont, fontSize: 24, fontWeight: 600, letterSpacing: 0.3, color: C.chalk }}>{name.team}</div>
        <div style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>
          {name.nick || name.manager} &nbsp; {row.wins}-{row.losses} &nbsp; {Math.round(row.pf)} PF &nbsp; {Math.round(row.allPlayPct * 100)}% all-play
        </div>
        {result && (
          <div style={{ color: C.muted, fontSize: 12.5, marginTop: 3 }}>
            <span style={{ fontWeight: 700, color: result.res === "Won" ? C.up : result.res === "Lost" ? C.down : C.muted }}>
              {result.res === "Won" ? "W" : result.res === "Lost" ? "L" : "T"}
            </span>
            {" "}{result.me.toFixed(1)}{"\u2013"}{result.opp.toFixed(1)} vs {oppLabel}
          </div>
        )}
        {hot && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 14 }}>{"\uD83D\uDD25"}</span>
              <span style={{ color: C.chalk, fontSize: 14, fontWeight: 600 }}>{hot.top.name || "Hot hand"}</span>
              {hot.top.pos && <span style={{ color: C.muted, fontSize: 12 }}>{hot.top.pos}{hot.top.team ? " \u00B7 " + hot.top.team : ""}</span>}
              <span style={{ color: C.flame, fontSize: 13, fontWeight: 600 }}>{hot.top.pts} pts / {hot.top.share}% of scoring</span>
              <span style={{ color: C.muted, fontSize: 12 }}>last {hot.windowWeeks} wk{hot.windowWeeks === 1 ? "" : "s"}</span>
            </div>
            {hot.others.length > 0 && (
              <div style={{ color: C.muted, fontSize: 12.5, marginTop: 4 }}>
                Also producing: {hot.others.map((o) => `${o.name || "Starter"} ${o.pts}`).join(" \u00B7 ")}
              </div>
            )}
          </div>
        )}
        <div style={{ marginTop: 10, color: isBottom ? "#f0b9b0" : C.chalk, opacity: 0.92, fontSize: 14.5, lineHeight: 1.5, maxWidth: "62ch", fontFamily: bodyFont }}>
          {blurb || <span style={{ color: C.muted }}>Cooking up a hot take{"\u2026"}</span>}
        </div>
      </div>
      <div style={{ textAlign: "center", minWidth: 84 }}>
        <div style={{ fontFamily: displayFont, fontWeight: 700, fontSize: 40, color: isTop ? C.gold : C.chalk }}>{row.score}</div>
        <div style={{ color: C.muted, fontSize: 11, marginTop: -2 }}>power</div>
      </div>
    </div>
  );
}

// ---- Main ------------------------------------------------------------------
export default function PowerRankings() {
  const [leagueId, setLeagueId] = useState(DEFAULT_LEAGUE_ID);
  const [status, setStatus] = useState("idle");
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [playersMissing, setPlayersMissing] = useState(false);
  const [leagueName, setLeagueName] = useState("");
  const [names, setNames] = useState({});
  const [weekly, setWeekly] = useState({});
  const [rosterIds, setRosterIds] = useState([]);
  const [latestWeek, setLatestWeek] = useState(0);
  const [week, setWeek] = useState(0);
  const [rows, setRows] = useState([]);
  const [hots, setHots] = useState({});
  const [results, setResults] = useState({});
  const [deltas, setDeltas] = useState({});
  const [blurbs, setBlurbs] = useState({});
  const [blurbState, setBlurbState] = useState("idle");
  const [discord, setDiscord] = useState("idle"); // idle|posting|done|failed
  const blurbCache = useRef({});
  const captureRef = useRef(null);

  const load = useCallback(async () => {
    setStatus("loading"); setError(""); setBlurbs({}); setPlayersMissing(false); setDiscord("idle");
    blurbCache.current = {};
    try {
      setLoadingMsg("Checking the NFL week\u2026");
      const state = await smartFetch(`${SLEEPER}/state/nfl`);
      const cur = state.week || state.display_week || 1;
      setLoadingMsg("Pulling league, rosters, and managers\u2026");
      const league = await smartFetch(`${SLEEPER}/league/${leagueId}`);
      const rosters = await smartFetch(`${SLEEPER}/league/${leagueId}/rosters`);
      const users = await smartFetch(`${SLEEPER}/league/${leagueId}/users`);
      setLeagueName(league.name || "League");
      const userById = {};
      users.forEach((u) => (userById[u.user_id] = u));
      const nameMap = {}; const ids = [];
      rosters.forEach((r) => {
        ids.push(r.roster_id);
        const u = userById[r.owner_id];
        const team = (u && u.metadata && u.metadata.team_name) || (u && u.display_name) || `Team ${r.roster_id}`;
        const manager = (u && u.display_name) || "Unknown manager";
        nameMap[r.roster_id] = { team, manager, nick: nickFor(manager) };
      });
      if (!cache.players) {
        setLoadingMsg("Downloading the NFL player list (one-time, ~5MB)\u2026");
        try { cache.players = await smartFetch(`${SLEEPER}/players/nfl`); }
        catch (e) { cache.players = {}; setPlayersMissing(true); }
      }
      if (cache.players && Object.keys(cache.players).length === 0) setPlayersMissing(true);
      setLoadingMsg("Fetching each week's matchups\u2026");
      const weeklyData = {}; const BATCH = 4;
      for (let start = 1; start <= cur; start += BATCH) {
        const chunk = [];
        for (let w = start; w < start + BATCH && w <= cur; w++) chunk.push(w);
        const res = await Promise.all(chunk.map((w) => smartFetch(`${SLEEPER}/league/${leagueId}/matchups/${w}`).catch(() => [])));
        res.forEach((m, i) => (weeklyData[chunk[i]] = m || []));
      }
      const played = scoredWeeks(weeklyData);
      const last = played.length ? played[played.length - 1] : 0;
      setNames(nameMap); setRosterIds(ids); setWeekly(weeklyData); setLatestWeek(last); setWeek(last); setStatus("ready");
    } catch (e) {
      setError("Couldn't reach Sleeper. Double-check the league ID above. (If you just deployed, give it a moment and hit Refresh.)");
      setStatus("error");
    }
  }, [leagueId]);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    if (status !== "ready" || !week) return;
    setDiscord("idle");
    const cur = computeRankings(weekly, week, rosterIds);
    setRows(cur);
    const prevWeeks = scoredWeeks(weekly).filter((w) => w < week);
    const d = {};
    if (prevWeeks.length) {
      const prev = computeRankings(weekly, prevWeeks[prevWeeks.length - 1], rosterIds);
      const prevRank = {}; prev.forEach((r) => (prevRank[r.rosterId] = r.rank));
      cur.forEach((r) => (d[r.rosterId] = prevRank[r.rosterId] - r.rank));
    } else cur.forEach((r) => (d[r.rosterId] = "NEW"));
    setDeltas(d);
    const h = {}, wrs = {}, tops = {};
    cur.forEach((r) => {
      h[r.rosterId] = scorers(weekly, r.rosterId, week, cache.players);
      wrs[r.rosterId] = weekResult(weekly, week, r.rosterId);
      tops[r.rosterId] = thisWeekTop(weekly, week, r.rosterId, cache.players);
    });
    setHots(h); setResults(wrs);
    if (blurbCache.current[week]) { setBlurbs(blurbCache.current[week]); setBlurbState("done"); return; }
    setBlurbs({}); setBlurbState("generating");
    const info = (id) => names[id] || { team: `Team ${id}`, manager: "", nick: "" };
    const callName = (id) => info(id).nick || info(id).team;
    const namesOf = (id) => [...new Set([info(id).team, info(id).manager, info(id).nick].filter(Boolean))];
    const fallback = (r) => {
      const wr = wrs[r.rosterId];
      return templateBlurb(r, callName(r.rosterId), h[r.rosterId], cur.length, wr, wr ? callName(wr.oppId) : "");
    };
    generateBlurbs(cur, { callName, namesOf, hots: h, deltas: d, results: wrs, weekTops: tops, week })
      .then((byRank) => {
        const byRoster = {};
        cur.forEach((r) => (byRoster[r.rosterId] = byRank[String(r.rank)] || fallback(r)));
        blurbCache.current[week] = byRoster; setBlurbs(byRoster); setBlurbState("done");
      })
      .catch(() => {
        const byRoster = {};
        cur.forEach((r) => (byRoster[r.rosterId] = fallback(r)));
        blurbCache.current[week] = byRoster; setBlurbs(byRoster); setBlurbState("failed");
      });
  }, [status, week, weekly, rosterIds, names]);

  const nameFor = (id) => names[id] || { team: `Team ${id}`, manager: "", nick: "" };
  const labelFor = (id) => nameFor(id).nick || nameFor(id).team;
  const noData = status === "ready" && (!week || rows.length === 0);
  const blurbsPending = blurbState === "generating";

  async function snapshot(pixelRatio) {
    if (!captureRef.current) throw new Error("nothing to capture");
    if (document.fonts && document.fonts.ready) { try { await document.fonts.ready; } catch (e) {} }
    return toPng(captureRef.current, { pixelRatio, backgroundColor: C.bg, cacheBust: true });
  }
  async function downloadImage() {
    try {
      const url = await snapshot(2);
      const a = document.createElement("a");
      a.href = url; a.download = `power-rankings-week-${week}.png`; a.click();
    } catch (e) { alert("Couldn't build the image. Try again in a moment."); }
  }
  async function postToDiscord() {
    setDiscord("posting");
    try {
      const url = await snapshot(1.5);
      const base64 = url.split(",")[1];
      const res = await fetch("/api/discord", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          image: base64,
          filename: `power-rankings-week-${week}.png`,
          content: `**${leagueName} \u2014 Power Rankings \u2014 Week ${week}**`,
        }),
      });
      setDiscord(res.ok ? "done" : "failed");
    } catch (e) { setDiscord("failed"); }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.chalk, fontFamily: bodyFont, padding: "28px 18px 60px" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&display=swap');
        select, input, button { font-family: inherit; }
      `}</style>
      <div style={{ maxWidth: 860, margin: "0 auto" }}>
        {/* Controls */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: C.muted, fontSize: 12 }}>League ID</span>
            <input value={leagueId} onChange={(e) => setLeagueId(e.target.value.trim())} spellCheck={false}
              style={{ width: 260, background: C.panel, color: C.chalk, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px", fontSize: 13 }} />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {latestWeek > 0 && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, color: C.muted, fontSize: 13 }}>
                Week
                <select value={week} onChange={(e) => setWeek(Number(e.target.value))} style={{ background: C.panel, color: C.chalk, border: `1px solid ${C.line}`, borderRadius: 8, padding: "7px 10px" }}>
                  {scoredWeeks(weekly).map((w) => (<option key={w} value={w}>{w}</option>))}
                </select>
              </label>
            )}
            <button onClick={load} disabled={status === "loading"} style={{ ...btn("primary"), opacity: status === "loading" ? 0.6 : 1 }}>
              {status === "loading" ? "Loading\u2026" : "Refresh"}
            </button>
            {status === "ready" && !noData && (
              <>
                <button onClick={downloadImage} disabled={blurbsPending} style={{ ...btn("secondary"), opacity: blurbsPending ? 0.5 : 1 }}>Download image</button>
                <button onClick={postToDiscord} disabled={blurbsPending || discord === "posting"} style={{ ...btn("secondary"), opacity: (blurbsPending || discord === "posting") ? 0.5 : 1 }}>
                  {discord === "posting" ? "Posting\u2026" : discord === "done" ? "Posted \u2713" : "Post to Discord"}
                </button>
              </>
            )}
          </div>
        </div>
        {status === "ready" && !noData && (
          <div style={{ minHeight: 18, marginBottom: 10, fontSize: 12, color: discord === "failed" ? C.down : C.muted }}>
            {blurbsPending && "Blurbs are still generating \u2014 they'll be in the image once they finish."}
            {!blurbsPending && discord === "failed" && "Couldn't post. Add a DISCORD_WEBHOOK_URL in Vercel (see README), then redeploy."}
            {!blurbsPending && discord === "done" && "Posted to your Discord channel."}
          </div>
        )}

        {status === "loading" && <div style={{ color: C.muted, padding: "40px 4px", fontSize: 15 }}>{loadingMsg}</div>}
        {status === "error" && (
          <div style={{ background: C.panel, border: `1px solid ${C.down}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontFamily: displayFont, fontSize: 20, marginBottom: 6 }}>Couldn't load the league</div>
            <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.5 }}>{error}</div>
            <button onClick={load} style={{ ...btn("primary"), marginTop: 14 }}>Try again</button>
          </div>
        )}
        {noData && (
          <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 10, padding: 20 }}>
            <div style={{ fontFamily: displayFont, fontSize: 20, marginBottom: 6 }}>No games scored yet</div>
            <div style={{ color: C.muted, fontSize: 14, lineHeight: 1.5 }}>This league has no completed, scored weeks yet. Once Week 1 wraps, refresh and the board will fill in.</div>
          </div>
        )}

        {/* Captured poster */}
        {status === "ready" && !noData && (
          <div ref={captureRef} style={{ background: C.bg, padding: "24px 22px 26px", borderRadius: 12 }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ color: C.muted, fontSize: 13 }}>{leagueName}</div>
              <div style={{ fontFamily: displayFont, fontWeight: 700, fontSize: 40, letterSpacing: 0.5, lineHeight: 1 }}>
                Power Rankings <span style={{ color: C.gold, fontSize: 22 }}>{"\u00B7"} Week {week}</span>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {rows.map((r, i) => (
                <TeamCard key={r.rosterId} i={i} row={r} name={nameFor(r.rosterId)} hot={hots[r.rosterId]} delta={deltas[r.rosterId]} blurb={blurbs[r.rosterId]} isTop={r.rank === 1} isBottom={r.rank === rows.length}
                  result={results[r.rosterId]} oppLabel={results[r.rosterId] ? labelFor(results[r.rosterId].oppId) : ""} />
              ))}
            </div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 18, lineHeight: 1.6 }}>
              Power Score blends all-play win% (40%), total points (25%), last-{RECENT_WINDOW}-week scoring (25%), and actual record (10%), each scaled 0-100 across the league.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
