// Fewer seats than players: seats are taken from whoever holds the most first, then from the highest seat numbers.
import { Table } from '../js/game.js';
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL', m); } };
const who = (t) => t.seats.map((s) => (s ? s.playerId : '-')).join('');
{
  const t = new Table({}); for (const id of 'abc') t.join(id, id.toUpperCase(), 1000);
  t.sit('a', 0); t.sit('a', 1, true); t.sit('a', 2, true); t.sit('b', 3); t.sit('b', 4, true); t.sit('c', 6);
  t.setBet('a', { main: 10, sides: {}, ready: true, seat: 2 });
  t.updateSettings({ seats: 4 });
  ok(t.seats.length === 4, '7 -> 4 seats');
  ok(t.seatsOf('a').length === 1 && t.seatsOf('b').length === 2 && t.seatsOf('c').length === 1 || t.seatsOf('a').length === 2 && t.seatsOf('b').length === 1, 'the biggest holders gave up seats: ' + who(t));
  ok(['a', 'b', 'c'].every((id) => t.seatsOf(id).length >= 1), 'nobody lost their last seat while others still held two: ' + who(t));
  ok(Object.values(t.players).every((p) => p.chips === 1000), 'no chips moved');
  console.log('  ', who(t), '|', t.log.slice(-1)[0]);
  t.updateSettings({ seats: 2 });
  ok(t.seats.filter(Boolean).length === 2 && t.seatsOf('a').length === 1 && t.seatsOf('b').length + t.seatsOf('c').length === 1, 'a gives up a second seat first, then the highest seat stands up: ' + who(t));
  console.log('  ', who(t), '|', t.log.slice(-1)[0]);
  t.updateSettings({ seats: 5 }); ok(t.seats.length === 5 && who(t) === t.seats.slice(0, 2).map((s) => s.playerId).join('') + '---', 'growing adds empty seats at the end');
}
{
  const t = new Table({}); for (const id of 'ab') t.join(id, id.toUpperCase(), 1000);
  t.sit('a', 5); t.sit('b', 6);
  t.updateSettings({ seats: 3 });
  ok(t.seats.length === 3 && t.seatsOf('a').length === 1 && t.seatsOf('b').length === 1, 'enough room: everyone moves down, nobody loses a seat: ' + who(t));
}
{ // mid round: waits for the round to end
  const t = new Table({}); for (const id of 'ab') t.join(id, id.toUpperCase(), 1000);
  t.sit('a', 0); t.sit('b', 1); t.setFrozen(true);
  for (const id of 'ab') t.setBet(id, { main: 10, sides: {}, ready: true, seat: t.seatsOf(id)[0] });
  t.deal();
  if (t.inRound()) { t.applySettings({ seats: 1 }); ok(t.seats.length === 7 && t.pendingSettings?.seats === 1, 'in a round the change waits ' + t.seats.length + ' ' + JSON.stringify(t.pendingSettings)); }
  else ok(true, 'round ended at once (blackjack), skip');
}
{ // votes: a seat count change passes with all but one yes; other settings still need everyone
  const t = new Table({}); for (const id of 'habcd') t.join(id, id, 1000); for (const p of Object.values(t.players)) p.connected = true;
  t.sit('a', 0); t.sit('b', 1); t.sit('c', 2); t.sit('d', 3);
  t.proposeSettings('h', { seats: 2 }); ok(t.vote && t.vote.need === 3, 'seat vote needs 3 of 4');
  t.castVote('a', true); t.castVote('b', false); ok(!!t.vote, 'one no does not end a seat vote');
  t.castVote('c', true); t.castVote('d', true); ok(!t.vote && t.seats.length === 2, 'three yes of four: seats change, d away does not block');
  t.proposeSettings('h', { seats: 3 }); t.castVote('a', false); t.castVote('b', false); ok(!t.vote && t.seats.length === 2, 'two no: the seat vote fails');
  t.proposeSettings('h', { seats: 3 }); t.castVote('a', true); t.castVote('b', true); t.castVote('c', true); const id = t.vote?.id;
  ok(!t.vote && t.seats.length === 3, 'enough yes before time runs out');
  t.proposeSettings('h', { minBet: 7 }); ok(t.vote && t.vote.need === 4, 'other settings still need everyone');
  t.castVote('a', false); ok(!t.vote && t.settings.minBet !== 7, 'one no ends other votes');
  const u = new Table({}); u.join('h', 'h', 1000); u.join('x', 'x', 1000); u.players.x.connected = true; u.sit('x', 0);
  u.proposeSettings('h', { seats: 1 }); ok(!u.vote && u.seats.length === 1, 'only one other player: the seat change goes through at once');
}
console.log(`${n - bad}/${n} seat checks passed`);
if (bad) process.exit(1);
