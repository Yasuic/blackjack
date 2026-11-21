// Checks of the dealer rule (js/bank.js), run by the roulette and the baccarat tests.
// T: the table class. spots: bet names. can / deal: the method names that tell if a round can start and start it.
export function bankChecks(ok, T, spots, can, deal) {
  const t = new T(); for (let i = 0; i < 4; i++) t.join('p' + i, 'P' + i);
  const net = (tb, id) => tb.publicState(id).players.find((p) => p.id === id).net;
  const bet = (i, r) => t.bet('p' + i, spots[(r + i) % spots.length], 5 + ((r * 7 + i) % 40));
  const round = () => { if (t[can]()) t[deal](); };
  ok(t.frozen && t.publicState('p0').frozen, 'no dealer: the ledger is frozen');
  for (let r = 0; r < 60; r++) { for (let i = 0; i < 4; i++) { try { bet(i, r); } catch { /* out of practice chips */ } } round(); t.next(); if (r === 20) t.addChips('p1', 500); }
  ok([0, 1, 2, 3].every((i) => net(t, 'p' + i) === 0) && t.ledgerSum() === 0, 'practice rounds and practice buy-ins never reach the ledger');
  t.setBank('p0');
  ok(!t.frozen && [0, 1, 2, 3].every((i) => t.players['p' + i].chips === 1000 && t.players['p' + i].totalIn === 1000), 'a dealer starts: practice chips go back');
  let threw = false; try { t.bet('p0', spots[0], 5); } catch { threw = true; } ok(threw, 'the dealer cannot bet');
  let zero = true, moved = false;
  for (let r = 0; r < 400; r++) { for (let i = 1; i < 4; i++) { try { bet(i, r); } catch { t.addChips('p' + i, 1000); } } round(); if (t.ledgerSum() !== 0) zero = false; if (net(t, 'p0') !== 0) moved = true; t.next(); }
  ok(zero, 'with a dealer the ledger adds up to zero after every round'); ok(moved, 'the dealer wins and loses real chips');
  ok(Object.values(t.players).every((p) => p.chips >= 0), 'the dealer buys in when short, nobody is below zero');
  if (t.players.p1.chips < 10) t.addChips('p1', 100);
  t.bet('p1', spots[0], 10); threw = false; try { t.clearBank(); } catch { threw = true; } ok(threw, 'the dealer cannot stop with bets on the table');
  threw = false; try { t.setBank('p2'); } catch { threw = true; } ok(threw, 'nobody becomes the dealer with bets on the table');
  round(); t.next(); const kept = [0, 1, 2, 3].map((i) => net(t, 'p' + i)); t.clearBank();
  ok(t.frozen && t.ledgerSum() === 0 && Math.abs(kept.reduce((a, b) => a + b, 0)) < 1e-6, 'dealer stops: frozen again, still zero');
  for (let r = 0; r < 30; r++) { for (let i = 0; i < 4; i++) { try { bet(i, r); } catch { /* fine */ } } round(); t.next(); }
  ok([0, 1, 2, 3].every((i) => net(t, 'p' + i) === kept[i]), 'practice after a dealer leaves the ledger as it was');
  const m = T.fromPublic(t.publicState('p2'), 'p2'); ok(m.frozen && m.ledgerSum() === 0 && [0, 1, 2, 3].every((i) => net(m, 'p' + i) === kept[i]), 'a moved table keeps the frozen ledger');
  t.setBank('p3'); ok([0, 1, 2, 3].every((i) => net(t, 'p' + i) === kept[i]), 'a new dealer starts from the kept ledger');
  t.bet('p1', spots[0], 10); const m2 = T.fromPublic(t.publicState('p2'), 'p2'); ok(m2.bankId === 'p3' && m2.ledgerSum() === 0, 'a moved table keeps the dealer');
  t.kick('p3'); ok(t.frozen && t.ledgerSum() === 0, 'a removed dealer freezes the ledger at zero');
  const old = T.restore(JSON.parse(JSON.stringify({ players: { a: { id: 'a', name: 'A', chips: 1400, totalIn: 1000, seat: 0 }, b: { id: 'b', name: 'B', chips: 300, totalIn: 1000, seat: 1 } } })));
  ok(old.frozen && old.ledgerSum() === 0, 'a table saved before the dealer rule starts at zero');
}
