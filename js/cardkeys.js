// Card keys: the host's browser cannot read a card before the guests let it.
// The shoe order is set at the shuffle from the host's hidden seed and the players' seeds. Which card of the shoe
// comes out as card number k is then picked with a key for card k, and that key is made in the guests' browsers
// from a secret that never leaves them. So the host holds the shoe but cannot tell which card comes next, and a guest
// holds a key but cannot read a card without the host's seed. The same way of picking as blackjack (js/game.js).
// Nothing here touches the page or the network, so the checks in test/ can run it.
import { sha256 } from './game.js?v=20261124g';

// Card number k (counted from 1 in the shoe) with key nonce: its place among the cards still in the shoe.
export const pickIndex = (serverSeed, nonce, k, left) => parseInt(sha256(serverSeed + '|' + nonce + '|' + k).slice(0, 12), 16) % left;
export function newNonce() {
  const b = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 8; i++) b[i] = Math.floor(Math.random() * 256);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
export const cleanNonce = (n) => String(n ?? '').replace(/[^0-9a-zA-Z]/g, '').slice(0, 32);
// The key a guest's secret gives for card number k. Asking again for the same card gives the same key.
export const keyFor = (secret, k) => sha256(secret + '|' + k).slice(0, 32);
// Several guests answered: every one of them holds a part of each key, so opening a card early needs all of them.
export function mixKeys(parts, need) {
  const ids = Object.keys(parts).sort();
  return Array.from({ length: need }, (_, i) => sha256(ids.map((id) => cleanNonce(parts[id][i])).join('|')).slice(0, 32));
}

// The guest's side of the guard. view is what this browser was told by the table:
//   cards: how many cards the table has opened with keys so far
//   open:  whether the table may ask for keys now (in baccarat: the bets are locked and the cards are coming out)
//   shoe, host: which shoe is in play and whose browser runs the table
// Rules:
// 1. Only the next cards: a request may not start past the next card, and may not reach more than span cards
//    (2) past the cards already opened. Asking for card 40 while card 12 is next is refused.
// 2. No keys while the table may not deal (in baccarat: while bets are still open).
// 3. Every key given out has to be used for a card the table really opens within wait ms (5 seconds).
//    A host that takes keys and does not deal (to look at the cards first) is caught.
// A refused request or an unused key is an alarm: the page shows "Network security breached" and tells the table.
export class KeyGuard {
  constructor(secret, { span = 2, wait = 5000 } = {}) {
    this.secret = secret;
    this.span = span;
    this.wait = wait;
    this.served = 0; // the last card number this browser gave a key for
    this.out = [];   // keys given out and not checked yet: { last, shoe, host, at }
  }
  // Returns { keys } or { alarm, keys: [] }.
  serve(msg, view, now = Date.now()) {
    const from = Number(msg?.from), count = Number(msg?.count);
    const cards = Number(view?.cards) || 0;
    if (!view || !view.open) return { keys: [], alarm: 'The host\'s browser asked for card keys while the table could not deal. My browser refused.' };
    if (!Number.isInteger(from) || from < 1 || !Number.isInteger(count) || count < 1 || count > this.span) return { keys: [], alarm: 'The host\'s browser asked for more card keys at once than the table needs. My browser refused.' };
    const last = from + count - 1;
    if (from > cards + 1 || last > cards + this.span) return { keys: [], alarm: `The host's browser asked for card keys ahead of the game (card ${last} while card ${cards + 1} is next). My browser refused.` };
    this.served = Math.max(this.served, last);
    this.out.push({ last, shoe: view.shoe, host: view.host, at: now });
    return { keys: Array.from({ length: count }, (_, i) => keyFor(this.secret, from + i)) };
  }
  // Called with what the table shows now. Returns an alarm text when a key given out more than wait ms ago
  // was not used for a card. A new shoe or a new host has nothing to compare, so those keys are let go.
  check(view, now = Date.now()) {
    let alarm = null;
    this.out = this.out.filter((o) => {
      if (now - o.at < this.wait) return true;
      if (!view || view.shoe !== o.shoe || view.host !== o.host) return false;
      const cards = Number(view.cards) || 0;
      if (cards < o.last) alarm = `The host's browser opened ${o.last - cards} card key(s) without dealing those cards.`;
      return false;
    });
    if (alarm) this.out = []; // one alarm for one breach: the keys given out before it are not counted again after the host resumes
    return alarm;
  }
}
