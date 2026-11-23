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

// ---------- Walking between tables (one wallet for the whole office) ----------
// A player who walks to another table takes their chips along: they leave this table as chips cashed out
// (the buy-in total goes down by the same amount, so the player's +/- here does not change and the ledger
// still adds up to zero), and the next table adds them as a buy-in. Only chips that are not in play can go.
const MAX_CARRY = 1e9;
export function bankCashOut(t, id) {
  const p = t.mustPlayer(id);
  // The dealer walking away stops dealing by itself: at once with no bets out, else after this round is settled.
  if (t.bankId === id) {
    try { clearBank(t, id); } catch { if (!t.bankLeaving) { t.bankLeaving = true; t.addLog(`${p.name} walked to another table and stops dealing after this round.`); } return 0; }
  }
  if (t.staked(id) > 0) { if (t.phase !== 'betting') throw new Error('Your bet is still in play. Walk over when this round ends.'); t.clearBets(id, true); }
  const b = isFrozen(t) ? t.base?.[id] : null, from = b || p;
  const amount = r2(Math.max(0, from.chips));
  if (!amount) return 0;
  from.chips = 0; from.totalIn = r2(from.totalIn - amount);
  if (b) p.chips = 0; // the practice chips go too, so nobody plays on with them here
  t.addLog(`${p.name} walked to another table with ${amount}.`);
  return amount;
}
// The chips a player brings from another table. A player who has just sat down for the first time gets
// exactly the chips they brought instead of the table's starting chips.
export function bankCarryIn(t, id, amount, fromName, cid) {
  const p = t.mustPlayer(id);
  amount = r2(Number(amount));
  if (!(amount > 0) || amount > MAX_CARRY) return 0;
  p.carried ||= [];
  if (cid && p.carried.includes(cid)) return 0;
  if (cid) { p.carried.push(String(cid).slice(0, 40)); if (p.carried.length > 8) p.carried.shift(); }
  const b = isFrozen(t) ? t.base?.[id] : null;
  const fresh = p.joinT && Date.now() - p.joinT < 30000 && p.chips === t.settings.startChips && p.totalIn === t.settings.startChips && !t.staked(id) && (!b || (b.chips === p.chips && b.totalIn === p.totalIn));
  for (const x of b ? [p, b] : [p]) { if (fresh) { x.chips = amount; x.totalIn = amount; } else { x.chips = r2(x.chips + amount); x.totalIn = r2(x.totalIn + amount); } }
  delete p.joinT;
  t.addLog(`${p.name} brought ${amount} from ${String(fromName || 'another table').slice(0, 20)}.`);
  return amount;
}
