// Computer players for the poker table. They are run by the host's browser, in the same way as a player's own moves.
// A bot looks only at what a player in its seat could see: its own cards, the board, the bets and the stacks.
// It never reads another seat's cards or the cards still to come.
import { botMoveHard } from './pokergto.js?v=20261122zy';
const VAL = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };
export const BOT_NAMES = ['Ava', 'Max', 'Zoe', 'Leo', 'Mia', 'Sam', 'Kai', 'Uma'];
export const isBot = (id) => String(id).startsWith('bot-');

// How good two cards are before the flop, from 0 (worst) to 1 (aces).
function two(a, b) {
  const hi = Math.max(VAL[a.r], VAL[b.r]), lo = Math.min(VAL[a.r], VAL[b.r]);
  if (hi === lo) return 0.5 + hi / 28;
  const gap = hi - lo;
  return ((hi + lo) / 28) * 0.6 + (a.s === b.s ? 0.06 : 0) + (gap === 1 ? 0.05 : gap === 2 ? 0.02 : 0);
}
function before(cards) {
  let best = 0;
  for (let i = 0; i < cards.length; i++) for (let j = i + 1; j < cards.length; j++) best = Math.max(best, two(cards[i], cards[j]));
  return cards.length > 2 ? best * 0.92 : best;
}
// The kind of hand the board makes by itself (0 nothing, 1 a pair, 2 two pair, 3 three of a kind or better).
function boardKind(board) {
  const n = {};
  for (const c of board) n[c.r] = (n[c.r] || 0) + 1;
  const counts = Object.values(n).sort((x, y) => y - x);
  return counts[0] >= 3 ? 3 : counts[0] === 2 && counts[1] === 2 ? 2 : counts[0] === 2 ? 1 : 0;
}
// How good the hand is after the flop, from 0 to 1.
function after(t, cards, board) {
  const made = t.best(cards, board);
  if (!made) return 0.3;
  const top = Math.max(...board.map((c) => VAL[c.r])), mine = cards.map((c) => VAL[c.r]);
  let s;
  if (made.cat >= 4) s = 0.9 + made.cat * 0.012;
  else if (made.cat === 3) s = 0.82;
  else if (made.cat === 2) s = 0.7;
  else if (made.cat === 1) {
    const pr = made.cards.map((c) => VAL[c.r]).find((v, i, a) => a.indexOf(v) !== i);
    s = !mine.includes(pr) ? 0.22 : pr >= top ? 0.56 : pr >= top - 3 ? 0.42 : 0.34;
  } else s = 0.12 + (Math.max(...mine) >= 13 ? 0.08 : 0);
  // A hand the board gives to everyone is worth little.
  if (made.cat <= 3 && boardKind(board) >= made.cat && made.cat > 0 && made.cat !== 1) s = Math.min(s, 0.3 + (Math.max(...mine) >= 13 ? 0.1 : 0));
  if (board.length < 5) {
    const all = [...cards, ...board];
    for (const suit of new Set(cards.map((c) => c.s))) if (all.filter((c) => c.s === suit).length === 4) { s += 0.14; break; }
    const vs = [...new Set(all.map((c) => VAL[c.r]))].sort((x, y) => x - y);
    for (let i = 0; i + 3 < vs.length; i++) if (vs[i + 3] - vs[i] === 3 && mine.some((v) => v >= vs[i] && v <= vs[i + 3])) { s += 0.09; break; }
  }
  return Math.min(1, s);
}
// The bot's move for the seat whose turn it is: { a: 'fold' | 'check' | 'call' | 'bet' | 'raise', amount }.
// With the table set to "Bots: Hard" the hard bot (js/pokergto.js) plays; when it cannot (Omaha, two boards)
// or anything goes wrong, this easy play is used.
export function botMove(t, id, rnd = Math.random) {
  if (t.settings?.botLevel === 'hard') { try { const m = botMoveHard(t, id, rnd); if (m) return m; } catch { /* the easy bot plays */ } }
  return botMoveEasy(t, id, rnd);
}
export function botMoveEasy(t, id, rnd = Math.random) {
  const o = t.options(id);
  if (!o) return null;
  const seat = t.seats[t.seatOf(id)], bb = t.settings.bigBlind || 1, pre = t.board.length === 0;
  const s = (pre ? before(seat.cards) : after(t, seat.cards, t.board)) + (rnd() - 0.5) * 0.14;
  const size = (to) => Math.round(Math.max(o.minTo, Math.min(o.maxTo, to)));
  const kind = o.isBet ? 'bet' : 'raise';
  if (o.canCheck) {
    if (o.canRaise && (s > (pre ? 0.62 : 0.58) || rnd() < 0.06)) return { a: kind, amount: size(pre ? t.currentBet + bb * (2 + Math.floor(rnd() * 2)) : t.currentBet + o.pot * (0.45 + rnd() * 0.4)) };
    return { a: 'check' };
  }
  const odds = o.toCall / (o.pot + o.toCall), big = o.toCall > seat.stack * 0.5;
  if (o.canRaise && s > (pre ? 0.74 : 0.8) && rnd() < 0.65) return { a: kind, amount: size(pre ? t.currentBet * 3 : t.currentBet + (o.pot + o.toCall) * (0.6 + rnd() * 0.4)) };
  const need = (pre && o.toCall <= bb ? 0.3 : 0.12 + odds * 1.1) + (big ? 0.2 : 0);
  return s >= need ? { a: 'call' } : { a: 'fold' };
}
