// Locked cards for poker: the host's table never knows a player's cards, folded cards never open,
// the showdown follows cash game order, and every hand still ends with the right chips.
import { PokerTable, mpClientMoves, mpMine, mpCheck, cardText } from '../js/poker.js';
import { plainDeck, shufflePass, lockPass } from '../js/mental.js';
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
PokerTable.autoRun = true; PokerTable.noChances = true;

// A table with human players (they hold locks) and computer players (they do not).
function mk(humans, bots = [], stacks = 1000, settings = {}) {
  const t = new PokerTable({ smallBlind: 5, bigBlind: 10, sevenDeuce: 0, turnTimer: 0, ...settings });
  let s = 0;
  for (const id of humans) { t.join(id, id.toUpperCase()); t.sit(id, s, Array.isArray(stacks) ? stacks[s] : stacks); t.setRuns(id, 1); s++; }
  for (const id of bots) { t.join(id, id.toUpperCase()); t.sit(id, s, Array.isArray(stacks) ? stacks[s] : stacks); t.setRuns(id, 1); s++; }
  t.hostId = humans[humans.length - 1];
  return t;
}
// Every browser locks and shuffles in turn, then puts a lock per card on.
function lockDeck(parts) {
  const sid = 'h' + Math.random().toString(16).slice(2, 8), A = {}, sec = {};
  let deck = plainDeck();
  for (const p of parts) { const r = shufflePass(deck); deck = r.deck; A[p] = r.a; }
  for (const p of parts) { const r = lockPass(deck, A[p]); deck = r.deck; sec[p] = { sid, b: r.b }; }
  return { mp: { sid, deck, parts }, sec };
}
// The browsers answer what the table asks, until nothing more happens.
function pump(t, parts, sec, sent, mine) {
  for (let round = 0; round < 50; round++) {
    let any = false;
    for (const id of parts) {
      const st = JSON.parse(JSON.stringify(t.publicState(id)));
      const c = mpMine(st, id, sec[id]);
      if (c && !c.bad) mine[id] = c;
      const me = st.seats.findIndex((x) => x && x.id === id);
      if (me >= 0 && mine[id]) st.seats[me].cards = mine[id];
      for (const m of mpClientMoves(st, id, sec[id], mine[id], sent[id])) {
        any = true;
        if (m.t === 'mp-keys') t.mpKeys(id, m.keys);
        if (m.t === 'mp-muck') t.mpMuck(id);
      }
    }
    if (t.mpResume()) any = true;
    if (!any) return;
  }
  throw new Error('pump did not settle');
}
function play(t, parts, sec, pick) {
  const sent = Object.fromEntries(parts.map((p) => [p, new Set()])), mine = {};
  for (let step = 0; step < 400 && t.phase !== 'done'; step++) {
    pump(t, parts, sec, sent, mine);
    if (t.phase === 'done') break;
    if (t.runAsk && !t.runAsk.done) { t.runTimeout(); continue; }
    if (t.turn === null) { if (t.mp?.need) throw new Error('stuck on ' + t.mp.need.kind); continue; }
    const id = t.seats[t.turn].id, o = t.options(id);
    const a = pick(t, id, o);
    t.act(id, a[0], a[1]);
  }
  pump(t, parts, sec, sent, mine);
  return { sent, mine };
}
const total = (t) => t.chipsTotal();

// 1. Three players and a computer player check it down: the host's table never holds a player's cards.
{
  const parts = ['a', 'b', 'h'], t = mk(parts, ['bot1']), before = total(t);
  const { mp, sec } = lockDeck(parts);
  t.startHand({ mp });
  ok(t.seats.slice(0, 3).every((x) => x.cards.every(PokerTable.hid)), 'players\' cards are locked places on the host');
  const sent = Object.fromEntries(parts.map((p) => [p, new Set()])), mine = {};
  pump(t, parts, sec, sent, mine);
  ok(t.known(3), 'the computer player\'s cards open on the host');
  ok(t.seats.slice(0, 3).every((x) => x.cards.every(PokerTable.hid)), 'after the keys go round, players\' cards are still closed on the host');
  ok(parts.every((p) => mine[p] && mine[p].length === 2), 'each player opens their own two cards');
  const all = [...parts.flatMap((p) => mine[p]), ...t.seats[3].cards].map(cardText);
  ok(new Set(all).size === 8, 'eight different hole cards');
  const r = play(t, parts, sec, (tt, id, o) => [o.canCheck ? 'check' : 'call']);
  ok(t.phase === 'done' && t.board.length === 5, 'the hand is played to the river');
  ok(new Set([...all, ...t.board.map(cardText)]).size === 13, 'board and hands are all different cards');
  ok(total(t) === before, 'chips stay the same in total');
  const live = t.seats.filter((x) => x && x.inHand && !x.folded);
  ok(live.every((x) => x.show), 'every hand still in at the end was shown');
  const mucked = t.seats.filter((x) => x && x.mucked);
  ok(mucked.every((x) => x.cards.every(PokerTable.hid) || !parts.includes(x.id)), 'a mucked player\'s cards never open on the host');
  ok(mpCheck(t.publicState('a')) === 0, 'every public card matches its locks');
  void r;
}

