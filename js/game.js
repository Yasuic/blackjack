// Blackjack table logic. Runs only in the host's browser (the "dealer").
// Everything here is plain JavaScript with no browser APIs, so it can be tested in Node.

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

// The rules the dealer sets (or the host while the house deals), with the values each may take.
export const RULE_KEYS = ['blackjackPays', 'dealerHitsSoft17', 'allowSurrender', 'splitAces', 'resplitAces', 'maxSplits', 'das', 'doubleOn', 'charlieEvery'];
export function cleanRules(r, base) {
  const out = {};
  for (const k of RULE_KEYS) {
    if (r[k] === undefined) continue;
    const v = r[k];
    if (k === 'blackjackPays') { const n = Number(v); if (![1.5, 1.2, 1].includes(n)) throw new Error('Blackjack pays 3 to 2, 6 to 5 or 1 to 1.'); out[k] = n; }
    else if (k === 'maxSplits') { const n = Math.round(Number(v)); if (![0, 1, 2, 3].includes(n)) throw new Error('Splits: 1, 2, 3 or no limit.'); out[k] = n; }
    else if (k === 'doubleOn') { if (!['any', '9-11', '10-11'].includes(v)) throw new Error('Double on any two cards, 9 to 11 or 10 to 11.'); out[k] = v; }
    else if (k === 'charlieEvery') { const n = Math.round(Number(v)); if (!(n >= 0) || n > 1000) throw new Error('5 Card Charlie: pick 0 (off) or 1 to 1000 rounds.'); out[k] = n; }
    else out[k] = !!v;
  }
  return Object.fromEntries(Object.entries(out).filter(([k, v]) => v !== base[k]));
}
export const RULE_TEXT = {
  blackjackPays: (v) => `Blackjack pays ${v === 1.5 ? '3 to 2' : v === 1.2 ? '6 to 5' : '1 to 1'}`,
  dealerHitsSoft17: (v) => (v ? 'Dealer hits soft 17' : 'Dealer stands on soft 17'),
  allowSurrender: (v) => `Surrender ${v ? 'allowed' : 'not allowed'}`,
  splitAces: (v) => `Split aces ${v ? 'allowed' : 'not allowed'}`,
  resplitAces: (v) => `Resplit aces ${v ? 'allowed' : 'not allowed'}`,
  maxSplits: (v) => (v ? `Up to ${v} split${v > 1 ? 's' : ''} per seat` : 'No limit on splits'),
  das: (v) => `Double after split ${v ? 'allowed' : 'not allowed'}`,
  doubleOn: (v) => (v === 'any' ? 'Double on any two cards' : `Double on ${v.replace('-', ' to ')} only`),
  charlieEvery: (v) => (v ? `5 Card Charlie on about 1 round in ${v}` : '5 Card Charlie off'),
};

export const DEFAULT_SETTINGS = {
  seats: 7,              // player seats at the table (any whole number from 1 up)
  decks: 1000,           // 1, 2, 6, 8, 20, 100, 1000, or 'csm' (randomized: full reshuffle before every round)
  shuffleMode: 'penetration', // 'penetration' or 'rounds'
  penetration: 65,       // reshuffle once this % of the shoe has been dealt
  shuffleEvery: 5,       // or reshuffle every N rounds
  shuffle8: true,        // also a fresh shuffle every 8 rounds (the dealer can turn it off)
  startChips: 1000,
  minBet: 10,
  maxBet: 75,
  maxSideBet: 10,
  dealerHitsSoft17: false,
  blackjackPays: 1.5,    // 3:2
  allowSurrender: true,
  // The dealer's rules (setRules; the host's while the house deals). Changed only between rounds.
  splitAces: true,       // aces may be split (one card each)
  resplitAces: true,     // a split ace that gets another ace may be split again
  maxSplits: 0,          // splits per seat: 1, 2 or 3, or 0 for no limit
  das: true,             // double after a split
  doubleOn: 'any',       // double on 'any' first two cards, or only on totals '9-11' or '10-11'
  charlieEvery: 10,      // Five Card Charlie on about 1 random round in this many (0 = off). Each such round is
                         // announced while bets are open. Five cards without busting win at once, paid 1 to 1;
                         // a dealer blackjack still beats it. The dealer sets it: on every round it costs the dealer.
  autoDeal: true,        // deal as soon as every seated player is ready
  betTimer: 30,          // seconds for betting before the dealer deals on its own (0 = off)
  turnTimer: 30,
  peekCost: 10,          // price to see the next card in the shoe
  sideBets: ['hot3', 'bustIt', 'twentyOnePlus3'], // side bets offered at this table
  bigBet: null,          // 'Big Bets Sometimes': { limit, per, hands, since } or null when off         // seconds per decision before the dealer stands for you (0 = off)
};

// ---------- Side bets ----------
// Payouts are "to one": a 25 means a $10 bet wins $250 and you also get your $10 back.
// The largest buy-in. Far above any real game, and small enough that sums of chips stay exact.
export const MAX_CHIPS = 1e9;
export const SIDE_BETS = {
  hot3: {
    name: 'Hot 3',
    short: 'Hot 3',
    icon: '🔥',
    about: 'Your first two cards plus the dealer up card total 19, 20 or 21.',
    table: [['Suited 7-7-7', 100], ['Suited 21', 20], ['Any other 21', 4], ['20', 2], ['19', 1]],
  },
  perfectPairs: {
    name: 'Perfect Pairs',
    icon: '👯',
    short: 'PP',
    about: 'Your first two cards are a pair.',
    table: [['Perfect pair (same suit)', 25], ['Coloured pair (same colour)', 12], ['Mixed pair', 6]],
  },
  twentyOnePlus3: {
    name: '21+3',
    short: '21+3',
    icon: '🃏',
    about: 'Your first two cards plus the dealer up card make a poker hand.',
    table: [['Suited three of a kind', 100], ['Straight flush', 40], ['Three of a kind', 30], ['Straight', 10], ['Flush', 5]],
  },
  luckyLadies: {
    name: 'Lucky Ladies',
    short: 'LL',
    icon: '👑',
    about: 'Your first two cards total 20.',
    table: [['Two Q♥ and dealer has blackjack', 1000], ['Two Q♥', 200], ['Matched 20 (same rank and suit)', 25], ['Suited 20', 10], ['Any 20', 4]],
  },
  royalMatch: {
    name: 'Royal Match',
    short: 'RM',
    icon: '💍',
    about: 'Your first two cards are the same suit.',
    table: [['Suited K and Q', 25], ['Any suited cards', 2.5]],
  },
  luckyLucky: {
    name: 'Lucky Lucky',
    short: 'LkLk',
    icon: '🍀',
    about: 'Your first two cards plus the dealer up card total 19, 20 or 21.',
    table: [['Suited 7-7-7', 200], ['Suited 6-7-8', 100], ['7-7-7', 50], ['6-7-8', 30], ['Suited 21', 15], ['Any 21', 3], ['20', 2], ['19', 2]],
  },
  bustIt: {
    name: 'Dealer Bust',
    short: 'Bust',
    icon: '💥',
    about: 'The dealer busts. More cards in the busted hand pay more.',
    table: [['8+ cards', 250], ['7 cards', 100], ['6 cards', 50], ['5 cards', 9], ['4 cards', 2], ['3 cards', 1]],
  },
};
export const SIDE_KEYS = Object.keys(SIDE_BETS);
// A new table offers every side bet (the host can untick any of them).
DEFAULT_SETTINGS.sideBets = [...SIDE_KEYS];

// ---------- Card helpers ----------
export const cardValue = (c) => (c.r === 'A' ? 1 : ['J', 'Q', 'K'].includes(c.r) ? 10 : Number(c.r));
export const rankIndex = (c) => RANKS.indexOf(c.r) + 1; // A=1 .. K=13
export const isRed = (c) => c.s === '♥' || c.s === '♦';

export function handTotal(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    total += cardValue(c);
    if (c.r === 'A') aces++;
  }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

export function isBlackjack(hand) {
  return hand.cards.length === 2 && !hand.fromSplit && handTotal(hand.cards).total === 21;
}

// Fisher-Yates shuffle with a strong random source when one exists.
function randomInt(n) {
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buf = new Uint32Array(1);
    const limit = Math.floor(0x100000000 / n) * n;
    let x;
    do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
    return x % n;
  }
  return Math.floor(Math.random() * n);
}

export const DECK_CHOICES = [1, 2, 6, 8, 20, 100, 1000];
// A shoe of 1000 decks is 52,000 cards. Saved and locked as one letter per card, it stays small (52 KB instead of about 1 MB).
const CARD_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function packShoe(shoe) {
  if (!Array.isArray(shoe)) return shoe;
  let out = '';
  for (const c of shoe) { const k = RANKS.indexOf(c.r) * 4 + SUITS.indexOf(c.s); if (k < 0) return shoe; out += CARD_LETTERS[k]; }
  return out;
}
export function unpackShoe(x) {
  if (typeof x !== 'string') return x;
  const out = [];
  for (const ch of x) { const k = CARD_LETTERS.indexOf(ch); if (k >= 0) out.push({ r: RANKS[k >> 2], s: SUITS[k & 3] }); }
  return out;
}
export function buildShoe(decks) {
  const shoe = orderedShoe(decks);
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}
function orderedShoe(decks) {
  const shoe = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) shoe.push({ r, s });
  return shoe;
}

