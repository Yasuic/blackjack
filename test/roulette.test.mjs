import { RouTable, betNumbers, betPays, spinNumber, verifySpin, colorOf, RED, WHEEL, isOutside } from '../js/roulette.js';
let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log('FAIL', m); } };
// the layout
ok(RED.size === 18 && [...RED].every((x) => x >= 1 && x <= 36), '18 red numbers');
ok(colorOf(0) === 'green' && colorOf(1) === 'red' && colorOf(2) === 'black' && colorOf(17) === 'black' && colorOf(36) === 'red', 'colours');
ok(WHEEL.length === 37 && new Set(WHEEL).size === 37 && WHEEL[0] === 0, 'wheel has every pocket once');
// on a real wheel red and black alternate all the way round
ok(WHEEL.slice(1).every((x, i, a) => i === 0 || colorOf(x) !== colorOf(a[i - 1])), 'red and black alternate on the wheel');
const len = (k) => betNumbers(k)?.length;
ok(len('n0') === 1 && len('n36') === 1 && betNumbers('n37') === null && betNumbers('n-1') === null, 'straight');
ok(len('red') === 18 && len('black') === 18 && len('odd') === 18 && len('even') === 18 && len('low') === 18 && len('high') === 18, 'even money bets cover 18');
ok(!betNumbers('red').includes(0) && !betNumbers('even').includes(0) && !betNumbers('low').includes(0), 'zero is in no outside bet');
ok(['d1', 'd2', 'd3', 'c1', 'c2', 'c3'].every((k) => len(k) === 12), 'dozens and columns cover 12');
ok(betNumbers('c3').includes(36) && betNumbers('c1').includes(34) && betNumbers('d2').join() === '13,14,15,16,17,18,19,20,21,22,23,24', 'columns and dozens');
ok(betNumbers('s-17-18').join() === '17,18' && betNumbers('s-17-20').join() === '17,20' && betNumbers('s-18-19') === null && betNumbers('s-0-2').join() === '0,2' && betNumbers('s-0-4') === null && betNumbers('s-17-19') === null, 'splits must touch');
ok(betNumbers('st-16').join() === '16,17,18' && betNumbers('st-17') === null && betNumbers('co-16').join() === '16,17,19,20' && betNumbers('co-18') === null && betNumbers('co-34') === null && betNumbers('li-31').join() === '31,32,33,34,35,36' && betNumbers('li-34') === null, 'street, corner, six line');
ok(betPays('n5') === 35 && betPays('s-1-2') === 17 && betPays('st-1') === 11 && betPays('co-1') === 8 && betPays('li-1') === 5 && betPays('d1') === 2 && betPays('red') === 1, 'payouts 35, 17, 11, 8, 5, 2, 1');
ok(isOutside('red') && isOutside('c2') && !isOutside('n4') && !isOutside('s-1-2'), 'outside or inside');
ok(betNumbers('__proto__') === null && betNumbers('constructor') === null && betNumbers('') === null, 'odd keys are refused');
// the spin: same seeds give the same number, every pocket about equally often
ok(spinNumber('abc', { a: '1' }) === spinNumber('abc', { a: '1' }) && [0, 1, 2, 3, 4].some((i) => spinNumber('abc' + i, {}) !== spinNumber('abc', {})), 'the number comes from the seeds');
{
  const cnt = new Array(37).fill(0), N = 74000;
  for (let i = 0; i < N; i++) cnt[spinNumber('seed' + i, { p: 'x' + (i % 7) })]++;
  const e = N / 37, chi = cnt.reduce((a, c) => a + (c - e) ** 2 / e, 0);
  ok(chi < 67, 'pockets are even (chi-square, fair is near 36, limit 67): ' + chi.toFixed(1));
  console.log('pocket chi-square (fair is near 36, limit 67):', chi.toFixed(1));
}
// the table
{
  const t = new RouTable({ maxInside: 50, maxOutside: 200 });
  t.join('a', 'Ann'); t.join('b', 'Bob');
  let thr = 0;
  t.bet('a', 'n17', 30); t.bet('a', 'n17', 30); ok(t.bets.a.n17 === 50 && t.players.a.chips === 950, 'inside bet capped');
  t.bet('a', 'red', 500); ok(t.bets.a.red === 200, 'outside bet capped');
  for (const bad of [['nope', 5], ['n17', -3], ['n17', NaN], ['s-1-9', 5]]) { try { t.bet('b', bad[0], bad[1]); } catch { thr++; } }
  ok(thr === 4, 'bad bets refused');
  t.bet('b', 'black', 10); t.unbet('b', 'black'); ok(t.players.b.chips === 1000 && !t.bets.b, 'a bet taken back');
  ok(!JSON.stringify(t.publicState('b')).includes(t.fair.next.seed), 'the seed of the coming spin is not told');
  t.setClientSeed('b', 'bobseed', t.fair.next.commit);
  const before = t.chipsTotal();
  t.doSpin();
  const pay = t.pays.a, num = t.spin.n;
  const want = (num === 17 ? 50 * 36 : 0) + (RED.has(num) ? 400 : 0);
  ok(pay.back === want && t.chipsTotal() === before - 250 + want, 'paid by the rules: ' + num + ' back ' + pay.back);
  ok(verifySpin(t.spins[0]).ok && t.spins[0].clientSeeds.b === 'bobseed', 'the spin checks against its seeds, with the player seed in');
  ok(!verifySpin({ ...t.spins[0], n: (num + 1) % 37 }).ok, 'a changed number fails the check');
  try { t.bet('a', 'red', 5); } catch { thr++; } ok(thr === 5, 'no bets while the ball rolls');
  t.next(); t.rebet('a'); ok(t.bets.a.n17 === 50 && t.bets.a.red === 200, 'rebet');
  const m = RouTable.fromPublic(JSON.parse(JSON.stringify(t.publicState('b'))), 'b');
  ok(m.chipsTotal() === t.chipsTotal() && m.bets.a.red === 200 && m.hostId === 'b', 'moved table keeps chips and bets');
  m.doSpin(); ok(m.phase === 'done' && verifySpin(m.spins[m.spins.length - 1]).ok, 'moved table spins');
}
// many spins: every bet type returns about 36/37 of what is staked (house edge 2.7%)
{
  const t = new RouTable({ maxInside: 1e6, maxOutside: 1e6, startChips: 1e9 });
  const keys = ['n7', 's-8-11', 'st-4', 'co-22', 'li-13', 'd2', 'c3', 'red', 'odd'];
  keys.forEach((k, i) => t.join('p' + i, 'P' + i));
  const net = keys.map(() => 0), N = 40000;
  for (let r = 0; r < N; r++) {
    keys.forEach((k, i) => t.bet('p' + i, k, 36));
    const before = t.chipsTotal();
    t.doSpin();
    const paid = Object.values(t.pays).reduce((a, p) => a + p.net, 0);
    if (Math.abs(t.chipsTotal() - before - paid) > 0.001) { ok(false, 'chips changed by something other than the payouts'); break; }
    keys.forEach((k, i) => { net[i] += t.pays['p' + i].net; });
    t.next();
  }
  keys.forEach((k, i) => { const edge = -net[i] / (N * 36); const tol = [0.09, 0.07, 0.055, 0.045, 0.04, 0.025, 0.025, 0.018, 0.018][i]; ok(Math.abs(edge - 1 / 37) < tol, `house edge on ${k} near 2.7%: ${(edge * 100).toFixed(2)}%`); });
}
{ // the wheel animation: the ball always ends in the pocket of the spin's number, with no jumps on the way
  const { wheelState } = await import('../js/wheel.js');
  const TAU = Math.PI * 2, norm = (a) => ((a % TAU) + TAU) % TAU;
  let endOk = true, smooth = true, rimFirst = true;
  for (let n = 0; n <= 36; n++) for (const seed of [1, 2, 57, 1234]) {
    const T = 9, e = wheelState(n, seed, T, T), at = norm(e.ball - e.wheel), want = WHEEL.indexOf(n) * TAU / 37;
    if (Math.min(Math.abs(at - want), TAU - Math.abs(at - want)) > 1e-6 || e.r > 0.6) endOk = false;
    if (wheelState(n, seed, 0.1, T).r < 0.85) rimFirst = false;
    let prev = wheelState(n, seed, 0, T);
    for (let t = 0.005; t <= T; t += 0.005) { const s = wheelState(n, seed, t, T); if (Math.abs(s.ball - prev.ball) > 0.08 || Math.abs(s.r - prev.r) > 0.02) smooth = false; prev = s; }
  }
  ok(endOk, 'the ball ends in the pocket of the number, every number'); ok(smooth, 'the ball never jumps'); ok(rimFirst, 'the ball starts on the rim');
  const a = wheelState(17, 5, 4.2, 9), b = wheelState(17, 5, 4.2, 9); ok(a.ball === b.ball && a.wheel === b.wheel, 'the same spin looks the same on every screen');
}