// 2. A folded player's cards never open anywhere, also when everyone else shows down.
{
  const parts = ['a', 'b', 'h'], t = mk(parts), before = total(t);
  const { mp, sec } = lockDeck(parts);
  t.startHand({ mp });
  const foldId = t.seats[t.turn].id;
  const { mine } = play(t, parts, sec, (tt, id, o) => [id === foldId ? 'fold' : o.canCheck ? 'check' : 'call']);
  const fi = t.seatOf(foldId);
  ok(t.seats[fi].cards.every(PokerTable.hid), 'the folded cards stay locked on the host');
  ok((t.mp.hole[fi] || []).every((k) => !t.mp.open[k]), 'the folded places were never opened');
  const others = parts.filter((p) => p !== foldId);
  for (const p of others) { const st = t.publicState(p); ok(st.seats[fi].cards.every((c) => c === null), 'nobody is told the folded cards: ' + p); }
  ok(JSON.stringify(t.publicState('h')).indexOf(cardText(mine[foldId][0])) === -1 || t.board.concat(t.seats.flatMap((x) => (x && x.show ? x.cards : []))).some((c) => cardText(c) === cardText(mine[foldId][0])), 'the folded card is nowhere in what the host is told');
  ok(total(t) === before, 'chips stay the same in total');
}

// 3. Showdown order: the river bettor who is called shows first; a beaten hand after that is thrown away face down.
{
  let tried = 0, sawMuck = false, sawOrder = true;
  for (let g = 0; g < 60 && tried < 25; g++) {
    const parts = ['a', 'b', 'h'], t = mk(parts), before = total(t);
    const { mp, sec } = lockDeck(parts);
    t.startHand({ mp });
    let bettor = null;
    play(t, parts, sec, (tt, id, o) => {
      if (tt.phase === 'river' && bettor === null && o.canRaise) { bettor = id; return ['raise', o.minTo]; }
      return [o.canCheck ? 'check' : 'call'];
    });
    if (bettor === null) continue;
    tried++;
    const lines = t.log.map((l) => l.text || l).join('\n');
    const bi = t.seatOf(bettor);
    ok(t.seats[bi].show, 'the river bettor shows');
    if (t.seats.filter((x) => x && x.inHand && !x.folded).length + t.seats.filter((x) => x && x.mucked).length > 1 && t.mp.shownOrder?.[0] !== bi) sawOrder = false;
    if (/mucks/.test(lines)) sawMuck = true;
    for (const x of t.seats) if (x && x.mucked) ok(x.cards.every(PokerTable.hid), 'a mucked hand stays locked');
    ok(total(t) === before, 'chips stay the same in total');
  }
  ok(tried > 5, 'enough hands with a river bet: ' + tried);
  ok(sawOrder, 'the river bettor is the first to show');
  ok(sawMuck, 'a beaten hand is mucked at least once');
}

// 4. All in before the flop: hands turn face up, the board comes, the pot is paid.
{
  const parts = ['a', 'h'], t = mk(parts, ['bot1'], [300, 1000, 500]), before = total(t);
  const { mp, sec } = lockDeck(parts);
  t.startHand({ mp });
  play(t, parts, sec, (tt, id, o) => (o.canRaise ? ['raise', o.maxTo] : [o.canCheck ? 'check' : 'call']));
  ok(t.phase === 'done' && t.board.length === 5, 'all in hand runs out');
  ok(total(t) === before, 'chips stay the same in total');
  ok(t.seats.filter((x) => x && x.inHand && !x.folded).every((x) => x.show && t.known(t.seats.indexOf(x))), 'all in hands are face up');
  ok(mpCheck(t.publicState('a')) === 0, 'public cards match their locks');
}

// 5. Run it twice with locked cards.
{
  const parts = ['a', 'b'], t = mk(parts, [], [500, 500]), before = total(t);
  t.hostId = 'b'; t.settings.runTimes = 2; t.seats[0].runs = 2; t.seats[1].runs = 2;
  const { mp, sec } = lockDeck(parts);
  t.startHand({ mp });
  play(t, parts, sec, (tt, id, o) => (o.canRaise ? ['raise', o.maxTo] : [o.canCheck ? 'check' : 'call']));
  ok(t.phase === 'done', 'run twice hand ends');
  ok(total(t) === before, 'chips stay the same in total');
  const used = [...t.board, ...(t.boards ? t.boards.slice(1).flat().slice(t.runBase?.length || 0) : []), ...t.seats.flatMap((x) => (x ? x.cards : []))].map(cardText);
  ok(t.runs !== 2 || new Set(used).size === used.length, 'no card twice');
}

