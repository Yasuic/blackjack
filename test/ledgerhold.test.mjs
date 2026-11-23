// The ledger does not change in the middle of a hand: it shows the players as they stood before the deal until the hand is settled.
import { Table } from '../js/game.js';
let n = 0, bad = 0;
const ok = (c, m) => { n++; if (!c) { bad++; console.log('FAIL', m); } };
const rows = (t) => JSON.stringify(t.publicState('a').ledger.map((r) => [r.id, r.chips, r.totalIn, r.houseNet]));
const live = (t) => JSON.stringify(Object.values(t.players).map((p) => [p.id, p.chips, p.totalIn ?? t.settings.startChips, p.houseNet || 0]));
const t = new Table({}); for (const id of 'ab') t.join(id, id.toUpperCase(), 1000);
t.sit('a', 0); t.sit('b', 1); t.setFrozen(true);
let mid = 0;
for (let r = 0; r < 400; r++) {
  for (const id of 'ab') { if (t.players[id].chips < 200) t.players[id].chips += 1000; try { t.setBet(id, { main: 10, sides: {}, ready: true, seat: t.seatsOf(id)[0] }); } catch (e) { console.log('bet', r, id, t.players[id].chips, e.message); } }
  const before = live(t);
  t.deal();
  let g = 0; while (t.inRound() && g++ < 100) {
    mid++;
    ok(rows(t) === before, 'mid hand the ledger shows the players before the deal');
    if (t.phase === 'insurance') { for (const id of 'ab') try { t.insurance(id, r % 4 === 0); } catch {} continue; }
    if (t.phase === 'playing') { const s = t.seats[t.turn.seat]; const acts = t.allowedActions(s.playerId); const a = acts.includes('double') && r % 3 === 0 ? 'double' : acts.includes('hit') && r % 2 ? 'hit' : 'stand'; t.action(s.playerId, a); continue; }
    if (t.phase === 'dealer') { t.dealerStep(); continue; }
  }
  ok(rows(t) === live(t), 'after the hand the ledger is up to date');
}
ok(mid > 400, 'checked mid hand states: ' + mid);
console.log(bad ? `${bad} of ${n} ledger checks failed` : `${n}/${n} ledger checks passed`);
process.exit(bad ? 1 : 0);
