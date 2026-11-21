// The dealer (bank) rule shared by roulette and baccarat, the same idea as at the blackjack table:
//   - A player may be the dealer. Then every bet is against that player's chips: what the others lose the
//     dealer gets, what they win the dealer pays. No chips are made or lost, so the ledger always adds up to zero.
//   - With no dealer the table plays against the house. That is practice: the ledger is frozen at what it was,
//     and chips and buy-ins go back to those amounts when a player becomes the dealer.
// Tables using this hold: bankId (player id or null) and base ({ id: { chips, totalIn } } while frozen).
const r2 = (x) => Math.round(x * 100) / 100;

export const isFrozen = (t) => !t.bankId;
// Called when a player joins: during practice their real balance is kept aside.
export function bankJoin(t, p) { t.base ||= {}; if (isFrozen(t) && !t.base[p.id]) t.base[p.id] = { chips: p.chips, totalIn: p.totalIn }; }
const tableStaked = (t) => Object.keys(t.bets).reduce((a, id) => a + t.staked(id), 0);

export function setBank(t, id) {
  const p = t.mustPlayer(id);
  if (p.seat < 0) throw new Error('Take a seat first.');
  if (t.phase !== 'betting' || tableStaked(t) > 0) throw new Error('Bets are on the table. Wait for this round to end.');
  if (t.bankId === id) return;
  if (isFrozen(t)) { // practice ends: everyone is back at the balance they had before it
    for (const q of Object.values(t.players)) { const b = t.base?.[q.id]; if (b) { q.chips = b.chips; q.totalIn = b.totalIn; } }
    t.base = {};
    t.lastBets = {};
  }
  t.bankId = id;
  t.addLog(`${p.name} is the dealer now. Bets are for real chips against ${p.name}. Practice chips went back.`);
}
export function clearBank(t, byId) {
  if (!t.bankId) return;
  if (t.phase !== 'betting' || tableStaked(t) > 0) throw new Error('Bets are on the table. Wait for this round to end.');
  const name = t.players[t.bankId]?.name || 'The dealer';
  t.bankId = null; t.base = {};
  for (const q of Object.values(t.players)) t.base[q.id] = { chips: q.chips, totalIn: q.totalIn };
  t.addLog(`${name} stopped being the dealer${byId && t.players[byId] && t.players[byId].name !== name ? ' (the host did it)' : ''}. The ledger is frozen: rounds are practice until a player is the dealer.`);
}
// A dealer who is removed from the table: the freeze starts at once, bets on the table become practice bets.
export function bankGone(t, id) {
  if (t.bankId !== id) return;
  t.bankId = null; t.base = {};
  for (const q of Object.values(t.players)) t.base[q.id] = { chips: r2(q.chips + (q.id === id ? 0 : t.staked(q.id))), totalIn: q.totalIn };
  t.addLog('The dealer left the table. The ledger is frozen: rounds are practice until a player is the dealer.');
}
// After a round with a dealer: the dealer takes all stakes and pays all returns. A dealer who is short
// buys in by themselves in steps of the table's starting chips (logged), so every winner is always paid.
export function bankSettle(t, staked, back) {
  const b = t.players[t.bankId];
  if (!b) return null;
  const net = r2(staked - back);
  b.chips = r2(b.chips + net);
  let bought = 0;
  while (b.chips < 0) { b.chips = r2(b.chips + t.settings.startChips); b.totalIn += t.settings.startChips; bought += t.settings.startChips; }
  if (bought) t.addLog(`${b.name} (dealer) bought in ${bought} by themselves to pay the winners.`);
  return { bank: true, staked: 0, back: r2(net + bought), net, wins: [], lines: [], bought }; // back: what the page takes off the shown chips until the result is out
}
// A player's profit or loss in the ledger: frozen at the balance kept aside while the table is in practice.
export function ledgerNet(t, p) {
  const b = isFrozen(t) ? t.base?.[p.id] : null;
  return b ? r2(b.chips - b.totalIn) : r2(p.chips + t.staked(p.id) - p.totalIn);
}
// The whole ledger. It must always be zero.
export const ledgerSum = (t) => r2(Object.values(t.players).reduce((a, p) => a + ledgerNet(t, p), 0));
// A table saved before this rule existed played against the house for real. Its balances become the frozen base
// with nobody up or down, so the ledger starts at zero.
export function bankAdopt(t) {
  if (t.base) return;
  t.bankId = null; t.base = {};
  for (const q of Object.values(t.players)) { q.totalIn = q.chips; t.base[q.id] = { chips: q.chips, totalIn: q.totalIn }; }
}