// ---------- Fair shuffle that every player can check ----------
// Before a shoe is shuffled the host publishes sha256(server seed). Each player then sends a seed of
// their own. The card order comes only from the server seed plus those player seeds, so the host
// cannot pick the order. When the shoe is finished the server seed is shown and anyone can redo the shuffle.
const K256 = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
export function sha256(str) {
  const msg = new TextEncoder().encode(String(str));
  const len = msg.length, total = ((len + 9 + 63) >> 6) << 6;
  const b = new Uint8Array(total); b.set(msg); b[len] = 0x80;
  const dv = new DataView(b.buffer);
  dv.setUint32(total - 8, Math.floor((len * 8) / 0x100000000)); dv.setUint32(total - 4, (len * 8) >>> 0);
  const h = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
  const w = new Uint32Array(64);
  const rr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rr(w[i - 15], 7) ^ rr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rr(w[i - 2], 17) ^ rr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, bb, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rr(e, 6) ^ rr(e, 11) ^ rr(e, 25)) + ((e & f) ^ (~e & g)) + K256[i] + w[i]) >>> 0;
      const t2 = ((rr(a, 2) ^ rr(a, 13) ^ rr(a, 22)) + ((a & bb) ^ (a & c) ^ (bb & c))) >>> 0;
      hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = bb; bb = a; a = (t1 + t2) >>> 0;
    }
    h[0] += a; h[1] += bb; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, (x) => x.toString(16).padStart(8, '0')).join('');
}
function randomSeed() {
  const buf = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < 32; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (x) => x.toString(16).padStart(2, '0')).join('');
}
// The one seed a shuffle uses: the server seed, then every player seed in order of player id.
export function fairSeed(serverSeed, clientSeeds = {}) {
  return sha256(serverSeed + '|' + Object.keys(clientSeeds).sort().map((k) => k + '=' + clientSeeds[k]).join('|'));
}
// Same seed in, same card order out. The last card of the list is dealt first.
export function fairShoe(decks, serverSeed, clientSeeds = {}) {
  const seed = fairSeed(serverSeed, clientSeeds);
  const shoe = orderedShoe(decks);
  let block = [], n = 0;
  const next32 = () => {
    if (!block.length) { const hex = sha256(seed + ':' + n++); for (let i = 0; i < 64; i += 8) block.push(parseInt(hex.slice(i, i + 8), 16)); }
    return block.shift();
  };
  for (let i = shoe.length - 1; i > 0; i--) {
    const limit = Math.floor(0x100000000 / (i + 1)) * (i + 1);
    let x; do { x = next32(); } while (x >= limit);
    const j = x % (i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}
function pickIndex(serverSeed, nonce, k, left) {
  return parseInt(sha256(serverSeed + '|' + nonce + '|' + k).slice(0, 12), 16) % left;
}
// Deal a finished shoe again from its seeds and the numbers the players sent. Returns the cards in the order they were dealt.
export function replayShoe(rec) {
  const shoe = fairShoe(rec.decks, rec.serverSeed, rec.clientSeeds);
  return (rec.draws || []).map((nonce, i) => shoe.splice(pickIndex(rec.serverSeed, nonce, i + 1, shoe.length), 1)[0]);
}
function newFairNext() { const seed = randomSeed(); return { seed, commit: sha256(seed), seeds: {} }; }

// ---------- Side bet evaluation ----------
// Each returns { win: bool, label, mult } where mult is the "to one" payout.
export function evalPerfectPairs(p) {
  const [a, b] = p;
  if (a.r !== b.r) return { win: false, label: 'No pair' };
  if (a.s === b.s) return { win: true, label: 'Perfect pair', mult: 25 };
  if (isRed(a) === isRed(b)) return { win: true, label: 'Coloured pair', mult: 12 };
  return { win: true, label: 'Mixed pair', mult: 6 };
}

export function eval21p3(p, up) {
  const cards = [p[0], p[1], up];
  const flush = cards.every((c) => c.s === cards[0].s);
  const trips = cards.every((c) => c.r === cards[0].r);
  const idx = cards.map(rankIndex).sort((x, y) => x - y);
  let straight = idx[0] + 1 === idx[1] && idx[1] + 1 === idx[2];
  if (!straight && idx[0] === 1 && idx[1] === 12 && idx[2] === 13) straight = true; // Q-K-A
  if (trips && flush) return { win: true, label: 'Suited three of a kind', mult: 100 };
  if (straight && flush) return { win: true, label: 'Straight flush', mult: 40 };
  if (trips) return { win: true, label: 'Three of a kind', mult: 30 };
  if (straight) return { win: true, label: 'Straight', mult: 10 };
  if (flush) return { win: true, label: 'Flush', mult: 5 };
  return { win: false, label: 'No hand' };
}

export function evalLuckyLadies(p, dealerHasBJ) {
  if (handTotal(p).total !== 20) return { win: false, label: 'Not 20' };
  const [a, b] = p;
  const qh = (c) => c.r === 'Q' && c.s === '♥';
  if (qh(a) && qh(b)) {
    return dealerHasBJ
      ? { win: true, label: 'Two Q♥ + dealer blackjack', mult: 1000 }
      : { win: true, label: 'Two Q♥', mult: 200 };
  }
  if (a.r === b.r && a.s === b.s) return { win: true, label: 'Matched 20', mult: 25 };
  if (a.s === b.s) return { win: true, label: 'Suited 20', mult: 10 };
  return { win: true, label: 'Any 20', mult: 4 };
}

export function evalRoyalMatch(p) {
  const [a, b] = p;
  if (a.s !== b.s) return { win: false, label: 'Not suited' };
  const ranks = [a.r, b.r].sort().join('');
  if (ranks === 'KQ') return { win: true, label: 'Royal match (K-Q suited)', mult: 25 };
  return { win: true, label: 'Suited', mult: 2.5 };
}

export function evalLuckyLucky(p, up) {
  const cards = [p[0], p[1], up];
  const { total } = handTotal(cards);
  const suited = cards.every((c) => c.s === cards[0].s);
  const ranks = cards.map((c) => c.r).sort().join(',');
  const is777 = ranks === '7,7,7';
  const is678 = ranks === '6,7,8';
  if (is777 && suited) return { win: true, label: 'Suited 7-7-7', mult: 200 };
  if (is678 && suited) return { win: true, label: 'Suited 6-7-8', mult: 100 };
  if (is777) return { win: true, label: '7-7-7', mult: 50 };
  if (is678) return { win: true, label: '6-7-8', mult: 30 };
  if (total === 21 && suited) return { win: true, label: 'Suited 21', mult: 15 };
  if (total === 21) return { win: true, label: '21', mult: 3 };
  if (total === 20) return { win: true, label: '20', mult: 2 };
  if (total === 19) return { win: true, label: '19', mult: 2 };
  return { win: false, label: `Total ${total}` };
}

export function evalHot3(p, up) {
  const cards = [p[0], p[1], up];
  const { total } = handTotal(cards);
  const suited = cards.every((c) => c.s === cards[0].s);
  if (suited && cards.every((c) => c.r === '7')) return { win: true, label: 'Suited 7-7-7', mult: 100 };
  if (total === 21) return suited ? { win: true, label: 'Suited 21', mult: 20 } : { win: true, label: '21', mult: 4 };
  if (total === 20) return { win: true, label: '20', mult: 2 };
  if (total === 19) return { win: true, label: '19', mult: 1 };
  return { win: false, label: `Total ${total}` };
}

export function evalBustIt(dealerCards) {
  const { total } = handTotal(dealerCards);
  if (total <= 21) return { win: false, label: 'Dealer did not bust' };
  const n = dealerCards.length;
  const mult = n >= 8 ? 250 : n === 7 ? 100 : n === 6 ? 50 : n === 5 ? 9 : n === 4 ? 2 : 1;
  return { win: true, label: `Dealer bust with ${n} cards`, mult };
}

// ---------- The table ----------
export class Table {
  constructor(settings = {}) {
    this.settings = charlieFix({ ...DEFAULT_SETTINGS, ...settings }, settings);
    this.settings.seats = seatCount(this.settings.seats);
    this.seats = Array(this.settings.seats).fill(null);
    this.players = {}; // clientId -> { name, chips, seat, connected }
    this.frozen = false; // host chose to deal with the house dealer and frozen balances
    this.banker = null; // clientId of a player sitting as the dealer (the bank), or null
    this.phase = 'betting';
    this.dealer = { cards: [], revealed: false };
    this.turn = null; // { seat, hand }
    this.round = 0;
    this.roundsSinceShuffle = 0;
    this.log = [];
    this.newShoe();
  }

  // ---- Shoe ----
  shoeDecks() {
    return this.settings.decks === 'csm' ? 6 : Number(this.settings.decks);
  }
  // Shuffle with the seed promised earlier plus the players' seeds, show the seed of the shoe
  // that just ended, and promise a new seed for the shoe after this one.
  fairShuffle() {
    if (!this.fair) this.fair = { n: 0, next: newFairNext(), current: null, last: null };
    const f = this.fair, nx = f.next, decks = this.shoeDecks();
    if (f.current) f.last = { ...f.current };
    f.n += 1;
    f.current = { n: f.n, serverSeed: nx.seed, commit: nx.commit, clientSeeds: { ...nx.seeds }, decks, draws: [] };
    this.pendingCard = null;
    f.next = newFairNext();
    this.shoe = fairShoe(decks, nx.seed, nx.seeds);
    this.shoeSize = this.shoe.length;
  }
  setClientSeed(clientId, seed) {
    if (!this.players[clientId] || !this.fair) return;
    this.fair.next.seeds[clientId] = String(seed).replace(/[^0-9a-zA-Z]/g, '').slice(0, 64);
  }
  newShoe() {
    this.fairShuffle();
    this.roundsSinceShuffle = 0;
    this.shuffleNext = false;
    this.addLog('The shoe was shuffled.');
  }
  // Shuffle now between rounds; during a round the shuffle waits for the next deal.
  askShuffle(by = 'The host') {
    if (!this.inRound()) { this.newShoe(); if (by !== 'The host') this.addLog(`${by} asked for the shuffle.`); return true; }
    if (!this.shuffleNext) this.addLog(`${by} asked for a shuffle before the next hand.`);
    this.shuffleNext = true;
    return false;
  }
  // Any seated player may ask for a shuffle. Between rounds it happens now, otherwise before the next hand.
  playerShuffle(clientId) {
    if (this.banker === clientId) return this.dealerShuffle(clientId);
    const p = this.players[clientId];
    if (!p || !this.seatsOf(clientId).length) throw new Error('Only seated players can ask for a shuffle.');
    if (this.settings.decks === 'csm') throw new Error('This table shuffles before every round already.');
    return this.askShuffle(p.name);
  }
  // The player who is the dealer may shuffle too.
  dealerShuffle(clientId) {
    if (this.banker !== clientId) throw new Error('Only the dealer can shuffle.');
    return this.askShuffle(`${this.players[clientId].name} (dealer)`);
  }
  needsShuffle(players = this.seats.length) {
    const s = this.settings;
    if (s.decks === 'csm') return true;
    // Never start a round the shoe may not finish: keep 10 cards per betting seat plus 12 for the dealer,
    // so the shuffle always happens between rounds and not in the middle of a hand.
    if (this.shoe.length < Math.min(this.shoeSize || Infinity, 12 + 10 * players)) return true;
    if (s.shuffle8 !== false && this.roundsSinceShuffle >= 8) return true;
    if (s.shuffleMode === 'rounds') return this.roundsSinceShuffle >= Number(s.shuffleEvery);
    const dealt = 1 - this.shoe.length / this.shoeSize;
    return dealt * 100 >= Number(s.penetration);
  }
  // to: where the card goes ('s2.0' = seat 3 hand 1, 'D' = dealer face up, 'H' = dealer hole card). The host
  // announced it before the guests gave the key, and the table checks it here (see pick).
  draw(to) {
    if (this.shoe.length === 0) {
      this.fairShuffle();
      this.addLog('Shoe ran out mid round and was reshuffled.');
      this.shuffledMidRound = true;
    }
    const c = this.pendingCard || this.pick(to);
    this.pendingCard = null;
    return c;
  }
  // A card key a step could not use (the move it was asked for did not happen, for example a hit after the turn
  // clock had already stood the hand) is never kept for later: its card is burned, face up for everyone, like a
  // dealer burns a card. So every key a guest gives out opens a card the whole table sees within moments.
  burnCard() {
    if (!this.keys?.length || !this.shoe.length || !this.fair?.current) return null;
    const n = (this.fair.cards || 0) + 1, was = this.plan?.[0];
    const c = this.pick('burn');
    (this.burned ||= []).push(c);
    if (this.burned.length > 20) this.burned.shift();
    this.addLog(`Burned card ${n}: ${c.r}${c.s}${was ? ` (announced for ${destName(was)}, the move did not happen)` : ' (its key was not needed)'}.`);
    return c;
  }
  // ---- Announce first, then reveal ----
  // Before the host asks the guests for the keys of the next cards, it announces where each of those cards goes,
  // in the order they are drawn. A guest gives the key of card N only for the next card in order and only for
  // the place announced for it, and that place can never change. So the host cannot open a card to look at it
  // and then send it somewhere else: the card has to go where it was announced, or be burned face up in the log.
  dealPlan() {
    if (this.phase !== 'betting' || !this.canDeal()) return [];
    const active = [];
    this.seats.forEach((seat, i) => {
      if (!seat) return;
      const p = this.players[seat.playerId];
      if (seat.bet.main >= this.settings.minBet && seat.bet.main + sumValues(seat.bet.sides) <= p.chips && p.connected !== false) active.push(i);
    });
    if (!active.length) return [];
    return [...active.map((i) => `s${i}.0`), 'D', ...active.map((i) => `s${i}.0`), 'H'];
  }
  // a: 'hit', 'double' or 'split' for the hand whose turn it is. check: refuse a move this player may not make.
  movePlan(clientId, a, check = true) {
    if (this.phase !== 'playing' || !this.turn) return [];
    if (check && clientId && !this.allowedActions(clientId).includes(a)) return [];
    const { seat, hand } = this.turn;
    if (a === 'hit' || a === 'double') return [`s${seat}.${hand}`];
    if (a === 'split') return [`s${seat}.${hand}`, `s${seat}.${hand + 1}`];
    return [];
  }
  awayPlan() { return this.awayMoveCount() ? [`s${this.turn.seat}.${this.turn.hand}`] : []; }
  dealerPlan() { return this.dealerNeedsCard() ? ['D'] : []; }
  // Take one card out of the shoe. The shoe order is set once, at the shuffle, by two things: the
  // host's hidden seed and a secret that stays in one guest's browser. Card number k needs key
  // number k from that guest (this.keys), and the keys are fixed by the guest's secret, so the
  // order never changes after the shuffle. The host cannot read a card before its key arrives,
  // and the guest cannot read it without the host's seed.
  pick(to) {
    const cur = this.fair?.current;
    if (!cur) return this.shoe.pop();
    let nonce = '';
    if (this.keys?.length) {
      nonce = this.keys.shift(); this.fair.cards = (this.fair.cards || 0) + 1;
      // Where this card was announced and where it goes. Both are public; a difference is written in the log.
      const want = this.plan?.length ? this.plan.shift() : null, got = to || '?';
      const d = (this.fair.dealt ||= []);
      d.push({ n: this.fair.cards, to: got, ...(want && want !== got ? { want } : {}) });
      if (d.length > 40) d.splice(0, d.length - 40);
      if (want && want !== got && got !== 'burn') this.addLog(`Card ${this.fair.cards} was announced for ${destName(want)} but went to ${destName(got)}.`);
    }
    cur.draws = cur.draws || [];
    cur.draws.push(nonce);
    return this.shoe.splice(pickIndex(cur.serverSeed, nonce, cur.draws.length, this.shoe.length), 1)[0];
  }

  updateSettings(patch) {
    if (this.phase !== 'betting' && this.phase !== 'settled') throw new Error('Change settings between rounds.');
    const old = this.settings;
    const s = { ...old, ...patch };
    // A value that is not a number keeps the old setting, so a bad entry can never turn chips into "not a number".
    const num = (k, lo, hi = MAX_CHIPS, round = true) => { let v = Number(s[k]); if (!Number.isFinite(v) || typeof s[k] === 'boolean' || s[k] === null || s[k] === '') v = Number(old[k]); if (!Number.isFinite(v)) v = DEFAULT_SETTINGS[k]; s[k] = clamp(round ? Math.round(v) : v, lo, hi); };
    num('penetration', 20, 95, false);
    num('shuffleEvery', 1, 50);
    num('minBet', 1);
    num('maxBet', 1); s.maxBet = Math.max(s.minBet, s.maxBet);
    num('maxSideBet', 0);
    num('startChips', 1);
    num('peekCost', 0);
    for (const k of ['betTimer', 'turnTimer']) { const v = Number(s[k]); s[k] = Number.isFinite(v) && v > 0 ? clamp(Math.round(v), 5, 300) : 0; }
    if (![...DECK_CHOICES, 'csm'].includes(s.decks)) s.decks = DECK_CHOICES.includes(Number(s.decks)) ? Number(s.decks) : 'csm';
    if (![1.5, 1.2, 1].includes(s.blackjackPays)) s.blackjackPays = [1.5, 1.2, 1].includes(Number(s.blackjackPays)) ? Number(s.blackjackPays) : (Number.isFinite(old.blackjackPays) ? old.blackjackPays : 1.5);
    s.sideBets = Array.isArray(s.sideBets) ? [...new Set(s.sideBets)].filter((k) => SIDE_KEYS.includes(k)) : (Array.isArray(old.sideBets) ? old.sideBets : DEFAULT_SETTINGS.sideBets);
    if (s.shuffleMode !== 'rounds') s.shuffleMode = 'penetration';
    s.shuffle8 = s.shuffle8 !== false;
    s.autoDeal = !!s.autoDeal;
    // The rules of play and 5 Card Charlie are the dealer's (setRules, dealerSave): a settings change or vote never touches them.
    for (const k of RULE_KEYS) s[k] = old[k];
    delete s.charlie;
    // There is no Deal or Stand for a slow player button: a round always starts and every move always ends on its own.
    if (!s.betTimer) s.autoDeal = true;
    if (!s.turnTimer) s.turnTimer = 30;
    s.seats = seatCount(s.seats, this.seats.length);
    if (s.seats < this.seats.length && this.inRound() && this.seats.slice(s.seats).some(Boolean)) throw new Error('Seats can be taken away when this round ends.');
    this.settings = s;
    // Growing adds empty seats at the end. Shrinking moves players down into free seats, and takes seats
    // away when there are not enough (shrinkSeats), always between rounds.
    while (this.seats.length < s.seats) this.seats.push(null);
    if (s.seats < this.seats.length) this.shrinkSeats(s.seats);
    if (old.decks !== s.decks) this.newShoe();
  }

  // The player who is the dealer pays every winner, so the dealer may set the largest main bet. Between rounds only.
  // "Big Bets Sometimes": the dealer lets each player bet above the normal maximum a few times, and those
  // chances run out after a set number of hands, then start again. The hand being bet on now (in a round it is
  // the round in play, between rounds it is the one about to be dealt) decides which window a bet falls in.
  bigHand() { return this.inRound() ? this.round : this.round + 1; }
  bigWindow() {
    const b = this.settings.bigBet;
    if (!b || !b.hands) return 0;
    return Math.floor((this.bigHand() - (b.since || 0)) / b.hands);
  }
  // How many big bets this player has left in the window that the current hand is in.
  bigLeft(clientId) {
    const b = this.settings.bigBet, p = this.players[clientId];
    if (!b || !b.per || !p) return 0;
    const used = p.bigWin === this.bigWindow() ? (p.bigUsed || 0) : 0;
    return Math.max(0, b.per - used);
  }
  // Hands left in this window, counting the hand being bet on or played now. At 1 this is the last hand before the big bets come back.
  bigHandsLeft() {
    const b = this.settings.bigBet;
    if (!b || !b.hands) return 0;
    return (b.since || 0) + (this.bigWindow() + 1) * b.hands - this.bigHand(); // counts the hand being bet on or played now
  }
  // The dealer turns the feature on or off and sets its three numbers. hands and per must be at least 1,
  // and the big amount must be above the normal maximum bet. Passing null (or any missing number) turns it off.
  setBigBet(clientId, cfg) {
    if (this.banker !== clientId) throw new Error('Only the dealer sets Big Bets Sometimes.');
    if (this.phase !== 'betting' && this.phase !== 'settled') throw new Error('Change this between rounds.');
    const name = this.players[clientId].name;
    if (!cfg || cfg.off) { if (this.settings.bigBet) { this.settings = { ...this.settings, bigBet: null }; this.addLog(`${name}, the dealer, turned Big Bets Sometimes off.`); this.ev('big bets off', clientId); } return; }
    const limit = Math.round(Number(cfg.limit)), per = Math.round(Number(cfg.per)), hands = Math.round(Number(cfg.hands));
    if (!(limit > this.settings.maxBet)) throw new Error(`The big bet amount has to be above the normal maximum of ${this.settings.maxBet}.`);
    if (!(per >= 1)) throw new Error('Each player needs at least 1 big bet.');
    if (!(hands >= 1)) throw new Error('The number of hands has to be at least 1.');
    if (limit > 1e9) throw new Error('That big bet amount is too large.');
    // A fresh window starts from the hand being bet on now, and everyone's used count goes back to zero.
    for (const q of Object.values(this.players)) { q.bigUsed = 0; q.bigWin = 0; }
    this.settings = { ...this.settings, bigBet: { limit, per, hands, since: this.bigHand() } };
    this.addLog(`${name}, the dealer, set Big Bets Sometimes: up to ${per} bet${per === 1 ? '' : 's'} of ${limit} each, every ${hands} hand${hands === 1 ? '' : 's'}.`);
    this.ev('big bets on', clientId, `${per} x ${limit} / ${hands}`);
  }

  // The shuffle every 8 rounds, on by default: the dealer turns it on or off (with no dealer, the host does).
  // 5 Card Charlie rounds: about 1 in n, picked at random as each betting round opens (0 = off).
  setCharlieEvery(clientId, n) { this.setRules(clientId, { charlieEvery: n }); }
  // The rules of play: the dealer's, or the host's while the house deals. Between rounds only; each change is
  // logged and shown to the table before the next deal.
  setRules(clientId, r = {}) {
    if (this.banker ? this.banker !== clientId : this.hostId && this.hostId !== clientId) throw new Error('Only the dealer changes the rules.');
    if (this.phase !== 'betting' && this.phase !== 'settled') throw new Error('Change the rules between rounds.');
    const ch = cleanRules(r, this.settings);
    if (!Object.keys(ch).length) return;
    this.settings = { ...this.settings, ...ch };
    if ('charlieEvery' in ch && this.phase === 'betting' && !ch.charlieEvery) this.charlieRound = false;
    const who = this.banker ? `${this.players[this.banker]?.name || 'The dealer'}, the dealer,` : 'The host';
    this.rulesNote = { ...(this.rulesNote || {}), ...ch }; // every change since the last deal
    this.addLog(`${who} changed the rules: ${Object.keys(ch).map((k) => RULE_TEXT[k](ch[k])).join('; ')}.`);
  }
  // The dealer makes the round now open for bets a 5 Card Charlie round (before the cards come out only).
  forceCharlie(clientId) {
    if (this.banker ? this.banker !== clientId : this.hostId && this.hostId !== clientId) throw new Error('Only the dealer can do that.');
    if (this.phase !== 'betting') throw new Error('Only while bets are open, before the cards come out.');
    if (this.charlieRound) return;
    this.charlieRound = true;
    this.addLog('The dealer made this round a 5 Card Charlie round.');
  }
  pickCharlie() { const n = this.settings.charlieEvery || 0; this.charlieRound = n > 0 && Math.random() < 1 / n; if (this.charlieRound) this.addLog('5 Card Charlie is on this round.'); }
  setShuffle8(clientId, on) {
    if (this.banker ? this.banker !== clientId : this.hostId && this.hostId !== clientId) throw new Error('Only the dealer turns the shuffle every 8 rounds on or off.');
    this.settings = { ...this.settings, shuffle8: !!on };
    this.addLog(`Shuffle every 8 rounds: ${on ? 'on' : 'off'}.`);
  }
  // ---- Stop at loss ----
  // A player dealer can set the most they are willing to lose while dealing (so they can step away). It is on by
  // default at 30 times the table's max bet, until the dealer types an amount. The loss counts from when they
  // started dealing (or turned it back on); buy ins do not count as losses. After the hand that reaches it, the
  // dealer seat is freed, like "Stop dealing after this round". A hand in play always finishes first.
  capAmount() { const c = this.lossCap; return c?.amount ?? 30 * this.settings.maxBet; }
  dealerPnl() { const b = this.players[this.banker]; return b ? b.chips - (b.totalIn ?? this.settings.startChips) : 0; }
  dealerLoss() { return this.banker && this.lossCap ? Math.max(0, Math.round((this.lossCap.base - this.dealerPnl()) * 100) / 100) : 0; }
  startLossCap() {
    const keep = this.lossCap && this.lossCap.id === this.banker ? this.lossCap : null;
    this.lossCap = { id: this.banker, on: keep ? keep.on : true, amount: keep ? keep.amount : null, base: this.dealerPnl() };
  }
  setLossCap(clientId, on, amount) {
    if (this.banker !== clientId) throw new Error('Only the dealer sets the stop at loss.');
    if (!this.lossCap || this.lossCap.id !== clientId) this.startLossCap();
    const c = this.lossCap;
    if (amount !== undefined && amount !== null && amount !== '') {
      const a = Math.round(Number(amount));
      if (!(a >= 1) || a > 1e9) throw new Error('Pick a loss of at least 1.');
      c.amount = a;
    }
    on = !!on;
    if (on && !c.on) c.base = this.dealerPnl(); // turned back on: losses count from now
    c.on = on;
    this.addLog(on ? `${this.players[clientId].name} stops dealing at a loss of ${this.capAmount()}.` : `${this.players[clientId].name} turned the stop at loss off.`);
    if (!this.inRound()) this.checkLossCap();
  }
  // Run when a round is settled (and when the cap changes between rounds).
  checkLossCap() {
    const c = this.lossCap, b = this.players[this.banker];
    if (!b || !c || !c.on || c.id !== this.banker || this.pendingBanker) return false;
    const lost = this.dealerLoss();
    if (lost < this.capAmount()) return false;
    if (b.chips < 0) return false;
    this.banker = null;
    this.addLog(`${b.name} lost ${lost} (stop at loss ${this.capAmount()}) and stopped dealing.`);
    this.ev('stopped dealing: loss cap', b.id, `lost ${lost} of ${this.capAmount()}`);
    return true;
  }

  // The dealer's Save: bet limits, shuffle every 8, Big Bets Sometimes and Stop at loss in one go. Everything is
  // checked first, so a bad number changes nothing. Only what differs from the table is applied.
  dealerSave(clientId, c = {}) {
    if (this.banker !== clientId) throw new Error('Only the dealer changes these.');
    if (this.phase !== 'betting' && this.phase !== 'settled') throw new Error('Change these between rounds.');
    const s = this.settings, num = (v, d) => (v === undefined || v === null || v === '' ? d : Math.round(Number(v)));
    const min = num(c.min, s.minBet), max = num(c.max, s.maxBet), side = num(c.side, s.maxSideBet);
    if (!(min >= 1)) throw new Error('The minimum bet has to be at least 1.');
    if (!(max >= min)) throw new Error(`The maximum bet cannot be below the minimum bet of ${min}.`);
    if (!(side >= 0)) throw new Error('The maximum side bet cannot be below 0.');
    if (min > 1e9 || max > 1e9 || side > 1e9) throw new Error('That amount is too large.');
    const big = c.big && c.big.on ? { limit: num(c.big.limit, 0), per: num(c.big.per, 0), hands: num(c.big.hands, 0) } : null;
    if (big) {
      if (!(big.limit > max)) throw new Error(`The big bet amount has to be above the maximum bet of ${max}.`);
      if (!(big.per >= 1) || !(big.hands >= 1)) throw new Error('Big bets each and Every need at least 1.');
      if (big.limit > 1e9) throw new Error('That big bet amount is too large.');
    }
    const capAmt = c.cap ? num(c.cap.amount, null) : null;
    if (c.cap && capAmt !== null && (!(capAmt >= 1) || capAmt > 1e9)) throw new Error('Pick a loss of at least 1.');
    if (min !== s.minBet) { this.settings = { ...this.settings, minBet: min }; this.addLog(`${this.players[clientId].name}, the dealer, set the minimum bet to ${min}.`); }
    if (max !== s.maxBet || side !== s.maxSideBet) this.setDealerMax(clientId, max, side);
    if (c.rules) cleanRules(c.rules, s); // checked before anything changes
    if (c.rules) this.setRules(clientId, c.rules);
    if (c.shuffle8 !== undefined && !!c.shuffle8 !== (this.settings.shuffle8 !== false)) this.setShuffle8(clientId, !!c.shuffle8);
    if (c.big !== undefined) {
      const b = this.settings.bigBet;
      if (!big) { if (b) this.setBigBet(clientId, { off: true }); }
      else if (!b || b.limit !== big.limit || b.per !== big.per || b.hands !== big.hands) this.setBigBet(clientId, big);
    }
    if (c.cap) {
      if (!this.lossCap || this.lossCap.id !== clientId) this.startLossCap();
      const k = this.lossCap;
      if (!!c.cap.on !== !!k.on || (capAmt !== null && capAmt !== this.capAmount())) this.setLossCap(clientId, !!c.cap.on, capAmt);
    }
  }

  setDealerMax(clientId, amount, sideAmount) {
    if (this.banker !== clientId) throw new Error('Only the dealer sets the maximum bets.');
    if (this.phase !== 'betting' && this.phase !== 'settled') throw new Error('Change the maximum bets between rounds.');
    const min = this.settings.minBet;
    const max = amount === undefined || amount === null ? this.settings.maxBet : Math.round(Number(amount));
    const side = sideAmount === undefined || sideAmount === null ? this.settings.maxSideBet : Math.round(Number(sideAmount));
    if (!(max >= min)) throw new Error(`The maximum bet cannot be below the minimum bet of ${min}.`);
    if (!(side >= 0)) throw new Error('The maximum side bet cannot be below 0.');
    if (max > 1e9 || side > 1e9) throw new Error('That maximum is too large.');
    const was = this.settings;
    this.settings = { ...was, maxBet: max, maxSideBet: side };
    // Bets already on the table that are now too large are cut to the new maximum.
    for (const seat of this.seats) {
      if (!seat || seat.hands.length) continue;
      const sides = {};
      for (const [k, v] of Object.entries(seat.bet.sides || {})) if (Math.min(v, side) > 0) sides[k] = Math.min(v, side);
      seat.bet = { ...seat.bet, main: Math.min(seat.bet.main, seat.bet.big && this.settings.bigBet ? this.settings.bigBet.limit : max), sides };
    }
    const name = this.players[clientId].name;
    // A big bet has to be above the normal maximum. If the new maximum reaches it, big bets are switched off.
    if (this.settings.bigBet && max >= this.settings.bigBet.limit) {
      this.settings = { ...this.settings, bigBet: null };
      for (const seat of this.seats) if (seat && !seat.hands.length && seat.bet.big) seat.bet = { ...seat.bet, big: false, main: Math.min(seat.bet.main, max) };
      this.addLog(`Big Bets Sometimes is off, because the maximum bet is now ${max}, the same as or above the big bet amount.`);
    }
    if (max !== was.maxBet) { this.addLog(`${name}, the dealer, set the maximum bet to ${max}.`); this.ev('dealer set maximum bet', clientId, String(max)); }
    if (side !== was.maxSideBet) { this.addLog(`${name}, the dealer, set the maximum side bet to ${side}.`); this.ev('dealer set maximum side bet', clientId, String(side)); }
  }

  // Fewer seats. When there are more taken seats than the new number, seats are taken away fairly: each time
  // from whoever holds the most seats (their highest seat first), so a player with one seat only loses it when
  // everyone left has one seat; then the highest seat numbers go. The rest move down into the free seats, in
  // order. Bets on a seat that goes away were never taken from the chips (that happens at the deal), so no
  // chips move. Between rounds only.
  shrinkSeats(n) {
    const taken = [];
    this.seats.forEach((x, i) => { if (x) taken.push(i); });
    const drop = new Set();
    const count = (id) => taken.filter((i) => !drop.has(i) && this.seats[i].playerId === id).length;
    while (taken.length - drop.size > n) {
      const left = taken.filter((i) => !drop.has(i));
      const most = Math.max(...left.map((i) => count(this.seats[i].playerId)));
      const pick = left.filter((i) => count(this.seats[i].playerId) === most).pop(); // highest seat of a player holding the most
      drop.add(pick);
    }
    const lost = {};
    for (const i of drop) { const id = this.seats[i].playerId; lost[id] = (lost[id] || 0) + 1; }
    const keep = taken.filter((i) => !drop.has(i)).map((i) => this.seats[i]);
    // Seats below the new number keep their place; the others move to the lowest free seats.
    const next = Array(n).fill(null), moved = [];
    for (const i of taken) if (!drop.has(i) && i < n) next[i] = this.seats[i];
    for (const i of taken) if (!drop.has(i) && i >= n) { const j = next.indexOf(null); next[j] = this.seats[i]; moved.push(this.seats[i].playerId); }
    if (keep.length !== next.filter(Boolean).length) throw new Error('Seat count mix-up.'); // never happens: kept seats always fit
    this.seats = next;
    for (const p of Object.values(this.players)) this.fixSeat(p);
    const name = (id) => this.players[id]?.name || 'A player';
    const parts = Object.entries(lost).map(([id, k]) => (this.seatsOf(id).length ? `${name(id)} gave up ${k} seat${k > 1 ? 's' : ''}` : `${name(id)} stood up`));
    this.addLog(`The table now has ${n} seat${n > 1 ? 's' : ''}.${parts.length ? ' ' + parts.join(', ') + '.' : ''}${moved.length ? ` ${[...new Set(moved)].map(name).join(', ')} moved to a lower seat.` : ''}`);
    if (Object.keys(lost).length) this.ev('seats taken away', null, Object.entries(lost).map(([id, k]) => `${name(id)} ${k}`).join(', '));
  }

  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 40) this.log.shift();
  }

  // ---- Record for the hand history: who did what and when. Kept until the round it belongs to is stored. ----
  ev(k, clientId, d) {
    this.evts = this.evts || [];
    const p = clientId ? this.players[clientId] : null;
    const e = { t: Date.now(), k, who: p ? p.name : '' };
    if (d !== undefined && d !== '') e.d = d;
    this.evts.push(e);
    if (this.evts.length > 600) this.evts.splice(0, this.evts.length - 600);
  }

  // ---- Players ----
  join(clientId, name, buyIn, look) {
    name = String(name || 'Player').trim().slice(0, 16) || 'Player';
    // How the player's character looks in the 3D room: a skin tone and a hair colour.
    const lk = { skin: clamp(Math.round(Number(look?.skin ?? 2)) || 0, 0, 5), hair: clamp(Math.round(Number(look?.hair ?? 0)) || 0, 0, 4), flag: /^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(String(look?.flag || '')) ? String(look.flag) : '' };
    let p = this.players[clientId];
    if (p) {
      if (!p.connected) this.ev('reconnect', clientId);
      p.connected = true;
      p.gone = false;
      p.name = name;
      if (look) p.look = lk;
      return p;
    }
    // Each player says how much they buy in for when they arrive. Any positive amount is fine.
    const start = Math.round(Number(buyIn)) > 0 ? Math.min(MAX_CHIPS, Math.round(Number(buyIn))) : this.settings.startChips;
    p = { id: clientId, name, chips: start, seat: null, connected: true, lastBet: null, totalIn: start, look: lk, joinT: Date.now() };
    this.players[clientId] = p;
    if (this.frozen && this.frozenSnap) this.frozenSnap[clientId] = this.snapOf(p);
    this.addLog(`${name} joined.`);
    this.ev('join', clientId, `buy-in ${start}`);
    return p;
  }

  // Freezing the ledger starts a practice stretch. When it stops, every player's chips, buy-ins and
  // results go back to what they were just before it started. Only the cards carry on: the shoe is
  // not touched. The practice rounds stay in the hand history, marked as practice.
  snapOf(p) { return { chips: p.chips, totalIn: p.totalIn, boughtIn: p.boughtIn || 0, houseNet: p.houseNet || 0, streak: p.streak || 0 }; }
  // who: the office colleague who deals the practice rounds (picked at random by the host's browser), or none.
  setFrozen(on, who = null) {
    on = !!on;
    if (on === !!this.frozen) return;
    if (this.inRound()) throw new Error('Wait for the round to end.');
    this.frozen = on;
    this.houseDealer = on && typeof who === 'string' ? who.slice(0, 30) : null;
    if (on) {
      this.frozenSnap = {};
      for (const p of Object.values(this.players)) this.frozenSnap[p.id] = this.snapOf(p);
      this.ev('ledger frozen (practice starts)');
    } else {
      for (const p of Object.values(this.players)) { const o = this.frozenSnap?.[p.id]; if (o) Object.assign(p, o); p.lastBet = null; p.lastBets = null; }
      this.frozenSnap = null;
      this.buyIns = [];
      this.startBetting();
      this.ev('ledger unfrozen (chips and buy-ins are back to before the practice)');
    }
  }

  // The seats one player holds, lowest first. p.seat is always the first of them (or null).
  seatsOf(clientId) {
    const out = [];
    this.seats.forEach((s, i) => { if (s && s.playerId === clientId) out.push(i); });
    return out;
  }
  // A player whose every seat is sitting out is away: they are not asked to vote.
  allOut(id) { const mine = this.seatsOf(id); return mine.length > 0 && mine.every((i) => this.seats[i].out); }
  fixSeat(p) { const o = this.seatsOf(p.id); p.seat = o.length ? o[0] : null; }
  clearSeats(p) { this.seatsOf(p.id).forEach((i) => { this.seats[i] = null; }); p.seat = null; }

  sit(clientId, seatIdx, add = false) {
    const p = this.mustPlayer(clientId);
    if (seatIdx < 0 || seatIdx >= this.seats.length || !Number.isInteger(seatIdx)) throw new Error('No such seat.');
    if (this.banker === clientId) throw new Error('Leave the dealer seat first.');
    if (this.seats[seatIdx]) throw new Error('That seat is taken.');
    // One person can hold two or more seats (add). Each seat has its own bets and hand; the chips are
    // shared. Without add, sitting somewhere else is a move.
    if (!add) {
      const mine = this.seatsOf(clientId);
      if (this.inRound() && mine.some((i) => this.seats[i].hands.length)) throw new Error('Finish this round first.');
      mine.forEach((i) => { this.seats[i] = null; });
    }
    this.seats[seatIdx] = emptySeat(clientId);
    this.fixSeat(p);
    this.ev('sit', clientId, `seat ${seatIdx + 1}`);
    this.regroup();
  }

  // A player can sit as the dealer. The dealer still follows the fixed rules,
  // but their chips act as the bank: they collect what players lose and pay what players win.
  sitDealer(clientId) {
    const p = this.mustPlayer(clientId);
    if (this.inRound()) throw new Error('Wait for the round to end.');
    if (this.banker && this.banker !== clientId) throw new Error('Someone is already the dealer.');
    this.clearSeats(p);
    if (this.frozen) this.setFrozen(false); // a player deals now: the practice stretch is over
    this.banker = clientId;
    this.startLossCap();
    this.addLog(`${p.name} is now the dealer.`);
  }

  // Moving to the dealer seat needs everyone else's approval. A vote that
  // runs out counts as "no".
  requestDealer(clientId) {
    const p = this.mustPlayer(clientId);
    if (this.banker === clientId) throw new Error('You are already the dealer.');
    if (this.vote) throw new Error('A vote is already running.');
    const voters = Object.values(this.players)
      .filter((x) => x.id !== clientId && x.connected && !x.kicked && !this.allOut(x.id))
      .map((x) => x.id);
    this.voteSeq = (this.voteSeq || 0) + 1;
    if (!voters.length) { this.applyDealer(clientId); return null; }
    this.vote = { id: this.voteSeq, candidate: clientId, voters, votes: {} };
    this.addLog(`${p.name} asked to be the dealer. Everyone else votes.`);
    return this.vote.id;
  }

  // A settings change, from the host or from any player, needs a yes from everyone else who is online.
  proposeSettings(hostId, patch, summary) {
    if (this.vote) throw new Error('A vote is already running.');
    const voters = Object.values(this.players).filter((x) => x.id !== hostId && x.connected && !x.kicked && !this.allOut(x.id)).map((x) => x.id);
    this.voteSeq = (this.voteSeq || 0) + 1;
    // A change of the seat count alone passes when all but one say yes: one player away from the screen
    // (often the dealer) does not hold it up.
    const seatsOnly = Object.keys(patch || {}).every((k) => k === 'seats') && 'seats' in (patch || {});
    const need = Math.max(0, voters.length - (seatsOnly ? 1 : 0));
    if (!need) { this.applySettings(patch); return null; }
    this.vote = { id: this.voteSeq, kind: 'settings', candidate: hostId, patch, summary, voters, votes: {}, need };
    this.addLog(`${this.players[hostId]?.name || 'A player'} proposed new settings. Everyone else votes.`);
    return this.vote.id;
  }

  applySettings(patch) {
    if (this.inRound()) { this.pendingSettings = { ...(this.pendingSettings || {}), ...patch }; return; }
    this.pendingSettings = null;
    // Someone may have sat down in a seat that was going away while the vote or the round was running.
    try { this.updateSettings(patch); } catch (e) { this.addLog(`The settings stay the same. ${e.message}`); return; }
    this.addLog('New settings are in.');
  }

  castVote(clientId, yes) {
    const v = this.vote;
    if (!v || !v.voters.includes(clientId) || clientId in v.votes) return;
    v.votes[clientId] = !!yes;
    const name = this.players[v.candidate].name;
    const need = v.need ?? v.voters.length;
    const yesN = v.voters.filter((id) => v.votes[id] === true).length, noN = v.voters.filter((id) => v.votes[id] === false).length;
    if (need < v.voters.length) { // all but one: one no is allowed
      if (yesN >= need) { this.vote = null; this.addLog(`${yesN} of ${v.voters.length} said yes to the new settings.`); this.applySettings(v.patch); return; }
      if (noN > v.voters.length - need) { this.vote = null; this.addLog(`${this.players[clientId].name} voted no too. The settings stay the same.`); }
      return;
    }
    if (!yes) {
      this.vote = null;
      this.addLog(v.kind === 'settings' ? `${this.players[clientId].name} voted no. The settings stay the same.` : `${this.players[clientId].name} voted no. ${name} stays where they are.`);
      return;
    }
    if (v.voters.every((id) => v.votes[id] === true)) {
      this.vote = null;
      if (v.kind === 'settings') { this.addLog('Everyone said yes to the new settings.'); this.applySettings(v.patch); return; }
      this.addLog(`Everyone said yes. ${name} moves to the dealer seat.`);
      this.applyDealer(v.candidate);
    }
  }

  expireVote(voteId) {
    if (!this.vote || this.vote.id !== voteId) return;
    const v = this.vote;
    if (v.kind === 'settings' && v.voters.filter((id) => v.votes[id] === true).length >= (v.need ?? v.voters.length)) { this.vote = null; this.addLog('Enough players said yes to the new settings.'); this.applySettings(v.patch); return; }
    this.addLog(this.vote.kind === 'settings' ? 'The settings vote ran out, so the answer is no.' : `The vote for ${this.players[this.vote.candidate].name} ran out, so the answer is no.`);
    this.vote = null;
  }

  // Move a player to the dealer seat now, or after the current round.
  applyDealer(clientId) {
    if (this.inRound()) { this.pendingBanker = clientId; return; }
    const p = this.players[clientId];
    if (!p) return;
    this.clearSeats(p);
    if (this.frozen) this.setFrozen(false); // a player deals now: the practice stretch is over
    this.banker = clientId;
    this.pendingBanker = null;
    this.dealerAutoBuy();
    this.startLossCap();
    this.addLog(`${p.name} is now the dealer.`);
  }

  leaveDealer(clientId) {
    if (this.banker !== clientId) return;
    if (this.inRound()) throw new Error('Wait for the round to end.');
    if (this.players[clientId].chips < 0) throw new Error('The dealer owes chips. Buy in to cover them before leaving the dealer seat.');
    this.banker = null;
    this.addLog(`${this.players[clientId].name} left the dealer seat.`);
  }

  // Leave one seat (seatIdx) or, with no seat named, every seat the player holds.
  standUp(clientId, seatIdx) {
    const p = this.mustPlayer(clientId);
    const mine = this.seatsOf(clientId);
    const go = Number.isInteger(seatIdx) ? mine.filter((i) => i === seatIdx) : mine;
    if (!go.length) return;
    if (this.inRound() && go.some((i) => this.seats[i].hands.length)) throw new Error('Finish this round first.');
    for (const i of go) { this.ev('leave seat', clientId, `seat ${i + 1}`); this.seats[i] = null; }
    this.fixSeat(p);
    this.regroup();
  }

  // The dealer (or the host when the house deals) takes a player out of a seat. The player keeps the chips and
  // watches. A hand in play on that seat is finished first: the seat is freed when that round is settled.
  dealerUnseat(byId, seatIdx) {
    if (this.banker ? this.banker !== byId : this.hostId && this.hostId !== byId) throw new Error('Only the dealer can unseat a player.');
    const seat = this.seats[seatIdx];
    if (!seat || seat.playerId === byId) return;
    const p = this.players[seat.playerId];
    if (this.inRound() && seat.hands.length) {
      if (seat.leaving && seat.byDealer) { seat.leaving = false; seat.byDealer = false; this.addLog(`The dealer lets ${p?.name || 'the player'} stay in seat ${seatIdx + 1}.`); return; }
      seat.leaving = true; seat.byDealer = true;
      this.addLog(`The dealer unseats ${p?.name || 'a player'} from seat ${seatIdx + 1} after this hand.`);
      return;
    }
    this.ev('unseated by the dealer', seat.playerId, `seat ${seatIdx + 1}`);
    this.seats[seatIdx] = null;
    if (p) { this.fixSeat(p); this.addLog(`The dealer unseated ${p.name} from seat ${seatIdx + 1}.`); this.markUnseated([p.id], true); }
    this.regroup();
  }
  markUnseated(ids, dealer = false) { this.unseatSeq = (this.unseatSeq || 0) + 1; this.unseated = { round: 'u' + this.unseatSeq, ids, dealer }; }

  disconnect(clientId) {
    const p = this.players[clientId];
    if (!p) return;
    if (p.connected) this.ev('disconnect', clientId);
    p.connected = false;
  }

  // A player who lost the connection gets a short while to come back (the host's browser keeps the
  // clock). When that time is up they count as gone: the hand they are on is stood, a pending
  // insurance offer is turned down, and their later turns are skipped until they return.
  markGone(clientId) {
    const p = this.players[clientId];
    if (!p || p.connected) return false;
    p.gone = true;
    const live = this.seatsOf(clientId).map((i) => this.seats[i]).filter((x) => x.hands.length);
    if (!live.length) return true;
    if (this.phase === 'insurance' && live.some((x) => !x.insuranceDecided)) {
      live.forEach((x) => { x.insuranceDecided = true; });
      if (this.allInsuranceDecided()) this.afterInsurance();
    } else if (this.phase === 'playing' && this.turn && this.seats[this.turn.seat]?.playerId === clientId) {
      // With 11 or less the table hits for them first (awayMove, run by the host's clock); otherwise it stands.
      const th = this.seats[this.turn.seat].hands[this.turn.hand];
      if (handTotal(th.cards).total > 11) { this.addLog(`${p.name} is away, dealer stands.`); this.skipTurn(); }
    }
    return true;
  }

  kick(clientId) {
    const p = this.players[clientId];
    if (!p) return;
    this.ev('removed by the host', clientId);
    for (const i of this.seatsOf(clientId)) {
      const seat = this.seats[i];
      if (this.inRound() && seat.hands.length) {
        // Stand all of their hands so the round can finish.
        seat.hands.forEach((h) => { if (!h.done) h.done = true; });
        seat.insuranceDecided = true;
      } else this.seats[i] = null;
    }
    this.fixSeat(p);
    if (this.banker === clientId && !this.inRound()) this.banker = null;
    p.kicked = true;
    p.connected = false;
    p.gone = true;
    // If it was their turn, the round moves on.
    if (this.phase === 'playing' && this.turn && this.seats[this.turn.seat]?.playerId === clientId) this.advance();
  }

  // Buying in more play chips. The host approves each request.
  requestBuyIn(clientId, amount) {
    const p = this.mustPlayer(clientId);
    amount = Math.round(Number(amount) || 0);
    if (!(amount >= 1)) throw new Error('Pick an amount of at least 1.');
    if (amount > MAX_CHIPS) throw new Error('The most you can buy in at once is 1,000,000,000.');
    this.buyIns = this.buyIns || [];
    if (this.buyIns.some((b) => b.playerId === clientId)) throw new Error('You already have a buy-in waiting for the host.');
    this.buyInSeq = (this.buyInSeq || 0) + 1;
    const req = { id: this.buyInSeq, playerId: clientId, amount };
    this.buyIns.push(req);
    return req;
  }

  answerBuyIn(reqId, yes) {
    this.buyIns = this.buyIns || [];
    const i = this.buyIns.findIndex((b) => b.id === reqId);
    if (i < 0) return;
    const req = this.buyIns.splice(i, 1)[0];
    const p = this.players[req.playerId];
    if (!p) return;
    if (yes) {
      p.chips += req.amount;
      p.boughtIn = (p.boughtIn || 0) + req.amount;
      p.totalIn = (p.totalIn ?? this.settings.startChips) + req.amount;
      this.addLog(`${p.name} bought in ${req.amount.toLocaleString()} more chips.`);
      this.ev('buy-in', req.playerId, `${req.amount}, balance ${p.chips}`);
    } else {
      this.addLog(`The host said no to ${p.name}'s buy-in.`);
    }
  }

  // Walking to another table of the office with the chips (one wallet). The chips leave as cashed out: the
  // buy-in total goes down by the same amount, so the player's +/- here stays the same and the ledger still
  // adds up to zero. Chips in a hand that is being played stay until it ends.
  cashOut(clientId) {
    const p = this.mustPlayer(clientId);
    // The dealer walking to another table stops dealing by itself: between rounds at once, in a round after it
    // is settled (the hand always plays to its real result). Chips can only go along once the dealer seat is free.
    if (this.banker === clientId) {
      if (this.inRound()) { if (!this.bankerLeaving) { this.bankerLeaving = true; this.addLog(`${p.name} walked to another table and stops dealing after this round.`); } return 0; }
      this.leaveDealer(clientId);
    }
    const mine = this.seatsOf(clientId);
    if (this.inRound() && mine.some((i) => this.seats[i].hands.length)) throw new Error('Your hand is still being played. Walk over when this round ends.');
    for (const i of mine) { const s = this.seats[i]; s.bet = { main: 0, sides: {} }; s.ready = false; }
    const snap = this.frozen ? this.frozenSnap?.[clientId] : null, from = snap || p;
    const amount = Math.max(0, Math.round(from.chips));
    if (!amount) return 0;
    from.chips -= amount; from.totalIn = (from.totalIn ?? this.settings.startChips) - amount;
    if (snap) p.chips = 0;
    this.buyIns = (this.buyIns || []).filter((b) => b.playerId !== clientId);
    this.addLog(`${p.name} walked to another table with ${amount.toLocaleString()} chips.`);
    this.ev('cash-out', clientId, `${amount} to another table`);
    return amount;
  }
  // Chips a player brings from another table. A player who has only just joined gets exactly those chips
  // in place of the buy-in they joined with.
  carryIn(clientId, amount, fromName, cid) {
    const p = this.mustPlayer(clientId);
    amount = Math.round(Number(amount));
    if (!(amount > 0) || amount > MAX_CHIPS) return 0;
    p.carried ||= [];
    if (cid && p.carried.includes(cid)) return 0;
    if (cid) { p.carried.push(String(cid).slice(0, 40)); if (p.carried.length > 8) p.carried.shift(); }
    const snap = this.frozen ? this.frozenSnap?.[clientId] : null;
    const fresh = p.joinT && Date.now() - p.joinT < 30000 && p.chips === p.totalIn && !this.seatsOf(clientId).some((i) => this.seats[i].hands.length || this.seats[i].bet.main);
    for (const x of snap ? [p, snap] : [p]) { if (fresh) { x.chips = amount; x.totalIn = amount; } else { x.chips += amount; x.totalIn = (x.totalIn ?? this.settings.startChips) + amount; } }
    delete p.joinT;
    this.addLog(`${p.name} brought ${amount.toLocaleString()} chips from ${String(fromName || 'another table').slice(0, 20)}.`);
    this.ev('buy-in', clientId, `${amount} brought from ${fromName}, balance ${p.chips}`);
    return amount;
  }

  giveChips(clientId, amount) {
    const p = this.mustPlayer(clientId);
    const before = p.chips;
    p.chips = Math.max(0, p.chips + Math.round(Number(amount) || 0));
    // Chips the host gives count as a buy-in; chips taken count as cashed out.
    p.totalIn = (p.totalIn ?? this.settings.startChips) + (p.chips - before);
  }

  // Sit a seat out, or back in. The player keeps the seat; it gets no cards and nobody waits for it.
  // In a round the hand in play is still finished: the seat is out from the next round.
  sitOut(clientId, seatIdx, on) {
    const { seat, idx } = this.mustSeat(clientId, seatIdx);
    if (!!seat.out === !!on) return;
    seat.out = !!on;
    if (on && !seat.hands.length && (this.phase === 'betting' || this.phase === 'settled')) { seat.bet = { main: 0, sides: {} }; seat.ready = false; }
    this.ev(on ? 'sit out' : 'sit back in', clientId, `seat ${idx + 1}`);
  }

  // Leaving a seat. Between rounds the seat frees at once. With a hand in play there, the seat is marked and
  // frees when the round is over (the hand always plays to a real result). Pressing it again calls it off.
  leaveSeat(clientId, seatIdx) {
    const { seat, idx } = this.mustSeat(clientId, seatIdx);
    if (seat.leaving && seat.byDealer) throw new Error('The dealer has unseated you after this hand.');
    if (seat.leaving) { seat.leaving = false; this.ev('stays in the seat', clientId, `seat ${idx + 1}`); return; }
    if (this.inRound() && seat.hands.length) { seat.leaving = true; this.ev('leaves this seat after the round', clientId, `seat ${idx + 1}`); return; }
    this.standUp(clientId, idx);
  }

  // "Leave after this round" (players) and "Stop dealing after this round" (the player who is the dealer).
  // In a round it only marks the player, and pressing again (on = false) calls it off. The player leaves the
  // seats when the round is over; the dealer leaves the dealer seat when the round is settled. Between rounds it happens at once.
  leaveLater(clientId, on = true) {
    const p = this.mustPlayer(clientId);
    if (this.banker === clientId) {
      if (!on) { if (this.bankerLeaving) { this.bankerLeaving = false; this.addLog(`${p.name} keeps dealing after all.`); } return; }
      if (this.inRound()) { if (!this.bankerLeaving) { this.bankerLeaving = true; this.addLog(`${p.name} stops dealing after this round.`); } return; }
      this.leaveDealer(clientId);
      return;
    }
    if (!on) { if (p.leaving) { p.leaving = false; this.addLog(`${p.name} stays at the table after all.`); } return; }
    const mine = this.seatsOf(clientId);
    if (!mine.length) return;
    if (this.inRound() && mine.some((i) => this.seats[i].hands.length)) { if (!p.leaving) { p.leaving = true; this.addLog(`${p.name} leaves after this round.`); } return; }
    this.standUp(clientId);
  }
  // A seated player agreed to sit out. Between rounds they leave now; in a round they leave when it ends.
  leaveAfter(clientId) {
    const p = this.mustPlayer(clientId);
    const mine = this.seatsOf(clientId);
    if (!mine.length) return false;
    if (this.inRound() && mine.some((i) => this.seats[i].hands.length)) { p.leaving = true; return true; }
    this.standUp(clientId);
    return true;
  }

  mustPlayer(clientId) {
    const p = this.players[clientId];
    if (!p) throw new Error('Unknown player.');
    return p;
  }

  // The seat a message is about. A player with several seats names one; without a name it is their first.
  mustSeat(clientId, seatIdx) {
    const p = this.mustPlayer(clientId);
    if (p.seat === null) throw new Error('Take a seat first.');
    const idx = Number.isInteger(seatIdx) && this.seats[seatIdx]?.playerId === clientId ? seatIdx : p.seat;
    return { p, seat: this.seats[idx], idx };
  }

  inRound() {
    return ['insurance', 'playing', 'dealer'].includes(this.phase);
  }

  // Pay to look at the next card in the shoe, just out of curiosity. The fee goes to the player dealer;
  // with frozen balances nobody's chips move, so it is free.
  peek(clientId) {
    const p = this.mustPlayer(clientId);
    if (this.inRound()) throw new Error('The next card can be shown once the round is over, not while a hand is being played.');
    if (!this.rabbit) throw new Error('The next card can be shown right after a round, before anyone bets on the next one.');
    if (!this.shoe.length) throw new Error('The shoe is empty. It is reshuffled before the next card.');
    const cost = this.settings.peekCost ?? 10;
    if (this.banker && this.banker !== clientId) {
      if (p.chips < cost) throw new Error(`Seeing the next card costs ${cost}.`);
      p.chips -= cost;
      this.players[this.banker].chips += cost;
      this.addLog(`${p.name} paid ${cost} to see the next card.`);
    } else this.addLog(`${p.name} looked at the next card.`);
    // Like a rabbit hunt in poker: the card that would have come next is shown to all and then leaves
    // the shoe, so nobody can size the next bet on a card they already know. One look per round.
    this.rabbit = false;
    return this.pick('peek');
  }

  // ---- Betting ----
  setBet(clientId, bet) {
    try { return this.setBetInner(clientId, bet); } finally { this.dealerAutoBuy(); }
  }
  setBetInner(clientId, bet) {
    if (!bet || typeof bet !== 'object') throw new Error('That bet could not be read.');
    if (this.phase !== 'betting' && this.phase !== 'settled') throw new Error('Bets are closed.');
    if (this.phase === 'settled') this.startBetting();
    const { p, seat, idx } = this.mustSeat(clientId, bet.seat);
    if (seat.out) throw new Error('This seat is sitting out. Tap "Sit back in" on it first.');
    const s = this.settings;
    const main = Math.max(0, Math.round(Number(bet.main) || 0));
    const sides = {};
    const on = s.sideBets || SIDE_KEYS;
    for (const k of SIDE_KEYS) {
      const v = Math.max(0, Math.round(Number(bet.sides?.[k]) || 0));
      if (v > 0) {
        if (!on.includes(k)) throw new Error(`${SIDE_BETS[k].name} is not offered at this table.`);
        if (main === 0) throw new Error('Place a main bet before side bets.');
        if (v > s.maxSideBet) throw new Error(`Side bets are at most ${s.maxSideBet}.`);
        sides[k] = v;
      }
    }
    // Chips can go down one at a time; the minimum only counts once you say you are ready.
    if (bet.ready && main < s.minBet) throw new Error(`Minimum bet is ${s.minBet}. Add more chips before you deal in.`);
    let big = false;
    if (main > s.maxBet) {
      const b = s.bigBet;
      if (!b || !bet.big) throw new Error(`Maximum bet is ${s.maxBet}.`);
      if (main > b.limit) throw new Error(`A big bet is at most ${b.limit}.`);
      // How many big bets this player has put down on their other seats for this hand already.
      const othersBig = this.seatsOf(clientId).filter((i) => i !== idx && this.seats[i].bet.main > s.maxBet).length;
      if (this.bigLeft(clientId) - othersBig < 1) throw new Error('You have no big bets left this window.');
      big = true;
    }
    const total = main + sumValues(sides);
    if (total + this.otherStakes(clientId, idx) > p.chips) throw new Error('Not enough chips.');
    seat.bet = { main, sides, big };
    if (main || Object.values(sides).some(Boolean)) this.rabbit = false; // a new round has begun: the look at the next card is over
    seat.ready = main > 0 && !!bet.ready;
    // The number the player's browser gave this bet. It comes back in their state, so the browser
    // knows which of its own taps the table has already counted.
    seat.betSeq = Number(bet.seq) || 0;
    seat.auto = !!bet.auto && !this.banker && !!this.frozen; // put down by the practice auto player
  }

  // The player's bet from the last round they played, cut down to what fits now: their chips, the
  // table limits and the side bets still offered. Null if there is none.
  // Nothing is placed here; the player presses Rebet and it goes through setBet like any other bet.
  otherStakes(clientId, idx) {
    if (this.phase !== 'betting') return 0; // bets left on the felt from a finished round are cleared before the next one
    return this.seatsOf(clientId).reduce((a, i) => a + (i === idx ? 0 : this.seats[i].bet.main + sumValues(this.seats[i].bet.sides)), 0);
  }
  rebetFor(clientId, seatIdx) {
    const p = this.players[clientId];
    if (!p || p.seat === null) return null;
    const idx = Number.isInteger(seatIdx) ? seatIdx : p.seat;
    const last = p.lastBets ? p.lastBets[idx] : p.lastBet;
    if (!last || !(last.main > 0) || this.seats[idx]?.playerId !== clientId) return null;
    const s = this.settings;
    let left = p.chips - this.otherStakes(clientId, idx);
    const main = Math.min(last.main, s.maxBet, left);
    if (!(main > 0)) return null;
    left -= main;
    const on = s.sideBets || SIDE_KEYS;
    const sides = {};
    for (const k of SIDE_KEYS) {
      const v = Math.min(last.sides?.[k] || 0, s.maxSideBet, left);
      if (!(v > 0) || !on.includes(k)) continue;
      sides[k] = v;
      left -= v;
    }
    return { main, sides };
  }

  startBetting() {
    if (this.phase !== 'settled' && this.phase !== 'betting') return;
    this.phase = 'betting';
    this.ledgerHold = null;
    this.pickCharlie();
    this.dealer = { cards: [], revealed: false };
    this.turn = null;
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (!seat) continue;
      const p = this.players[seat.playerId];
      if (p.kicked || p.leaving || seat.leaving) { if (seat.byDealer && !p.kicked) this.markUnseated([p.id], true); this.seats[i] = null; this.fixSeat(p); continue; }
      // Every round starts with empty betting spots; players put fresh chips down.
      this.seats[i] = emptySeat(seat.playerId);
      if (seat.out) this.seats[i].out = true; // a seat that sits out stays out until its player comes back in
    }
    for (const p of Object.values(this.players)) if (p.leaving) { p.leaving = false; this.ev('leave seat (agreed to sit out)', p.id); }
    this.regroup();
  }

  // A player with several seats always has them side by side. Between rounds, with no bets down, the
  // seats are moved so that every player's seats form one block. Of all ways to do that, the one that
  // moves the fewest seats is used, so players stay where they are when they can.
  regroup() {
    if (this.inRound()) return false;
    const n = this.seats.length, old = this.seats.map((x) => (x ? x.playerId : null));
    if (this.seats.some((x) => x && (x.hands.length || x.ready || x.bet.main || sumValues(x.bet.sides)))) return false;
    const ids = [...new Set(old.filter(Boolean))];
    const sizes = ids.map((id) => old.filter((x) => x === id).length);
    const together = ids.every((id, k) => old.lastIndexOf(id) - old.indexOf(id) + 1 === sizes[k]);
    if (together || ids.length > 7) return false;
    const free = n - sizes.reduce((a, b) => a + b, 0);
    let best = null, bestCost = Infinity;
    const used = ids.map(() => false), plan = [];
    const seatsBy = Object.fromEntries(ids.map((id) => [id, this.seatsOf(id)]));
    // Blocks go down left to right; `at` is the next seat, `gaps` the empty seats still to place.
    const walk = (at, gaps, cost) => {
      if (cost > bestCost) return;
      if (plan.length === ids.length) {
        let c = cost; for (let i = at; i < n; i++) if (old[i] !== null) c++;
        // Equal number of moved seats: the plan that moves them the shortest way wins.
        let far = 0;
        for (const b of plan) { const was = seatsBy[b.id], to = was.map((_, j) => b.from + j), open = to.filter((i) => !was.includes(i)); was.filter((i) => !to.includes(i)).forEach((i, j) => { far += Math.abs(open[j] - i); }); }
        c += far / 1000;
        if (c < bestCost) { bestCost = c; best = plan.map((x) => ({ ...x })); }
        return;
      }
      for (let g = 0; g <= gaps; g++) {
        let c = cost; for (let i = at; i < at + g; i++) if (old[i] !== null) c++;
        for (let k = 0; k < ids.length; k++) {
          if (used[k]) continue;
          let c2 = c; const from = at + g;
          for (let i = from; i < from + sizes[k]; i++) if (old[i] !== ids[k]) c2++;
          used[k] = true; plan.push({ id: ids[k], from });
          walk(from + sizes[k], gaps - g, c2);
          plan.pop(); used[k] = false;
        }
      }
    };
    walk(0, free, 0);
    if (!best) return false;
    const next = Array(n).fill(null);
    for (const b of best) {
      const was = this.seatsOf(b.id), map = {};
      // A seat already inside the new block stays where it is; the others fill the places left in the block.
      const to = was.map((_, j) => b.from + j), stay = was.filter((i) => to.includes(i)), open = to.filter((i) => !was.includes(i));
      for (const i of stay) map[i] = i;
      was.filter((i) => !stay.includes(i)).forEach((i, j) => { map[i] = open[j]; });
      for (const i of was) next[map[i]] = this.seats[i];
      const p = this.players[b.id];
      if (p && p.lastBets) p.lastBets = Object.fromEntries(Object.entries(p.lastBets).map(([i, v]) => [map[i] ?? i, v]));
      const moved = was.filter((i) => map[i] !== i);
      if (moved.length) this.ev('seats moved together', b.id, moved.map((i) => `seat ${i + 1} to ${map[i] + 1}`).join(', '));
    }
    this.seats = next;
    for (const p of Object.values(this.players)) this.fixSeat(p);
    return true;
  }

  // The dealer buys in by itself, with no request to the host: whenever the dealer owes chips or holds
  // fewer chips than the bets on the table, the dealer gets enough to cover them, in steps of the
  // table's starting chips. It is written to the ledger and the hand history like any other buy-in.
  dealerAutoBuy() {
    const p = this.banker && this.players[this.banker];
    if (!p) return 0;
    const onTable = this.seats.reduce((a, s) => a + (s && s.bet.main >= this.settings.minBet ? s.bet.main + sumValues(s.bet.sides) : 0), 0);
    const need = onTable - p.chips;
    if (!(need > 0)) return 0;
    const step = Math.max(1, Math.round(this.settings.startChips) || 1000);
    const amount = Math.ceil(need / step) * step;
    p.chips += amount;
    p.boughtIn = (p.boughtIn || 0) + amount;
    p.totalIn = (p.totalIn ?? this.settings.startChips) + amount;
    this.buyIns = (this.buyIns || []).filter((b) => b.playerId !== p.id);
    this.addLog(`${p.name} (dealer) bought in ${amount.toLocaleString()} more chips automatically.`);
    this.ev('buy-in', p.id, `${amount} (automatic, dealer), balance ${p.chips}`);
    return amount;
  }
  // A player who is the dealer must hold at least as many chips as the bets on the table.
  bankShort() {
    if (!this.banker || !this.players[this.banker]) return false;
    const onTable = this.seats.reduce((a, s) => a + (s && s.bet.main >= this.settings.minBet ? s.bet.main + sumValues(s.bet.sides) : 0), 0);
    return onTable > 0 && this.players[this.banker].chips < onTable;
  }
  canDeal() {
    // With no player as the dealer, the table only deals when the host has chosen frozen balances.
    if (!this.banker && !this.frozen) return false;
    if (this.bankShort()) return false;
    return this.phase === 'betting' && this.seats.some((s) => s && s.bet.main >= this.settings.minBet && this.players[s.playerId].connected !== false);
  }

  // ---- Dealing ----
  // How many cards the next step takes from the shoe. The host asks for exactly that many keys.
  dealCount() { return this.dealPlan().length; }
  deal() {
    if (this.phase === 'settled') this.startBetting();
    if (!this.banker && !this.frozen) throw new Error('Nobody is the dealer. Someone has to sit as the dealer, or the host can deal with frozen balances.');
    this.dealerAutoBuy();
    if (!this.canDeal()) throw new Error('Nobody has placed a bet.');
    this.rulesNote = null; // a rules change is shown from when it is made until the next deal
    const playing = this.seats.filter((x) => x && x.bet.main >= this.settings.minBet).length;
    // An untouched shoe is shuffled again when a player's code is not in it yet, so the first shoe
    // of a table also mixes in the codes of the people who are playing it.
    const f = this.fair;
    const fresh = f?.current && this.shoe.length === this.shoeSize && Object.keys(f.next.seeds).some((k) => f.current.clientSeeds[k] === undefined);
    if (this.needsShuffle(playing) || fresh || this.shuffleNext) this.newShoe();
    // The ledger shows each player as they stood before this hand until the hand is settled (no change mid hand).
    this.ledgerHold = Object.fromEntries(Object.values(this.players).map((p) => [p.id, { chips: p.chips, totalIn: p.totalIn ?? this.settings.startChips, houseNet: p.houseNet || 0 }]));
    this.round++;
    this.roundsSinceShuffle++;
    const active = [];
    this.seats.forEach((seat, i) => {
      if (!seat) return;
      const p = this.players[seat.playerId];
      const stake = seat.bet.main + sumValues(seat.bet.sides);
      // A bet under the minimum when betting closes stays on the spot but is not dealt.
      if (seat.bet.main >= this.settings.minBet && stake <= p.chips && p.connected !== false) {
        p.chips -= stake;
        p.lastBet = { main: seat.bet.main, sides: { ...seat.bet.sides } };
        if (p.lastRound !== this.round) { p.lastRound = this.round; p.lastBets = {}; }
        p.lastBets[i] = p.lastBet;
        // A big bet used up one of this player's chances. Reset their count when the window has rolled over.
        if (seat.bet.big && this.settings.bigBet) {
          const wi = this.bigWindow();
          if (p.bigWin !== wi) { p.bigWin = wi; p.bigUsed = 0; }
          p.bigUsed = (p.bigUsed || 0) + 1;
          this.addLog(`${p.name} made a big bet of ${seat.bet.main} (big bet ${p.bigUsed} of ${this.settings.bigBet.per} this window).`);
          this.ev('big bet', seat.playerId, String(seat.bet.main));
        }
        seat.hands = [newHand(seat.bet.main)];
        seat.staked = stake;
        seat.returned = 0;
        seat.sideResults = [];
        seat.insurance = 0;
        seat.insuranceDecided = false;
        active.push(i);
      } else {
        seat.hands = [];
        seat.ready = false;
      }
    });
    // A seat with no bet in this round is freed at once: the player keeps the chips, watches, and can sit again any time.
    const unseated = [];
    this.seats.forEach((seat, i) => {
      if (!seat || seat.hands.length) return;
      this.ev('unseated: no bet this round', seat.playerId, `seat ${i + 1}`);
      if (!unseated.includes(seat.playerId)) unseated.push(seat.playerId);
      this.seats[i] = null;
    });
    for (const id of unseated) { const p = this.players[id]; if (!p) continue; this.fixSeat(p); this.addLog(`${p.name} was unseated for not betting.`); }
    this.markUnseated(unseated);
    this.dealer = { cards: [], revealed: false };
    for (let pass = 0; pass < 2; pass++) {
      for (const i of active) this.seats[i].hands[0].cards.push(this.draw(`s${i}.0`));
      this.dealer.cards.push(this.draw(pass ? 'H' : 'D'));
    }
    const up = this.dealer.cards[0];
    // Side bets that only need the player's two cards and the dealer up card.
    for (const i of active) {
      const seat = this.seats[i];
      const pc = seat.hands[0].cards;
      const sides = seat.bet.sides;
      if (sides.perfectPairs) this.settleSide(seat, 'perfectPairs', evalPerfectPairs(pc));
      if (sides.twentyOnePlus3) this.settleSide(seat, 'twentyOnePlus3', eval21p3(pc, up));
      if (sides.royalMatch) this.settleSide(seat, 'royalMatch', evalRoyalMatch(pc));
      if (sides.luckyLucky) this.settleSide(seat, 'luckyLucky', evalLuckyLucky(pc, up));
      if (sides.hot3) this.settleSide(seat, 'hot3', evalHot3(pc, up));
    }
    this.addLog(`Round ${this.round} dealt.`);
    this.ev('deal', null, `round ${this.round}`);
    if (up.r === 'A') {
      this.phase = 'insurance';
      for (const i of active) {
        const seat = this.seats[i];
        const p = this.players[seat.playerId];
        // Players who are away skip insurance. One who is short can buy in more chips to pay for it.
        if (!p.connected) seat.insuranceDecided = true;
      }
      if (this.allInsuranceDecided()) this.afterInsurance();
    } else {
      this.afterInsurance();
    }
  }

  allInsuranceDecided() {
    return this.seats.every((s) => !s || !s.hands.length || s.insuranceDecided);
  }

  insurance(clientId, take, seatIdx) {
    if (this.phase !== 'insurance') throw new Error('Insurance is not offered now.');
    const { p, seat, idx } = this.mustSeat(clientId, seatIdx);
    if (!seat.hands.length || seat.insuranceDecided) return;
    this.ev(take ? 'insurance: yes' : 'insurance: no', clientId, `seat ${idx + 1}`);
    if (take) {
      const cost = Math.ceil(seat.bet.main / 2);
      if (cost > p.chips) throw new Error('Not enough chips.');
      p.chips -= cost;
      seat.staked += cost;
      seat.insurance = cost;
    }
    seat.insuranceDecided = true;
    if (this.allInsuranceDecided()) this.afterInsurance();
  }

  // Host can close insurance for slow players (counts as "no").
  forceInsurance() {
    if (this.phase !== 'insurance') return;
    this.seats.forEach((s) => { if (s && s.hands.length) s.insuranceDecided = true; });
    this.afterInsurance();
  }

  dealerHasBlackjack() {
    return this.dealer.cards.length === 2 && handTotal(this.dealer.cards).total === 21;
  }

  // The table moved to another player's browser. A round that was being played is never called off and no bet
  // goes back: every hand, bet and card on the table stays, and the round is played to its end from a new shoe.
  // dealerSeen is what everyone could see of the dealer's hand (the up card, or all cards once turned over).
  // The dealer's face down card was known to the old host alone, so it is dealt again from the new shoe. Once
  // the dealer has looked for blackjack and had none, the new face down card cannot make blackjack either.
  // Returns true when a round carries on.
  resumeAfterMove(dealerSeen) {
    const cards = (dealerSeen?.cards || []).filter((c) => c && c.r && c.s);
    const live = this.inRound() && cards.length > 0 && this.seats.some((x) => x && x.hands.length);
    this.newShoe();
    if (!live) { this.phase = 'settled'; this.startBetting(); return false; } // no hand had started: bets not yet dealt go back to their players
    const revealed = !!dealerSeen.revealed && cards.length >= 2;
    this.dealer = { cards: revealed ? cards.map((c) => ({ r: c.r, s: c.s })) : [{ r: cards[0].r, s: cards[0].s }], revealed };
    this.turn = null;
    if (!revealed) {
      const up = this.dealer.cards[0], looked = this.phase !== 'insurance' && (up.r === 'A' || cardValue(up) === 10);
      this.drawHole();
      for (let n = 0; looked && this.dealerHasBlackjack() && n < 500; n++) this.dealer.cards[1] = this.draw('H');
    }
    this.addLog('The table moved to a new host during a round. The round goes on with the same hands and bets; cards still to come are dealt from the new shoe.');
    this.ev('round carried on after a host move', null, `round ${this.round}`);
    if (this.phase === 'insurance') { if (this.allInsuranceDecided()) this.afterInsurance(); }
    else if (this.phase === 'playing') this.advance();
    return true;
  }

  drawHole() {
    if (this.dealer.cards.length === 1) this.dealer.cards.push(this.draw('H'));
  }
  afterInsurance() {
    const up = this.dealer.cards[0];
    // With an ace or a ten showing the dealer checks for blackjack, so the face down card is drawn now.
    if (up.r === 'A' || cardValue(up) === 10) this.drawHole();
    const dealerBJ = this.dealerHasBlackjack();
    // Insurance and Lucky Ladies depend on the hole card, so settle them now.
    for (const seat of this.seats) {
      if (!seat || !seat.hands.length) continue;
      if (seat.insurance) {
        const r = dealerBJ ? { win: true, label: 'Dealer had blackjack', mult: 2 } : { win: false, label: 'No dealer blackjack' };
        this.settleSide(seat, 'insurance', r, seat.insurance);
      }
      if (seat.bet.sides.luckyLadies) this.settleSide(seat, 'luckyLadies', evalLuckyLadies(seat.hands[0].cards, dealerBJ));
    }
    if ((up.r === 'A' || cardValue(up) === 10) && dealerBJ) {
      this.dealer.revealed = true;
      this.addLog('Dealer has blackjack.');
      this.seats.forEach((s) => s && s.hands.forEach((h) => (h.done = true)));
      this.finishRound();
      return;
    }
    // Player blackjacks are finished straight away.
    for (const seat of this.seats) {
      if (!seat) continue;
      for (const h of seat.hands) if (isBlackjack(h)) h.done = true;
    }
    this.phase = 'playing';
    this.turn = null;
    this.advance();
  }

  // ---- Player actions ----
  allowedActions(clientId) {
    if (this.phase !== 'playing' || !this.turn) return [];
    const p = this.players[clientId];
    if (!p || this.seats[this.turn.seat]?.playerId !== clientId) return [];
    const seat = this.seats[this.turn.seat];
    const h = seat.hands[this.turn.hand];
    const two = h.cards.length === 2;
    // A split ace got its one card. It is only still in play when that card is another ace: split again or stand.
    const st = this.settings, room = !st.maxSplits || seat.hands.length <= st.maxSplits; // one more split still allowed
    if (h.splitAces) return two && h.cards[0].r === 'A' && h.cards[1].r === 'A' && p.chips >= h.bet && st.resplitAces !== false && room ? ['stand', 'split'] : ['stand'];
    const acts = ['hit', 'stand'];
    const tot = handTotal(h.cards).total, dOk = st.doubleOn === '9-11' ? tot >= 9 && tot <= 11 : st.doubleOn === '10-11' ? tot >= 10 && tot <= 11 : true;
    if (two && p.chips >= h.bet && dOk && (!h.fromSplit || st.das !== false)) acts.push('double');
    if (two && cardValue(h.cards[0]) === cardValue(h.cards[1]) && p.chips >= h.bet && room && (h.cards[0].r !== 'A' || st.splitAces !== false)) acts.push('split');
    if (two && seat.hands.length === 1 && this.settings.allowSurrender) acts.push('surrender');
    return acts;
  }

  action(clientId, a, auto = false) {
    if (!this.allowedActions(clientId).includes(a)) throw new Error('You cannot do that now.');
    if (auto && (this.banker || !this.frozen)) throw new Error('Auto play only runs while the ledger is frozen.');
    const p = this.players[clientId];
    const seat = this.seats[this.turn.seat];
    const h = seat.hands[this.turn.hand];
    const before = h.cards.map((c) => c.r + c.s).join(' '), handNo = this.turn.hand + 1, splitHands = seat.hands;
    // After the move: the hand as it stands, so the record shows the card each hit or double drew.
    if (auto) seat.auto = true;
    const seatNo = this.turn.seat + 1;
    const note = () => this.ev(auto ? a + ' (auto play)' : a, clientId, `seat ${seatNo} hand ${handNo}: ${before} -> ${a === 'split' ? splitHands.slice(handNo - 1, handNo + 1).map((x) => x.cards.map((c) => c.r + c.s).join(' ')).join(' | ') : h.cards.map((c) => c.r + c.s).join(' ')}${a === 'double' ? `, bet ${h.bet}` : ''}`);
    try { return this.actionInner(clientId, a, p, seat, h); } finally { note(); }
  }
  actionInner(clientId, a, p, seat, h) {
    const at = `s${this.turn.seat}.${this.turn.hand}`, next = `s${this.turn.seat}.${this.turn.hand + 1}`;
    if (a === 'hit') {
      h.cards.push(this.draw(at));
      const t = handTotal(h.cards).total;
      if (t >= 21) h.done = true;
      // Five Card Charlie: a fifth card without busting wins at once, and the hand takes no more cards.
      if (this.charlieRound && h.cards.length === 5 && t <= 21) { h.charlie = true; h.done = true; }
    } else if (a === 'stand') {
      h.done = true;
    } else if (a === 'double') {
      p.chips -= h.bet;
      seat.staked += h.bet;
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(this.draw(at));
      h.done = true;
    } else if (a === 'split') {
      p.chips -= h.bet;
      seat.staked += h.bet;
      const aces = h.cards[0].r === 'A';
      const second = newHand(h.bet);
      second.cards.push(h.cards.pop());
      second.fromSplit = h.fromSplit = true;
      h.cards.push(this.draw(at));
      second.cards.push(this.draw(next));
      if (aces) {
        // Split aces get one card each. An ace that gets another ace may be split again, if the chips are there.
        h.splitAces = second.splitAces = true;
        const more = this.settings.resplitAces !== false && (!this.settings.maxSplits || seat.hands.length + 1 <= this.settings.maxSplits);
        for (const x of [h, second]) x.done = !(more && x.cards[1].r === 'A' && p.chips >= x.bet);
      } else {
        if (handTotal(h.cards).total === 21) h.done = true;
        if (handTotal(second.cards).total === 21) second.done = true;
      }
      seat.hands.splice(this.turn.hand + 1, 0, second);
    } else if (a === 'surrender') {
      h.surrendered = true;
      h.done = true;
    }
    this.advance();
  }

  // Host can stand a slow or disconnected player's current hand.
  skipTurn() {
    if (this.phase !== 'playing' || !this.turn) return;
    this.ev('stand (by the table: time ran out or the host skipped)', this.seats[this.turn.seat].playerId, `hand ${this.turn.hand + 1}`);
    this.seats[this.turn.seat].hands[this.turn.hand].done = true;
    this.advance();
  }

  // The table plays for a player who is away or let the clock run out: hit on 11 or less (no card can
  // bust that), stand on anything else. One step per call. Returns what it did.
  // How many cards awayMove would take (0 or 1), so the host asks the guests for exactly that many keys.
  awayMoveCount() {
    if (this.phase !== 'playing' || !this.turn) return 0;
    const seat = this.seats[this.turn.seat], h = seat?.hands[this.turn.hand];
    return h && handTotal(h.cards).total <= 11 && this.allowedActions(seat.playerId).includes('hit') ? 1 : 0;
  }
  awayMove() {
    if (this.phase !== 'playing' || !this.turn) return null;
    const seat = this.seats[this.turn.seat], h = seat.hands[this.turn.hand];
    if (handTotal(h.cards).total <= 11 && this.allowedActions(seat.playerId).includes('hit')) {
      this.ev('hit (by the table: 11 or less, player is away or out of time)', seat.playerId, `hand ${this.turn.hand + 1}`);
      this.action(seat.playerId, 'hit');
      return 'hit';
    }
    this.skipTurn();
    return 'stand';
  }

  advance() {
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (!seat) continue;
      for (let j = 0; j < seat.hands.length; j++) {
        if (!seat.hands[j].done) {
          this.turn = { seat: i, hand: j };
          // A player who is gone gets an automatic stand. One who only just dropped out still has
          // a little time to come back (see markGone), so the turn waits for them.
          const p = this.players[seat.playerId];
          // With 11 or less no card can bust the hand, so the table hits for them first (see awayMove).
          if (!p.connected && (p.gone || p.kicked)) {
            if (handTotal(seat.hands[j].cards).total <= 11) return;
            seat.hands[j].done = true; this.ev('stand (by the table: player is away)', seat.playerId, `hand ${j + 1}`); continue;
          }
          return;
        }
      }
    }
    this.turn = null;
    this.phase = 'dealer';
    this.drawHole();
    this.dealer.revealed = true;
  }

  // The dealer draws one card at a time so players can watch. Returns true while more cards are needed.
  dealerNeedsCard() {
    if (this.phase !== 'dealer') return false;
    const anyLive = this.seats.some((s) => s && s.hands.some((h) => !h.surrendered && !h.charlie && handTotal(h.cards).total <= 21 && !isBlackjack(h)));
    const anyBustBet = this.seats.some((s) => s && s.hands.length && s.bet.sides.bustIt);
    if (!anyLive && !anyBustBet) return false;
    const { total, soft } = handTotal(this.dealer.cards);
    if (total < 17) return true;
    if (total === 17 && soft && this.settings.dealerHitsSoft17) return true;
    return false;
  }

  dealerStep() {
    if (this.dealerNeedsCard()) {
      this.dealer.cards.push(this.draw('D'));
      return true;
    }
    if (this.phase === 'dealer') this.finishRound();
    return false;
  }

  finishRound() {
    this.drawHole();
    this.dealer.revealed = true;
    const d = handTotal(this.dealer.cards).total;
    const dealerBJ = this.dealerHasBlackjack();
    const dealerBust = d > 21;
    for (const seat of this.seats) {
      if (!seat || !seat.hands.length) continue;
      const p = this.players[seat.playerId];
      if (seat.bet.sides.bustIt) this.settleSide(seat, 'bustIt', evalBustIt(this.dealer.cards));
      for (const h of seat.hands) {
        const t = handTotal(h.cards).total;
        let pay = 0;
        if (h.surrendered) { h.result = 'Surrender'; pay = h.bet / 2; }
        else if (t > 21) { h.result = 'Bust'; }
        else if (isBlackjack(h) && !dealerBJ) { h.result = 'Blackjack'; pay = h.bet + h.bet * this.settings.blackjackPays; }
        else if (h.charlie && !dealerBJ) { h.result = '5 Card Charlie'; pay = h.bet * 2; }
        else if (dealerBJ) { h.result = isBlackjack(h) ? 'Push' : 'Lose'; pay = isBlackjack(h) ? h.bet : 0; }
        else if (dealerBust || t > d) { h.result = 'Win'; pay = h.bet * 2; }
        else if (t === d) { h.result = 'Push'; pay = h.bet; }
        else { h.result = 'Lose'; }
        pay = Math.floor(pay);
        h.paid = pay;
        p.chips += pay;
        seat.returned += pay;
      }
      seat.net = seat.returned - seat.staked;
      // Win streak, for the fire on a hot seat. Each seat keeps its own, so a player with several seats can have
      // fire on every seat that is winning. The player's own count is the best of their seats (for the ledger snapshot).
      if (seat.net > 0) seat.streak = (seat.streak || 0) + 1; else if (seat.net < 0) seat.streak = 0;
      p.streak = Math.max(0, ...this.seats.filter((x) => x && x.playerId === p.id).map((x) => x.streak || 0));
      seat.ready = false;
    }
    // A player sitting as the dealer pays and collects everything.
    if (this.banker && this.players[this.banker]) {
      const tableNet = this.seats.reduce((sum, seat) => sum + (seat && seat.hands.length ? seat.net : 0), 0);
      this.players[this.banker].chips -= tableNet;
      this.bankerNet = -tableNet;
      this.dealerAutoBuy();
    } else {
      // With the automatic house dealer, wins and losses are practice money: they are not counted between players.
      // The chips still move against the house, but that part is kept out of the ledger.
      for (const seat of this.seats) {
        if (!seat || !seat.hands.length || !seat.net) continue;
        const p = this.players[seat.playerId];
        p.houseNet = (p.houseNet || 0) + seat.net;
      }
      this.bankerNet = null;
    }
    this.practiceRound = !this.banker;
    this.phase = 'settled';
    this.ledgerHold = null;
    this.rabbit = true; // the next card can be shown until the first bet of the next round
    if (this.bankerLeaving) {
      // The dealer asked to stop after this round. A dealer who owes chips stays until they are covered.
      this.bankerLeaving = false;
      const b = this.players[this.banker];
      if (b && b.chips < 0) this.addLog(`${b.name} owes chips and stays the dealer until they are covered.`);
      else if (b && !this.pendingBanker) { this.banker = null; this.addLog(`${b.name} left the dealer seat.`); }
    }
    this.checkLossCap();
    if (this.pendingBanker) this.applyDealer(this.pendingBanker);
    if (this.pendingSettings) this.applySettings(this.pendingSettings);
    this.turn = null;
    this.addLog(`Dealer ${dealerBJ ? 'blackjack' : dealerBust ? 'busts with ' + d : 'has ' + d}.`);
    this.recordHand();
  }

  // Hand history: one entry per round, with the number of the shuffle its cards came from, so the
  // list can show where each shoe starts. `midShuffle` marks a round in which the shoe ran out.
  recordHand() {
    const cs = (cards) => cards.map((c) => c.r + c.s).join(' ');
    const seats = [];
    this.seats.forEach((s, i) => {
      if (!s || !s.hands.length) return;
      seats.push({
        seat: i + 1, name: this.players[s.playerId]?.name || 'Player', ...(s.auto ? { auto: true } : {}), net: s.net ?? (s.returned - s.staked),
        bet: { main: s.bet.main, sides: { ...s.bet.sides }, ...(s.insurance ? { insurance: s.insurance } : {}) }, chipsAfter: this.players[s.playerId]?.chips,
        hands: s.hands.map((h) => ({ cards: cs(h.cards), total: handTotal(h.cards).total, bet: h.bet, result: h.result, net: (h.paid || 0) - h.bet, doubled: !!h.doubled })),
        sides: s.sideResults.map((r) => ({ name: r.name, net: r.win ? r.pay - r.stake : r.push ? 0 : -r.stake })),
      });
    });
    if (!seats.length) return;
    // The table log gets one line per seat: every hand, every side bet, and the seat's net.
    const sg = (n) => (n > 0 ? '+' : n < 0 ? '-' : '') + Math.abs(n);
    for (const x of seats) {
      const bits = x.hands.map((h, j) => `${x.hands.length > 1 ? `hand ${j + 1} ` : ''}${h.result || 'played'}${h.net ? ' ' + sg(h.net) : ''}`).concat(x.sides.map((r) => `${r.name} ${r.net ? sg(r.net) : 'back'}`));
      this.addLog(`Round ${this.round}, ${x.name} (seat ${x.seat}): ${bits.join(', ')}. Net ${x.net ? sg(x.net) : 'even'}.`);
    }
    this.hist = this.hist || [];
    this.hist.push({
      round: this.round, shoe: this.fair?.n || 0, midShuffle: !!this.shuffledMidRound, time: Date.now(), events: (this.evts || []).splice(0),
      dealerName: this.banker && this.players[this.banker] ? this.players[this.banker].name : 'House',
      dealer: cs(this.dealer.cards), dealerTotal: handTotal(this.dealer.cards).total, counted: !!this.banker, frozen: !this.banker && !!this.frozen, seats,
    });
    this.shuffledMidRound = false;
    if (this.hist.length > 300) this.hist.splice(0, this.hist.length - 300);
  }

  // Stats per player from the recorded hands (the last 300 rounds): hands played, hands won, lost and pushed (each
  // split hand counts), the net of every round (side bets and insurance in), and the running total over time.
  // Real rounds (a player deals) count in the ledger; practice rounds against the house are counted apart.
  // The dealer's rounds count too, as the opposite of the table's net. Cached until a new round is recorded.
  playerStats() {
    const hist = this.hist || [];
    const key = hist.length + ':' + (hist[hist.length - 1]?.round || 0);
    if (this._pstatsKey === key) return this._pstats;
    const P = {}, rounds = [];
    const get = (name) => (P[name] ||= { name, hands: 0, wins: 0, losses: 0, pushes: 0, rounds: 0, net: 0, realNet: 0, practiceNet: 0, best: 0, worst: 0, dealt: 0 });
    for (const h of hist) {
      const step = {};
      let tableNet = 0;
      for (const x of h.seats || []) {
        const p = get(x.name);
        for (const hd of x.hands || []) { p.hands++; if (hd.net > 0) p.wins++; else if (hd.net < 0) p.losses++; else p.pushes++; }
        step[x.name] = (step[x.name] || 0) + (Number(x.net) || 0);
        tableNet += Number(x.net) || 0;
      }
      if (h.counted && h.dealerName) { const d = get(h.dealerName); d.dealt++; step[h.dealerName] = (step[h.dealerName] || 0) - tableNet; }
      for (const [name, v] of Object.entries(step)) {
        const p = get(name); p.rounds++; p.net += v; if (h.counted) p.realNet += v; else p.practiceNet += v;
        p.best = Math.max(p.best, v); p.worst = Math.min(p.worst, v);
      }
      rounds.push({ round: h.round, counted: !!h.counted, step });
    }
    // The running total of each player, at most 80 points (evenly picked) so the table update stays small.
    const names = Object.keys(P), run = Object.fromEntries(names.map((n) => [n, 0]));
    const pts = rounds.map((r) => { for (const n of names) run[n] += r.step[n] || 0; return { round: r.round, v: names.map((n) => Math.round(run[n] * 100) / 100) }; });
    const every = Math.max(1, Math.ceil(pts.length / 80));
    const series = pts.filter((_, i) => i % every === 0 || i === pts.length - 1);
    for (const p of Object.values(P)) for (const k of ['net', 'realNet', 'practiceNet', 'best', 'worst']) p[k] = Math.round(p[k] * 100) / 100;
    this._pstatsKey = key;
    this._pstats = { players: Object.values(P), names, series, first: hist[0]?.round || 0, last: hist[hist.length - 1]?.round || 0 };
    return this._pstats;
  }

  settleSide(seat, key, r, amount) {
    const stake = amount ?? seat.bet.sides[key];
    const p = this.players[seat.playerId];
    const pay = r.win ? Math.floor(stake + stake * r.mult) : 0;
    p.chips += pay;
    seat.returned += pay;
    seat.sideResults.push({ key, name: key === 'insurance' ? 'Insurance' : SIDE_BETS[key].name, stake, win: r.win, label: r.label, pay });
  }

  // ---- What each player is allowed to see ----
  publicState(forClientId) {
    const hide = !this.dealer.revealed && this.dealer.cards.length >= 1 && this.dealer.cards.length <= 2;
    return {
      settings: this.settings,
      phase: this.phase,
      round: this.round,
      charlieRound: !!this.charlieRound,
      rulesNote: this.rulesNote ? Object.keys(this.rulesNote).filter((k) => RULE_TEXT[k]).map((k) => RULE_TEXT[k](this.rulesNote[k])) : null,
      unseated: this.unseated || null,
      turn: this.turn,
      dealer: {
        cards: hide ? [this.dealer.cards[0], { hidden: true }] : this.dealer.cards,
        total: hide ? handTotal([this.dealer.cards[0]]).total : handTotal(this.dealer.cards).total,
        soft: hide ? false : handTotal(this.dealer.cards).soft,
      },
      vote: this.vote ? {
        id: this.vote.id,
        kind: this.vote.kind || 'dealer',
        summary: this.vote.summary || null,
        candidate: this.vote.candidate,
        name: this.players[this.vote.candidate].name,
        voters: this.vote.voters.length,
        need: this.vote.need ?? this.vote.voters.length,
        yes: Object.values(this.vote.votes).filter(Boolean).length,
        canVote: this.vote.voters.includes(forClientId) && !(forClientId in this.vote.votes),
      } : null,
      frozen: !this.banker && !!this.frozen,
      houseDealer: !this.banker && this.frozen ? this.houseDealer || null : null,
      noDealer: !this.banker && !this.frozen,
      bankShort: this.bankShort(),
      canPeek: !!this.rabbit && !this.inRound(),
      histN: (this.hist || []).length,
      pstats: this.playerStats(),
      banker: this.banker && this.players[this.banker] ? { id: this.banker, name: this.players[this.banker].name, chips: this.players[this.banker].chips, connected: this.players[this.banker].connected, net: this.phase === 'settled' ? this.bankerNet : null } : null,
      seats: this.seats.map((s) => {
        if (!s) return null;
        const p = this.players[s.playerId];
        return {
          playerId: s.playerId,
          name: p.name,
          chips: p.chips,
          connected: p.connected,
          bet: s.bet,
          ready: s.ready,
          out: !!s.out,
          leaving: !!s.leaving,
          betSeq: s.betSeq || 0,
          streak: s.streak || 0,
          insurance: s.insurance,
          staked: s.hands.length ? s.staked || 0 : 0,
          insuranceDecided: s.insuranceDecided,
          sideResults: s.sideResults,
          net: s.net,
          hands: s.hands.map((h) => ({ ...h, ...handTotal(h.cards), blackjack: isBlackjack(h) })),
        };
      }),
      players: Object.values(this.players).filter((p) => !p.kicked).map((p) => ({ id: p.id, name: p.name, look: p.look, chips: p.chips, seat: p.seat, seats: this.seatsOf(p.id), connected: p.connected, leaving: !!p.leaving, boughtIn: p.boughtIn || 0, totalIn: p.totalIn ?? this.settings.startChips, left: !!p.kicked, bigLeft: this.bigLeft(p.id) })),
      hostId: this.hostId || null,
      bankerLeaving: !!this.bankerLeaving,
      lossCap: this.banker && this.lossCap?.id === this.banker ? { on: !!this.lossCap.on, amount: this.capAmount(), auto: this.lossCap.amount == null, lost: this.dealerLoss() } : null,
      big: this.settings.bigBet ? { limit: this.settings.bigBet.limit, per: this.settings.bigBet.per, hands: this.settings.bigBet.hands, handsLeft: this.bigHandsLeft(), yourLeft: this.bigLeft(forClientId) } : null,
      ledger: Object.values(this.players).map((p) => { const h = this.inRound() && this.ledgerHold?.[p.id]; return { id: p.id, name: p.name, totalIn: h ? h.totalIn : p.totalIn ?? this.settings.startChips, chips: h ? h.chips : p.chips, houseNet: h ? h.houseNet : p.houseNet || 0, connected: p.connected, kicked: !!p.kicked }; }),
      buyIns: (this.buyIns || []).filter((b) => b.playerId === forClientId).map((b) => ({ id: b.id, amount: b.amount })),
      fair: this.fair && {
        nextCommit: this.fair.next.commit,
        cards: this.fair.cards || 0, // how many cards have been opened with the guests' keys so far
        dealt: (this.fair.dealt || []).slice(-20), // card number and where it went (announced place in want if different)
        current: this.fair.current && { n: this.fair.current.n, commit: this.fair.current.commit, clientSeeds: this.fair.current.clientSeeds, decks: this.fair.current.decks, dealt: (this.fair.current.draws || []).length },
        last: this.fair.last,
      },
      shoe: { left: this.shoe.length, size: this.shoeSize, roundsSinceShuffle: this.roundsSinceShuffle },
      log: this.log.slice(-12),
      you: forClientId,
      rebet: this.rebetFor(forClientId),
      rebets: Object.fromEntries(this.seatsOf(forClientId).map((i) => [i, this.rebetFor(forClientId, i)])),
      actions: this.allowedActions(forClientId),
    };
  }

  // Save and restore so the host can refresh the page without losing the table.
  toJSON() {
    const { settings, seats, players, phase, dealer, turn, round, roundsSinceShuffle, charlieRound, log, shoe, shoeSize, banker, bankerNet, pendingBanker, buyIns, hostId, pendingSettings, frozen, fair, hist, evts, created, frozenSnap, shuffleNext, bankerLeaving, ledgerHold, lossCap } = this;
    return { settings, seats, players, phase, dealer, turn, round, roundsSinceShuffle, charlieRound, log, shoe: packShoe(shoe), shoeSize, banker, bankerNet, pendingBanker, buyIns, hostId, pendingSettings, frozen, fair, hist, evts, created, frozenSnap, shuffleNext, bankerLeaving, ledgerHold, lossCap };
  }
  static fromJSON(obj) {
    const t = new Table(obj.settings);
    Object.assign(t, obj);
    delete t.halted; // the old "network security breached" pause is gone: a table saved paused plays on
    if (t.banker && !t.lossCap) t.startLossCap(); // a dealer from before the stop at loss gets the default
    t.shoe = unpackShoe(obj.shoe) || [];
    if (!obj.fair) t.fair.current = null; // a table saved before fair shuffles: its shoe has no seed to show
    // Tables saved before the seat count was a setting keep the seats they had.
    if (!Array.isArray(t.seats) || !t.seats.length) t.seats = Array(seatCount(obj.settings?.seats)).fill(null);
    t.settings = charlieFix({ ...DEFAULT_SETTINGS, ...obj.settings, seats: t.seats.length }, obj.settings || {});
    // Side bets and settings that were taken out of the game: a table saved before keeps none of them.
    delete t.settings.countTraining;
    if (Array.isArray(t.settings.sideBets)) t.settings.sideBets = t.settings.sideBets.filter((k) => SIDE_BETS[k]);
    if (t.phase === 'betting' || t.phase === 'settled') for (const seat of t.seats) if (seat?.bet?.sides) { for (const k of Object.keys(seat.bet.sides)) if (!SIDE_BETS[k]) delete seat.bet.sides[k]; delete seat.bet.target; }
    Object.values(t.players).forEach((p) => (p.connected = false));
    // Nobody is here straight after a reload. They get the usual short while to come back.
    Object.values(t.players).forEach((p) => (p.gone = false));
    return t;
  }
}