// 6. Rabbit hunt after everyone folds to a bet on the flop.
{
  const parts = ['a', 'h'], t = mk(parts);
  const { mp, sec } = lockDeck(parts);
  t.startHand({ mp });
  const sent = Object.fromEntries(parts.map((p) => [p, new Set()])), mine = {};
  let raised = false;
  for (let s = 0; s < 50 && t.phase !== 'done'; s++) {
    pump(t, parts, sec, sent, mine);
    if (t.turn === null) continue;
    const id = t.seats[t.turn].id, o = t.options(id);
    if (t.phase === 'flop' && !raised && o.canRaise) { raised = true; t.act(id, 'raise', o.minTo); } else if (raised) t.act(id, 'fold'); else t.act(id, o.canCheck ? 'check' : 'call');
  }
  ok(t.phase === 'done' && t.board.length === 3, 'hand ended on the flop');
  t.rabbitHunt('a');
  ok(t.mp.need?.kind === 'rabbit', 'rabbit hunt waits for the keys');
  pump(t, parts, sec, sent, mine);
  ok(t.rabbit && t.rabbit.length === 2, 'rabbit cards open once every browser gave its keys');
  ok(new Set([...t.board, ...t.rabbit, ...parts.flatMap((p) => mine[p])].map(cardText)).size === 9, 'rabbit cards are new cards');
}

// 7. A browser that never answers: the showdown throws its hand away, a missing board key ends in a fresh deal.
{
  const parts = ['a', 'b', 'h'], t = mk(parts), before = total(t);
  const { mp, sec } = lockDeck(parts);
  t.startHand({ mp });
  const sent = Object.fromEntries(parts.map((p) => [p, new Set()])), mine = {};
  pump(t, parts, sec, sent, mine);
  // b goes silent from now on.
  const here = ['a', 'h'];
  for (let s = 0; s < 200 && t.phase !== 'done'; s++) {
    pump(t, here, sec, sent, mine);
    if (t.mp?.need) { t.mpTimeout(); continue; }
    if (t.turn === null) continue;
    const id = t.seats[t.turn].id, o = t.options(id);
    t.act(id, id === 'b' ? (o.canCheck ? 'check' : 'fold') : o.canCheck ? 'check' : 'call');
  }
  ok(t.phase === 'done', 'the hand still ends with a silent browser');
  ok(total(t) === before, 'chips stay the same in total');
  const used = [...t.board, ...t.seats.flatMap((x) => (x ? x.cards.filter((c) => !PokerTable.hid(c)) : []))].map(cardText);
  ok(new Set(used).size === used.length, 'no card twice after the fresh deal');
}

// 8. Many hands with random play: chips, no stuck hands, no card twice, folded cards never open.
{
  let hands = 0;
  for (let g = 0; g < 40; g++) {
    const nh = 2 + (g % 3), parts = ['a', 'b', 'c', 'd'].slice(0, nh - 1).concat('h'), bots = g % 2 ? ['bot1'] : [];
    const t = mk(parts, bots, 400 + (g % 5) * 150, { doubleBoard: g % 7 === 3, game: g % 5 === 4 ? 'plo' : 'holdem' });
    for (let hnd = 0; hnd < 4 && t.canStart(); hnd++) {
      const before = total(t);
      const { mp, sec } = lockDeck(parts);
      t.startHand({ mp });
      play(t, parts, sec, (tt, id, o) => { const r = Math.random(); if (r < 0.15 && !o.canCheck) return ['fold']; if (r < 0.3 && o.canRaise) return ['raise', Math.min(o.maxTo, o.minTo + Math.floor(Math.random() * 40))]; return [o.canCheck ? 'check' : 'call']; });
      hands++;
      ok(t.phase === 'done', 'random hand ends');
      ok(total(t) === before, 'random hand keeps the chips');
      for (const x of t.seats) if (x && x.inHand && x.folded && parts.includes(x.id)) ok(x.cards.every(PokerTable.hid), 'folded human cards stay locked');
      const used = [...t.board, ...(t.board2 || []), ...t.seats.flatMap((x) => (x ? x.cards.filter((c) => !PokerTable.hid(c)) : []))].map(cardText);
      ok(new Set(used).size === used.length, 'no card twice');
      ok(!t.mp.bad, 'every opened card matched');
      t.clearHand();
    }
  }
  ok(hands > 100, 'played random hands: ' + hands);
}
console.log(`${n - fails}/${n} locked card checks passed`);
process.exit(fails ? 1 : 0);
