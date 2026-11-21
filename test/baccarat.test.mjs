import { BacTable, bacRound, bacPay, bacTotal, verifyShoe, cardText } from '../js/baccarat.js';
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
const C = (s) => s.split(' ').map((x) => ({ r: x.slice(0, -1), s: x.slice(-1) }));
const run = (s) => { const d = C(s); return bacRound(() => d.shift()); };
// totals
ok(bacTotal(C('7♠ 8♥')) === 5 && bacTotal(C('K♠ Q♥ 9♦')) === 9 && bacTotal(C('A♠ 10♥')) === 1, 'totals');
// naturals: nobody draws
{ const r = run('9♠ 2♥ K♦ 3♣ 5♠ 5♦'); ok(r.P.length === 2 && r.B.length === 2 && r.natural && r.winner === 'player', 'player natural 9'); }
{ const r = run('2♠ 4♥ 3♦ 4♣ 5♠ 5♦'); ok(r.B.length === 2 && r.P.length === 2 && r.winner === 'banker' && r.natural, 'banker natural 8 stops player on 5'); }
// player stands on 6 or 7: banker draws on 0-5, stands on 6-7
{ const r = run('3♠ 2♥ 3♦ 3♣ 4♠'); ok(r.P.length === 2 && r.B.length === 3 && r.bt === 9, 'player 6 stands, banker 5 draws'); }
{ const r = run('3♠ 3♥ 4♦ 3♣ 4♠'); ok(r.P.length === 2 && r.B.length === 2 && r.winner === 'tie' === false && r.pt === 7 && r.bt === 6, 'player 7, banker 6 both stand'); }
// the banker's third card table, every case: banker total bt, player third card value v
const third = (bt, v) => bt <= 2 || (bt === 3 && v !== 8) || (bt === 4 && v >= 2 && v <= 7) || (bt === 5 && v >= 4 && v <= 7) || (bt === 6 && (v === 6 || v === 7));
const expect = { 0: '0123456789', 1: '0123456789', 2: '0123456789', 3: '012345679', 4: '234567', 5: '4567', 6: '67', 7: '' };
for (let bt = 0; bt <= 7; bt++) for (let v = 0; v <= 9; v++) {
  ok(third(bt, v) === expect[bt].includes(String(v)), 'table as printed ' + bt + ' ' + v);
  // build a deal: player 2 cards totalling 0 (K, Q), banker two cards totalling bt, player third card value v
  const b1 = bt === 0 ? 'K♦' : bt + '♦'; const b1c = bt === 1 ? 'A♦' : b1;
  const p3 = v === 0 ? 'J♣' : v === 1 ? 'A♣' : v + '♣';
  const r = run(`K♠ ${b1c} Q♠ Q♦ ${p3} 2♥`);
  ok(r.P.length === 3 && (r.B.length === 3) === expect[bt].includes(String(v)), `banker ${bt} against third card ${v}: drew ${r.B.length === 3}`);
}
// pays
{
  const bets = { player: 100, banker: 100, tie: 10, ppair: 10, bpair: 10 };
  ok(bacPay(bets, { winner: 'player', ppair: false, bpair: false }).back === 200, 'player win returns 200 of 230');
  ok(bacPay(bets, { winner: 'banker', ppair: false, bpair: false }).back === 195, 'banker win pays 0.95');
  ok(bacPay(bets, { winner: 'tie', ppair: false, bpair: false }).back === 100 + 100 + 90, 'tie: main bets back, tie 8 to 1');
  ok(bacPay(bets, { winner: 'banker', ppair: true, bpair: true }).back === 195 + 120 + 120, 'pairs 11 to 1');
  ok(bacPay({ banker: 1 }, { winner: 'banker' }).back === 1.95 && bacPay({ banker: 3 }, { winner: 'banker' }).back === 5.85, 'small banker bets');
}
// table: bets, limits, chips never appear or vanish except through the house
{
  const t = new BacTable({ maxBet: 200, maxSide: 50 });
  t.join('a', 'Ann'); t.join('b', 'Bob');
  let thr = 0;
  t.bet('a', 'player', 150); t.bet('a', 'player', 150); ok(t.bets.a.player === 200 && t.players.a.chips === 800, 'bet capped at the table maximum');
  try { t.bet('a', 'player', 5); } catch { thr++; } ok(thr === 1, 'no more once at the maximum');
  t.bet('b', 'tie', 60); ok(t.bets.b.tie === 50, 'side bet capped');
  try { t.bet('b', 'nope', 5); } catch { thr++; } try { t.bet('b', 'banker', -5); } catch { thr++; } try { t.bet('b', 'banker', NaN); } catch { thr++; } ok(thr === 4, 'bad bets refused');
  t.clearBets('b'); ok(t.players.b.chips === 1000 && !t.bets.b, 'clear gives the chips back');
  const pub = JSON.stringify(t.publicState('b'));
  ok(!pub.includes(t.fair.next.seed), 'the seed of the coming shoe is not told');
  t.deal();
  ok(t.phase === 'done' && t.hand && t.pays.a, 'dealt');
  const pub2 = JSON.stringify(t.publicState('b'));
  ok(!pub2.includes(t.cur.serverSeed) && !pub2.includes('"shoe":['), 'the seed and the cards of the shoe in play are not told');
  try { t.bet('a', 'player', 5); } catch { thr++; } ok(thr === 5, 'no bets while the cards are out');
  t.next(); t.rebet('a'); ok(t.bets.a.player === 200, 'rebet');
}
// many rounds: the house's result is the opposite of the players', every shoe checks against its seed, results are near the known odds
{
  const t = new BacTable({ maxBet: 1000, maxSide: 1000, startChips: 1e7 });
  for (let i = 0; i < 5; i++) t.join('p' + i, 'P' + i);
  for (let i = 1; i < 5; i++) t.setClientSeed('p' + i, 'seed' + i, t.fair.next.commit);
  const cnt = { p: 0, b: 0, t: 0, pp: 0 };
  let staked = { player: 0, banker: 0, tie: 0 }, net = { player: 0, banker: 0, tie: 0 };
  const N = 60000;
  for (let r = 0; r < N; r++) {
    t.bet('p0', 'player', 100); t.bet('p1', 'banker', 100); t.bet('p2', 'tie', 100); t.bet('p3', 'ppair', 10); if (r % 7 === 0) t.bet('p4', 'bpair', 3);
    const before = t.chipsTotal();
    t.deal();
    const paid = Object.values(t.pays).reduce((a, p) => a + p.net, 0);
    if (Math.abs(t.chipsTotal() - before - paid) > 0.001) { ok(false, 'chips changed by something other than the payouts'); break; }
    cnt[t.hand.winner[0]]++; if (t.hand.ppair) cnt.pp++;
    net.player += t.pays.p0.net; net.banker += t.pays.p1.net; net.tie += t.pays.p2.net;
    const all = [...t.hand.P, ...t.hand.B];
    if (all.length < 4 || all.length > 6) ok(false, 'card count');
    t.next();
  }
  void staked;
  const f = (x) => x / N;
  ok(Math.abs(f(cnt.b) - 0.4586) < 0.008 && Math.abs(f(cnt.p) - 0.4462) < 0.008 && Math.abs(f(cnt.t) - 0.0952) < 0.005, `result shares near 45.86 / 44.62 / 9.52: ${(f(cnt.b) * 100).toFixed(2)} ${(f(cnt.p) * 100).toFixed(2)} ${(f(cnt.t) * 100).toFixed(2)}`);
  ok(Math.abs(f(cnt.pp) - 0.0747) < 0.005, 'pair share near 7.47%: ' + (f(cnt.pp) * 100).toFixed(2));
  ok(Math.abs(net.player / (N * 100) + 0.0124) < 0.012 && Math.abs(net.banker / (N * 100) + 0.0106) < 0.012, `house edge near 1.24% and 1.06%: ${(-net.player / N).toFixed(2)} ${(-net.banker / N).toFixed(2)}`);
  ok(t.past.length > 0 && t.past.every((s) => verifyShoe(s).ok), 'finished shoes check against their seeds: ' + t.past.length);
  ok(t.past.every((s) => Object.keys(s.clientSeeds).length === (s.shoe === 1 ? 4 : 0)), 'player seeds went into the first shoe');
  const s0 = t.past[0]; const bad = { ...s0, dealt: [s0.dealt[1], s0.dealt[0], ...s0.dealt.slice(2)] };
  ok(cardText(s0.dealt[0]) === cardText(s0.dealt[1]) || !verifyShoe(bad).ok, 'a changed deal fails the check');
  // a move of the table keeps chips and bets
  t.bet('p0', 'player', 55);
  const m = BacTable.fromPublic(JSON.parse(JSON.stringify(t.publicState('p2'))), 'p2');
  ok(m.chipsTotal() === t.chipsTotal() && m.bets.p0.player === 55 && m.hostId === 'p2', 'moved table keeps chips and bets');
  m.deal(); ok(m.phase === 'done' && m.pays.p0, 'moved table deals from a new shoe');
}
console.log(`${n - fails}/${n} baccarat checks passed`);
process.exit(fails ? 1 : 0);