{ // the spin starts only when every seated player who is online has pressed Spin
  const t = new RouTable(); t.join('a', 'Ann'); t.join('b', 'Bob'); t.join('c', 'Cat');
  let threw = false; try { t.pressSpin('a'); } catch { threw = true; } ok(threw, 'Spin cannot be pressed with no bet on the table');
  t.bet('a', 'red', 10);
  ok(t.pressSpin('a') === false && t.phase === 'betting', 'one press of three does not start the spin');
  ok(t.publicState('b').waiting.join() === 'b,c', 'the table says who has not pressed');
  t.pressSpin('b'); ok(t.phase === 'betting', 'two presses of three do not start the spin');
  t.pressSpin('b'); ok(!t.ready.b && t.phase === 'betting', 'a second press takes the press back');
  t.pressSpin('b'); t.pressSpin('c'); ok(t.phase === 'done' && t.round === 1, 'the spin starts when all three have pressed');
  ok(Object.keys(t.ready).length === 0, 'the presses are cleared after the spin');
  t.next(); t.bet('b', 'n7', 5); t.pressSpin('a'); t.pressSpin('b');
  t.disconnect('c'); ok(t.phase === 'done' && t.round === 2, 'a player who goes offline is not waited for');
  t.next(); t.join('c', 'Cat'); t.bet('a', 'odd', 5); t.pressSpin('a'); t.pressSpin('b'); ok(t.phase === 'betting', 'a player who is back online must press again');
  t.clearBets('a'); t.spinIfAll(); ok(Object.keys(t.ready).length === 0, 'with no bet left on the table the presses are cleared');
  t.bet('a', 'odd', 5); t.pressSpin('a'); t.pressSpin('b'); t.kick('c'); ok(t.phase === 'done' && t.round === 3, 'a removed player is not waited for');
  { const q = new RouTable(); q.join('a', 'Ann'); q.join('b', 'Bob'); q.bet('a', 'red', 5); q.pressSpin('a'); q.setQuiet('b', true); ok(q.phase === 'done', 'a player whose browser went silent is not waited for'); q.next(); q.setQuiet('b', false); q.bet('a', 'red', 5); q.pressSpin('a'); ok(q.phase === 'betting', 'once heard again, that player must press'); }
  const u = RouTable.fromPublic((() => { const x = new RouTable(); x.join('a', 'Ann'); x.join('b', 'Bob'); x.bet('a', 'red', 5); x.pressSpin('a'); return x.publicState('b'); })(), 'b');
  ok(u.ready.a === true && u.phase === 'betting', 'presses survive a move of the table to another browser');
}
{ const { bankChecks } = await import('./bank.helper.mjs'); bankChecks(ok, RouTable, ['red', 'n17', 'd2', 'c3', 'odd', 'n0'], 'canSpin', 'doSpin'); }
console.log(`${n - fails}/${n} roulette checks passed`);
process.exit(fails ? 1 : 0);
