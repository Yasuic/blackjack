// Bet log: every settled round in every game is kept with each player's bets, moves and +/-, only public
// information goes in, a round is kept once, and the log stays across reloads (local storage, per table).
import assert from 'node:assert/strict';
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } };
globalThis.sessionStorage = globalThis.localStorage;
const BL = await import('../js/betlog.js');
const G = await import('../js/game.js');
const { PokerTable } = await import('../js/poker.js');
const { BacTable } = await import('../js/baccarat.js');
const { RouTable } = await import('../js/roulette.js');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// Blackjack: hits, doubles, splits and stands are recorded per hand; the dealer row and the dealer's cards too.
{
  const t = new G.Table({ maxBet: 75, minBet: 5, maxSideBet: 10, sideBets: [], charlieEvery: 0 });
  t.join('a', 'Ann'); t.sit('a', 0); t.sit('a', 1, true); t.join('bank', 'Bank'); t.sitDealer('bank');
  t.giveChips('bank', 1e6); t.giveChips('a', 1e6);
  let seen = { Hit: 0, Stand: 0, Double: 0, Split: 0 };
  for (let r = 0; r < 300; r++) {
    for (const s of t.seatsOf('a')) t.setBet('a', { main: 10, sides: {}, ready: true, seat: s });
    t.deal();
    for (const s of t.seatsOf('a')) if (t.phase === 'insurance') { try { t.insurance('a', false, s); } catch {} }
    let g = 0;
    while (t.phase === 'playing' && g++ < 60) {
      const h = t.seats[t.turn.seat].hands[t.turn.hand], acts = t.allowedActions('a'), tot = G.handTotal(h.cards).total;
      t.action('a', acts.includes('split') ? 'split' : acts.includes('double') && tot === 11 ? 'double' : tot <= 14 && acts.includes('hit') ? 'hit' : 'stand');
    }
    while (t.dealerStep()) {}
    const st = t.publicState('a'), e = BL.bjEntry(st);
    ok(e && e.id === st.round && e.label === 'Round ' + st.round, 'one entry per settled round');
    ok(e.rows.length === 3 && e.rows[2].who === 'Bank (dealer)' && e.rows[2].net === st.banker.net, 'a row per seat and one for the dealer');
    ok(e.rows.slice(0, 2).every((x, i) => x.net === st.seats[i].net && x.id === 'a'), 'each seat row has the seat +/-');
    ok(e.rows.reduce((a, x) => a + x.net, 0) === 0, 'rows add up to zero against a player dealer');
    for (const k of Object.keys(seen)) if (e.rows.some((x) => x.did.includes(k))) seen[k]++;
    ok(e.note.startsWith('Dealer '), 'dealer cards shown');
    ok(BL.betLogAdd('blackjack', 'T1', e) && !BL.betLogAdd('blackjack', 'T1', e), 'a round is kept once');
    t.startBetting();
  }
  ok(Object.values(seen).every((v) => v > 0), 'all moves show up: ' + JSON.stringify(seen));
  ok(BL.betLogList('blackjack', 'T1').length === 300 && BL.betLogList('blackjack', 'T2').length === 0, 'kept per table');
  for (let i = 0; i < 20; i++) BL.betLogAdd('blackjack', 'T1', { id: 1000 + i, label: 'x', rows: [{ who: 'A', bet: 1, did: 'Stand', net: 0 }] });
  ok(BL.betLogList('blackjack', 'T1').length === 300 && BL.betLogList('blackjack', 'T1').at(-1).id === 1019, 'the oldest rounds go after 300');
  const html = BL.betLogHTML('blackjack', 'T1', 'a');
  ok(html.includes('Bet log (300 rounds)') && html.includes('class="me"') && html.includes('the newest 60 show here'), 'Ledger fold');
  ok(BL.betLogHTML('blackjack', 'none').includes('Rounds you see settle'), 'empty log says so');
}
// Poker: each player's moves by street; folded cards never go in.
{
  const t = new PokerTable({ smallBlind: 5, bigBlind: 10, sevenDeuce: 0, turnTimer: 0 });
  for (let i = 0; i < 3; i++) { t.join('p' + i, 'P' + i); t.sit('p' + i, i, 1000); t.setRuns('p' + i, 1); }
  t.startHand();
  let g = 0, folder = null;
  while (t.phase !== 'done' && g++ < 50) { const id = t.seats[t.turn].id, o = t.options(id); if (!folder && !o.canCheck) { folder = id; t.act(id, 'fold'); } else t.act(id, o.canCheck ? 'check' : 'call'); }
  const h = t.publicState('p0').lastHand, e = BL.pokerEntry(h);
  ok(e && e.id === h.hand && e.rows.length === 3, 'a row per player dealt in');
  const p2 = e.rows.find((x) => x.id === folder);
  ok(p2.did.startsWith('Pre: Fold') || p2.did.includes('Pre: Fold'), 'fold recorded: ' + p2.did);
  ok(!p2.did.includes('showed'), 'folded cards are not shown');
  ok(e.rows.some((x) => /Post (small|big) blind/.test(x.did)) && e.rows.some((x) => x.did.includes('Flop: Check')), 'blinds and later streets: ' + e.rows.map((x) => x.did).join(' | '));
  ok(e.rows.reduce((a, x) => a + x.net, 0) === 0, 'poker rows add up to zero');
}
// Baccarat and roulette: every spot bet with its result, and the dealer's bank.
{
  const t = new BacTable({ maxBet: 1000, maxSide: 1000 });
  t.join('a', 'Ann'); t.join('b', 'Bob');
  t.bet('a', 'player', 100); t.bet('a', 'tie', 10); t.bet('b', 'banker', 50);
  t.deal();
  while (t.phase === 'peel') t.finish?.();
  const st = t.publicState('a'), e = BL.bankEntry(st, (k) => k, 'r');
  ok(e && e.rows.length >= 2 && e.rows.find((x) => x.who === 'Ann').did.includes('tie 10'), 'baccarat spots: ' + JSON.stringify(e?.rows));
  ok(e.rows.find((x) => x.who === 'Ann').net === st.pays.a.net, 'baccarat +/-');
}
{
  const t = new RouTable({});
  t.join('a', 'Ann'); t.bet('a', 'red', 20); t.bet('a', 'n17', 5);
  t.closeBets(); t.doSpin();
  const st = t.publicState('a'), e = BL.bankEntry(st, (k) => k, `${st.spin.n}`);
  const row = e.rows.find((x) => x.who === 'Ann');
  ok(row.did.includes('red 20') && row.did.includes('n17 5') && row.net === st.pays.a.net && row.bet === 25, 'roulette spots: ' + row.did);
}
console.log('betlog: ' + n + ' checks passed');
