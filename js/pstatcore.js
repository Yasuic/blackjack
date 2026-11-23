// Player stats kept by the poker, baccarat and roulette tables (blackjack builds the same shape from its hands).
// No page code here, so the game engines and the tests can use it.
// t.pst: { rounds: [{ round, counted, step: { name: net } }], hands: { name: { hands, wins, losses, pushes } } }, the last 300 rounds.
export function pstatAdd(t, round, entries, counted) {
  const P = (t.pst ||= { rounds: [], hands: {} });
  const step = {};
  for (const e of entries) {
    if (!e || !e.name) continue;
    const name = String(e.name).slice(0, 24), net = Math.round((Number(e.net) || 0) * 100) / 100;
    step[name] = Math.round(((step[name] || 0) + net) * 100) / 100;
    if (e.dealer) continue;
    const h = (P.hands[name] ||= { hands: 0, wins: 0, losses: 0, pushes: 0, dealt: 0 });
    h.hands++; if (net > 0) h.wins++; else if (net < 0) h.losses++; else h.pushes++;
  }
  for (const e of entries) if (e?.dealer) { const h = (P.hands[String(e.name).slice(0, 24)] ||= { hands: 0, wins: 0, losses: 0, pushes: 0, dealt: 0 }); h.dealt++; }
  if (!Object.keys(step).length) return;
  P.rounds.push({ round, counted: !!counted, step });
  if (P.rounds.length > 300) P.rounds.splice(0, P.rounds.length - 300);
  t._pstatsKey = null;
}
// The same shape as blackjack's Table.playerStats(), for the ledger.
export function pstatsView(t) {
  const P = t.pst; if (!P || !P.rounds.length) return null;
  const key = P.rounds.length + ':' + P.rounds[P.rounds.length - 1].round;
  if (t._pstatsKey === key) return t._pstats;
  const S = {};
  const get = (name) => (S[name] ||= { name, hands: 0, wins: 0, losses: 0, pushes: 0, rounds: 0, net: 0, realNet: 0, practiceNet: 0, best: 0, worst: 0, dealt: 0, ...(P.hands[name] || {}) });
  for (const r of P.rounds) for (const [name, v] of Object.entries(r.step)) { const p = get(name); p.rounds++; p.net += v; if (r.counted) p.realNet += v; else p.practiceNet += v; p.best = Math.max(p.best, v); p.worst = Math.min(p.worst, v); }
  const names = Object.keys(S), run = Object.fromEntries(names.map((n) => [n, 0]));
  const pts = P.rounds.map((r) => { for (const n of names) run[n] += r.step[n] || 0; return { round: r.round, v: names.map((n) => Math.round(run[n] * 100) / 100) }; });
  const every = Math.max(1, Math.ceil(pts.length / 80));
  for (const p of Object.values(S)) for (const k of ['net', 'realNet', 'practiceNet', 'best', 'worst']) p[k] = Math.round(p[k] * 100) / 100;
  t._pstatsKey = key;
  t._pstats = { players: Object.values(S), names, series: pts.filter((_, i) => i % every === 0 || i === pts.length - 1), first: P.rounds[0].round, last: P.rounds[P.rounds.length - 1].round };
  return t._pstats;
}
