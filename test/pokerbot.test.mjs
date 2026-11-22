// Computer players: many hands with bots only. Every move must be a legal one and no chip may appear or vanish.
import { PokerTable } from '../js/poker.js';
import { botMove, botMoveEasy, isBot } from '../js/pokerbot.js';
import { botMoveHard, equity, cardInt, parseRange } from '../js/pokergto.js';
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
PokerTable.noChances = true;
const count = { fold: 0, check: 0, call: 0, bet: 0, raise: 0 };
const times = [];
let hardMoves = 0, hardNull = 0;
// Easy bots, then hard bots, in Hold'em, Omaha (the hard bot lets the easy one play) and with two boards.
for (const level of ['easy', 'hard']) for (const game of [{}, { game: 'plo' }, { doubleBoard: true }, { straddle: true, ante: 1, bombPotEvery: 7 }]) {
  if (level === 'easy' && game.straddle) continue;
  const t = new PokerTable({ ...game, turnTimer: 0, botLevel: level });
  ok(t.settings.botLevel === level, 'bot level setting kept');
  for (let k = 0; k < 7; k++) { t.join('bot-' + k, 'Bot ' + k); t.sit('bot-' + k, k, 300); if (game.straddle) t.seats[k].straddle = true; }
  let bought = 0;
  for (let h = 0; h < 500; h++) {
    // Hard bots also play short and deep stacks.
    for (const x of t.seats) if (x && x.stack <= 0) { const a = level === 'hard' ? [20, 60, 300, 900][h % 4] : 300; t.addChips(x.id, a); bought += a; }
    if (!t.canStart()) break;
    t.startHand();
    let guard = 0;
    while (t.inHand() && guard++ < 400) {
      if (t.runAsk && !t.runAsk.done) { const a = t.runAsk; if (!a.n) t.runPick(t.seats[a.by].id, 1); else t.runAnswer(t.seats[a.need.find((q) => !a.yes.includes(q))].id, true); continue; }
      const id = t.seats[t.turn].id;
      let m;
      if (level === 'hard') {
        const a = performance.now();
        m = botMove(t, id);
        times.push(performance.now() - a);
        if (!t.plo && !t.dbl) { const h2 = botMoveHard(t, id); if (h2) hardMoves++; else hardNull++; }
      } else m = botMove(t, id);
      ok(isBot(id) && m, 'a bot has a move on its turn');
      try { t.act(id, m.a, m.amount); count[m.a]++; } catch (e) { ok(false, `illegal move ${JSON.stringify(m)}: ${e.message}`); t.act(id, t.options(id).canCheck ? 'check' : 'fold'); }
    }
    ok(!t.inHand(), 'the hand ends');
    ok(t.chipsTotal() === 7 * 300 + bought, `chips kept: ${t.chipsTotal()} / ${7 * 300 + bought}`);
  }
}
ok(t0().settings.botLevel === 'easy', 'bots are easy by default');
ok(t0({ botLevel: 'expert' }).settings.botLevel === 'easy', 'an unknown bot level is easy');
function t0(s = {}) { return new PokerTable(s); }
ok(hardMoves > 1000 && hardNull === 0, `the hard bot plays every Hold'em move itself (${hardMoves} moves, ${hardNull} left to the easy bot)`);
times.sort((a, b) => a - b);
const p99 = times[Math.floor(times.length * 0.99)], avg = times.reduce((a, b) => a + b, 0) / times.length;
console.log(`hard bot think time: average ${avg.toFixed(2)} ms, 99% under ${p99.toFixed(1)} ms, slowest ${times.at(-1).toFixed(1)} ms`);
ok(p99 < 50, 'hard bot decides in under 50 ms');

// Equity against ranges.
const C = (s) => s.split(' ').map((x) => cardInt({ r: x.slice(0, -1), s: { s: '♠', h: '♥', d: '♦', c: '♣' }[x.slice(-1)] }));
const anyHand = (dead) => { const w = []; let sum = 0; for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) { if (!dead.includes(a) && !dead.includes(b)) sum++; w.push(sum); } return Float64Array.from(w); };
{
  const aa = C('As Ah'), e = equity(aa, [], [anyHand(aa)], 4000, 5);
  ok(Math.abs(e - 0.85) < 0.03, `aces against any hand: ${e}`);
  const s72 = C('7s 2h'), e2 = equity(s72, [], [anyHand(s72)], 4000, 5);
  ok(Math.abs(e2 - 0.35) < 0.03, `seven two against any hand: ${e2}`);
  const nut = C('As Ks'), b = C('Qs Js Ts'), e3 = equity(nut, b, [anyHand([...nut, ...b])], 500, 5);
  ok(e3 === 1, 'a royal flush always wins');
  const r = parseRange('77+, A2s+, KTs+, 99-66, AJo+');
  ok(r.reduce((a, x) => a + (x > 0), 0) === 9 + 12 + 3 + 3, 'range notation');
}