// 5 Card Charlie: a whole number of rounds from 0 (off) to 1000. Tables from before had an on/off switch (charlie).
function charlieFix(s, given) {
  if (given.charlieEvery === undefined && given.charlie !== undefined) s.charlieEvery = given.charlie === false ? 0 : DEFAULT_SETTINGS.charlieEvery;
  delete s.charlie;
  try { Object.assign(s, cleanRules(Object.fromEntries(RULE_KEYS.filter((k) => k !== 'charlieEvery').map((k) => [k, s[k]])), {})); } catch { for (const k of RULE_KEYS) if (k !== 'charlieEvery') s[k] = DEFAULT_SETTINGS[k]; }
  const n = Math.round(Number(s.charlieEvery));
  s.charlieEvery = Number.isFinite(n) ? Math.max(0, Math.min(1000, n)) : DEFAULT_SETTINGS.charlieEvery;
  return s;
}

// A place a card goes, in words.
export function destName(d) {
  const m = /^s(\d+)\.(\d+)$/.exec(String(d || ''));
  if (m) return `seat ${+m[1] + 1} hand ${+m[2] + 1}`;
  return { D: 'the dealer', H: "the dealer's hole card", burn: 'the burn pile', peek: 'a look at the next card' }[d] || 'nowhere announced';
}

function emptySeat(playerId) {
  return { playerId, bet: { main: 0, sides: {} }, ready: false, hands: [], sideResults: [], staked: 0, returned: 0, net: null, insurance: 0, insuranceDecided: false };
}
function newHand(bet) {
  return { cards: [], bet, done: false, doubled: false, fromSplit: false, splitAces: false, surrendered: false, result: null, paid: 0 };
}
function sumValues(o) {
  return Object.values(o || {}).reduce((a, b) => a + b, 0);
}
function seatCount(v, fallback = DEFAULT_SETTINGS.seats) {
  const n = Math.round(Number(v));
  return n >= 1 && Number.isFinite(n) ? n : fallback;
}
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, isNaN(v) ? lo : v));
}

// The step of the turn a move was pressed on: round, seat, hand and how many cards that hand had. A second Hit
// for the same step (a double tap, or the same message arriving twice) is dropped before any card is asked for;
// a Hit pressed after the first card has shown is a new step and goes through at once.
export const stepOf = (x) => (x?.turn ? [x.round, x.turn.seat, x.turn.hand, x.seats[x.turn.seat]?.hands[x.turn.hand]?.cards.length ?? -1].join('-') : '');
