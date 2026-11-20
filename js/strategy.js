// Basic strategy for 4 to 8 decks, dealer stands on soft 17, double after split, late surrender.
// Returns the best move among the moves allowed right now.
import { handTotal, cardValue } from './game.js?v=20261120s';

export function bestMove(cards, dealerUp, allowed, opts = {}) {
  if (!cards?.length || !dealerUp || dealerUp.hidden || !allowed?.length) return null;
  const can = (a) => allowed.includes(a);
  const d = dealerUp.r === 'A' ? 11 : cardValue(dealerUp);
  const { total, soft } = handTotal(cards);
  const h17 = !!opts.dealerHitsSoft17;
  if (total >= 21) return 'stand';

  // Late surrender: hard 16 against 9, 10 or ace, hard 15 against 10 (and ace when the dealer hits soft 17).
  if (can('surrender') && !soft) {
    const pair8 = cards.length === 2 && cards[0].r === '8' && cards[1].r === '8';
    if (total === 16 && !pair8 && d >= 9) return 'surrender';
    if (total === 15 && (d === 10 || (h17 && d === 11))) return 'surrender';
  }

  // Pairs.
  const isPair = cards.length === 2 && cardValue(cards[0]) === cardValue(cards[1]);
  if (can('split') && isPair) {
    const v = cards[0].r === 'A' ? 11 : cardValue(cards[0]);
    const split =
      v === 11 || v === 8 ||
      (v === 9 && [2, 3, 4, 5, 6, 8, 9].includes(d)) ||
      ((v === 7 || v === 3 || v === 2) && d <= 7) ||
      (v === 6 && d <= 6) ||
      (v === 4 && (d === 5 || d === 6));
    if (split) return 'split';
  }

  const dbl = (fallback) => (can('double') ? 'double' : fallback);

  if (soft) {
    if (total >= 20) return 'stand';
    if (total === 19) return d === 6 ? dbl('stand') : 'stand';
    if (total === 18) {
      if (d >= 3 && d <= 6) return dbl('stand');
      if (d === 2) return h17 ? dbl('stand') : 'stand';
      if (d <= 8) return 'stand';
      return 'hit';
    }
    if (total === 17) return d >= 3 && d <= 6 ? dbl('hit') : 'hit';
    if (total === 15 || total === 16) return d >= 4 && d <= 6 ? dbl('hit') : 'hit';
    return d >= 5 && d <= 6 ? dbl('hit') : 'hit'; // soft 13, 14
  }

  if (total >= 17) return 'stand';
  if (total >= 13) return d <= 6 ? 'stand' : 'hit';
  if (total === 12) return d >= 4 && d <= 6 ? 'stand' : 'hit';
  if (total === 11) return d <= 10 || h17 ? dbl('hit') : 'hit';
  if (total === 10) return d <= 9 ? dbl('hit') : 'hit';
  if (total === 9) return d >= 3 && d <= 6 ? dbl('hit') : 'hit';
  return 'hit';
}

// ---------- Chart and coaching text ----------
const UP = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
const card = (r) => ({ r, s: '♠' });
const ALL = ['hit', 'stand', 'double', 'split', 'surrender'];

// One chart cell: the move with every option allowed, plus what to do when doubling or surrender is not allowed.
function cell(cards, up, opts) {
  const best = bestMove(cards, card(up), ALL, opts);
  if (best === 'double') {
    const alt = bestMove(cards, card(up), ['hit', 'stand'], opts);
    return { code: alt === 'stand' ? 'Ds' : 'D', move: 'double' };
  }
  if (best === 'surrender') {
    const alt = bestMove(cards, card(up), ['hit', 'stand', 'split'], opts);
    return { code: alt === 'split' ? 'Rp' : alt === 'stand' ? 'Rs' : 'R', move: 'surrender' };
  }
  return { code: { hit: 'H', stand: 'S', split: 'P' }[best], move: best };
}