// Fairness: a hard bot's move never depends on the other players' cards or the deck.
{
  const t = new PokerTable({ turnTimer: 0, botLevel: 'hard', sevenDeuce: 0 });
  for (let k = 0; k < 6; k++) { t.join('bot-' + k, 'Bot ' + k); t.sit('bot-' + k, k, 300); t.seats[k].runs = 1; }
  PokerTable.autoRun = true;
  let checked = 0;
  for (let h = 0; h < 200; h++) {
    for (const x of t.seats) if (x && x.stack < 300) x.stack = 300;
    t.startHand();
    let guard = 0;
    while (t.inHand() && t.turn !== null && guard++ < 200) {
      const id = t.seats[t.turn].id, me = t.turn;
      const seeded = (s) => () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
      const m1 = botMoveHard(t, id, seeded(h * 977 + guard + 1));
      // Give everyone else other cards and shuffle the deck, then ask again with the same random numbers.
      const keep = t.seats.map((x) => x && x.cards), deck = t.deck;
      const used = new Set([...t.seats[me].cards, ...t.board].map((c) => c.r + c.s));
      const rest = deck.filter((c) => !used.has(c.r + c.s)).concat(t.seats.flatMap((x, i) => (x && i !== me ? x.cards : []))).filter((c) => !used.has(c.r + c.s));
      for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
      t.seats.forEach((x, i) => { if (x && i !== me && x.cards.length) x.cards = [rest.pop(), rest.pop()]; });
      t.deck = rest;
      const m2 = botMoveHard(t, id, seeded(h * 977 + guard + 1));
      t.seats.forEach((x, i) => { if (x) x.cards = keep[i]; });
      t.deck = deck;
      ok(JSON.stringify(m1) === JSON.stringify(m2), `same move whatever the other cards: ${JSON.stringify(m1)} / ${JSON.stringify(m2)}`);
      checked++;
      const m = m1 || botMoveEasy(t, id);
      t.act(id, m.a, m.amount);
    }
  }
  ok(checked > 500, `fairness checked on ${checked} moves`);
}

// Hard bots against easy bots, every hand from 100 big blinds: the hard ones must win.
function match(seats, hands) {
  const t = new PokerTable({ turnTimer: 0, sevenDeuce: 0, smallBlind: 1, bigBlind: 2 });
  for (let k = 0; k < seats; k++) { t.join('bot-' + k, 'Bot ' + k); t.sit('bot-' + k, k, 200); t.seats[k].runs = 1; }
  const hard = (k) => k % 2 === 0, net = Array(seats).fill(0);
  PokerTable.autoRun = true;
  for (let h = 0; h < hands; h++) {
    for (let k = 0; k < seats; k++) { net[k] += t.seats[k].stack - 200; t.seats[k].stack = 200; }
    t.startHand();
    let guard = 0;
    while (t.inHand() && guard++ < 400) {
      const id = t.seats[t.turn].id, k = t.turn;
      const m = (hard(k) && botMoveHard(t, id)) || botMoveEasy(t, id);
      try { t.act(id, m.a, m.amount); } catch (e) { ok(false, `illegal move in a match ${JSON.stringify(m)}: ${e.message}`); t.act(id, t.options(id).canCheck ? 'check' : 'fold'); }
    }
    ok(!t.inHand(), 'match hand ends');
  }
  for (let k = 0; k < seats; k++) net[k] += t.seats[k].stack - 200;
  PokerTable.autoRun = false;
  const sum = (f) => net.filter((_, k) => f(k)).reduce((a, b) => a + b, 0);
  const per = seats / 2, bb100 = (v) => ((v / per / 2) / hands) * 100;
  ok(sum(() => true) === 0, 'match chips kept');
  return { hard: bb100(sum(hard)), easy: bb100(sum((k) => !hard(k))) };
}
const hu = match(2, 3000), six = match(6, 4000);
console.log(`heads up, 3000 hands: hard ${hu.hard.toFixed(1)} bb/100, easy ${hu.easy.toFixed(1)} bb/100`);
console.log(`6 max (3 hard, 3 easy), 4000 hands: hard ${six.hard.toFixed(1)} bb/100, easy ${six.easy.toFixed(1)} bb/100`);
ok(hu.hard > 0 && six.hard > 0, 'hard bots beat easy bots');

console.log('moves', JSON.stringify(count));
console.log(`${n - fails}/${n} bot checks passed`);
process.exit(fails ? 1 : 0);