export function strategyChart(opts = {}) {
  const hard = [];
  for (let t = 17; t >= 5; t--) {
    const a = t >= 12 ? '10' : String(Math.max(2, t - 3));
    const b = String(t - Number(a === '10' ? 10 : a));
    const cards = t >= 12 ? [card('10'), card(String(t - 10))] : [card(a), card(b)];
    // Make sure the two cards are not a pair (pairs have their own table).
    if (cards[0].r === cards[1].r) { cards[0] = card(String(Number(cards[0].r) - 1)); cards[1] = card(String(Number(cards[1].r) + 1)); }
    hard.push({ label: t === 17 ? '17+' : String(t), cells: UP.map((u) => cell(cards, u, opts)) });
  }
  const soft = [];
  for (let x = 9; x >= 2; x--) soft.push({ label: `A,${x}`, cells: UP.map((u) => cell([card('A'), card(String(x))], u, opts)) });
  const pairs = [];
  for (const r of ['A', '10', '9', '8', '7', '6', '5', '4', '3', '2']) pairs.push({ label: `${r},${r}`, cells: UP.map((u) => cell([card(r), card(r)], u, opts)) });
  return { up: UP, hard, soft, pairs };
}

// Plain words for a hand, like "hard 16", "soft 18" or "a pair of 8s".
export function describeHand(cards) {
  const { total, soft } = handTotal(cards);
  if (cards.length === 2 && cards[0].r === cards[1].r) return `a pair of ${cards[0].r === 'A' ? 'aces' : cards[0].r + 's'}`;
  if (cards.length === 2 && cardValue(cards[0]) === 10 && cardValue(cards[1]) === 10) return 'hard 20';
  return `${soft ? 'soft' : 'hard'} ${total}`;
}
export const MOVE_NAMES = { hit: 'Hit', stand: 'Stand', double: 'Double', split: 'Split', surrender: 'Surrender' };

// ---------- Live odds ----------
// Chance that a hand wins, pushes or loses against the dealer's up card, found by playing the rest
// of the hand many times at random (infinite deck; the player follows basic strategy with hit and stand only).
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const randCard = () => ({ r: RANKS[(Math.random() * 13) | 0], s: '♠' });
const oddsCache = new Map();
export function handOdds(cards, dealerUp, opts = {}, n = 1600) {
  if (!cards?.length || !dealerUp || dealerUp.hidden) return null;
  const key = cards.map((c) => c.r).join(',') + '|' + dealerUp.r + '|' + (opts.dealerHitsSoft17 ? 1 : 0) + '|' + (opts.done ? 1 : 0);
  if (oddsCache.has(key)) return oddsCache.get(key);
  const upTen = cardValue(dealerUp) === 10, upAce = dealerUp.r === 'A';
  const playerBJ = cards.length === 2 && handTotal(cards).total === 21 && !opts.fromSplit;
  let win = 0, push = 0, dealerBust = 0;
  for (let i = 0; i < n; i++) {
    let hole = randCard();
    // The dealer has already checked for blackjack, so the hole card cannot make one.
    while ((upAce && cardValue(hole) === 10) || (upTen && hole.r === 'A')) hole = randCard();
    const hand = cards.slice();
    if (!opts.done && !playerBJ) {
      while (handTotal(hand).total < 21 && bestMove(hand, dealerUp, ['hit', 'stand'], opts) === 'hit') hand.push(randCard());
    }
    const p = handTotal(hand).total;
    if (p > 21) continue;
    if (playerBJ) { win++; continue; }
    const d = [dealerUp, hole];
    for (;;) {
      const { total, soft } = handTotal(d);
      if (total > 17 || (total === 17 && !(soft && opts.dealerHitsSoft17))) break;
      d.push(randCard());
    }
    const dt = handTotal(d).total;
    if (dt > 21) { dealerBust++; win++; } else if (p > dt) win++; else if (p === dt) push++;
  }
  const r = { win: win / n, push: push / n, lose: 1 - (win + push) / n };
  if (oddsCache.size > 500) oddsCache.clear();
  oddsCache.set(key, r);
  return r;
}
