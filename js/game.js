// Blackjack table logic. Runs only in the host's browser (the "dealer").
// Everything here is plain JavaScript with no browser APIs, so it can be tested in Node.

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export const DEFAULT_SETTINGS = {
  seats: 7,              // player seats at the table (any whole number from 1 up)
  decks: 6,              // 1, 2, 6, 8, or 'csm' (randomized: full reshuffle before every round)
  shuffleMode: 'penetration', // 'penetration' or 'rounds'
  penetration: 75,       // reshuffle once this % of the shoe has been dealt
  shuffleEvery: 5,       // or reshuffle every N rounds
  startChips: 1000,
  minBet: 10,
  maxBet: 1000,
  maxSideBet: 100,
  dealerHitsSoft17: false,
  countTraining: false,  // the host can switch the card count display on for the whole table
  blackjackPays: 1.5,    // 3:2
  allowSurrender: true,
  autoDeal: true,        // deal as soon as every seated player is ready
  betTimer: 20,          // seconds for betting before the dealer deals on its own (0 = off)
  turnTimer: 30,
  peekCost: 10,          // price to see the next card in the shoe
  sideBets: ['hot3', 'bustIt', 'twentyOnePlus3', 'friendBust'], // side bets offered at this table         // seconds per decision before the dealer stands for you (0 = off)
};

// ---------- Side bets ----------
// Payouts are "to one": a 25 means a $10 bet wins $250 and you also get your $10 back.
export const SIDE_BETS = {
  hot3: {
    name: 'Hot 3',
    short: 'Hot 3',
    icon: '🔥',
    about: 'Your first two cards plus the dealer up card total 19, 20 or 21.',
    table: [['Suited 7-7-7', 100], ['Suited 21', 20], ['Any other 21', 4], ['20', 2], ['19', 1]],
  },
  friendBust: {
    name: 'PvP: friend busts',
    short: 'PvP',
    icon: '⚔️',
    pvp: true, // a bet about another player, not about your own cards
    about: 'A bet on a friend, not on your own cards. Pick someone at the table. It pays 5 to 1 if their first hand busts. You cannot pick yourself. The most that counts is one fifth of what your friend bet on their own hand, and anything over that comes back to you. If they are not dealt in, you get your bet back.',
    table: [["Your friend's first hand busts", 5]],
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
  over13: {
    name: 'Over 13',
    short: '>13',
    icon: '⬆️',
    about: 'Your first two cards total more than 13 (aces count as 1).',
    table: [['Total 14 or more', 1]],
  },
  under13: {
    name: 'Under 13',
    short: '<13',
    icon: '⬇️',
    about: 'Your first two cards total less than 13 (aces count as 1).',
    table: [['Total 12 or less', 1]],
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

// ---------- Card helpers ----------
export const cardValue = (c) => (c.r === 'A' ? 1 : ['J', 'Q', 'K'].includes(c.r) ? 10 : Number(c.r));
export const rankIndex = (c) => RANKS.indexOf(c.r) + 1; // A=1 .. K=13
export const isRed = (c) => c.s === '♥' || c.s === '♦';

// Hi-Lo card counting value: 2-6 are +1, 7-9 are 0, tens and aces are -1.
export const hiLo = (c) => { const v = cardValue(c); return c.r === 'A' || v === 10 ? -1 : v <= 6 ? 1 : 0; };

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

export const PVP_BUST_PAYS = 5;

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

export function evalOverUnder(p, over) {
  const t = cardValue(p[0]) + cardValue(p[1]);
  if (t === 13) return { win: false, label: 'Exactly 13' };
  const win = over ? t > 13 : t < 13;
  return win ? { win: true, label: `Total ${t}`, mult: 1 } : { win: false, label: `Total ${t}` };
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
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
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
    this.runCount = 0;
  }
  setClientSeed(clientId, seed) {
    if (!this.players[clientId] || !this.fair) return;
    this.fair.next.seeds[clientId] = String(seed).replace(/[^0-9a-zA-Z]/g, '').slice(0, 64);
  }
  newShoe() {
    this.fairShuffle();
    this.roundsSinceShuffle = 0;
    this.addLog('The shoe was shuffled.');
  }
  needsShuffle(players = this.seats.length) {
    const s = this.settings;
    if (s.decks === 'csm') return true;
    // Never start a round with too few cards for a normal round.
    if (this.shoe.length < 6 + 5 * players) return true;
    if (s.shuffleMode === 'rounds') return this.roundsSinceShuffle >= Number(s.shuffleEvery);
    const dealt = 1 - this.shoe.length / this.shoeSize;
    return dealt * 100 >= Number(s.penetration);
  }
  draw() {
    if (this.shoe.length === 0) {
      this.fairShuffle();
      this.addLog('Shoe ran out mid round and was reshuffled.');
    }
    const c = this.pendingCard || this.pick();
    this.pendingCard = null;
    this.runCount = (this.runCount || 0) + hiLo(c);
    return c;
  }
  // Take one card out of the shoe. The shoe order is set once, at the shuffle, by two things: the
  // host's hidden seed and a secret that stays in one guest's browser. Card number k needs key
  // number k from that guest (this.keys), and the keys are fixed by the guest's secret, so the
  // order never changes after the shuffle. The host cannot read a card before its key arrives,
  // and the guest cannot read it without the host's seed.
  pick() {
    const cur = this.fair?.current;
    if (!cur) return this.shoe.pop();
    let nonce = '';
    if (this.keys?.length) { nonce = this.keys.shift(); this.fair.cards = (this.fair.cards || 0) + 1; }
    cur.draws = cur.draws || [];
    cur.draws.push(nonce);
    return this.shoe.splice(pickIndex(cur.serverSeed, nonce, cur.draws.length, this.shoe.length), 1)[0];
  }

  updateSettings(patch) {
    if (this.phase !== 'betting' && this.phase !== 'settled') throw new Error('Change settings between rounds.');
    const old = this.settings;
    const s = { ...old, ...patch };
    s.penetration = clamp(Number(s.penetration), 20, 95);
    s.shuffleEvery = clamp(Math.round(Number(s.shuffleEvery)), 1, 50);
    s.minBet = Math.max(1, Math.round(Number(s.minBet)));
    s.maxBet = Math.max(s.minBet, Math.round(Number(s.maxBet)));
    s.maxSideBet = Math.max(0, Math.round(Number(s.maxSideBet)));
    s.startChips = Math.max(1, Math.round(Number(s.startChips)));
    s.betTimer = Number(s.betTimer) > 0 ? clamp(Math.round(Number(s.betTimer)), 5, 300) : 0;
    s.turnTimer = Number(s.turnTimer) > 0 ? clamp(Math.round(Number(s.turnTimer)), 5, 300) : 0;
    if (![1, 2, 6, 8, 'csm'].includes(s.decks)) s.decks = Number(s.decks) || 'csm';
    s.seats = seatCount(s.seats, this.seats.length);
    this.checkSeatCount(s.seats);
    this.settings = s;
    // Growing adds empty seats at the end. Shrinking only ever removes empty ones (checked above).
    while (this.seats.length < s.seats) this.seats.push(null);
    this.seats.length = s.seats;
    if (old.decks !== s.decks) this.newShoe();
  }

  // The table can only lose seats that nobody is sitting in.
  checkSeatCount(n) {
    if (n === undefined || n === null) return;
    n = seatCount(n, this.seats.length);
    const taken = [];
    for (let i = n; i < this.seats.length; i++) if (this.seats[i]) taken.push(i + 1);
    if (!taken.length) return;
    const list = taken.length === 1 ? `${taken[0]}` : `${taken.slice(0, -1).join(', ')} and ${taken[taken.length - 1]}`;
    throw new Error(`${taken.length === 1 ? 'Seat' : 'Seats'} ${list} ${taken.length === 1 ? 'is' : 'are'} still taken. Ask them to move first.`);
  }

  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 40) this.log.shift();
  }

  // ---- Players ----
  join(clientId, name, buyIn, look) {
    name = String(name || 'Player').trim().slice(0, 16) || 'Player';
    // How the player's character looks in the 3D room: a skin tone and a hair colour.
    const lk = { skin: clamp(Math.round(Number(look?.skin ?? 2)) || 0, 0, 5), hair: clamp(Math.round(Number(look?.hair ?? 0)) || 0, 0, 4), flag: /^[\u{1F1E6}-\u{1F1FF}]{2}$/u.test(String(look?.flag || '')) ? String(look.flag) : '' };
    let p = this.players[clientId];
    if (p) {
      p.connected = true;
      p.name = name;
      if (look) p.look = lk;
      return p;
    }
    // Each player says how much they buy in for when they arrive. Any positive amount is fine.
    const start = Math.round(Number(buyIn)) > 0 ? Math.min(Number.MAX_SAFE_INTEGER, Math.round(Number(buyIn))) : this.settings.startChips;
    p = { id: clientId, name, chips: start, seat: null, connected: true, lastBet: null, totalIn: start, look: lk };
    this.players[clientId] = p;
    this.addLog(`${name} joined.`);
    return p;
  }

  sit(clientId, seatIdx) {
    const p = this.mustPlayer(clientId);
    if (seatIdx < 0 || seatIdx >= this.seats.length || !Number.isInteger(seatIdx)) throw new Error('No such seat.');
    if (this.banker === clientId) throw new Error('Leave the dealer seat first.');
    if (this.seats[seatIdx]) throw new Error('That seat is taken.');
    if (p.seat !== null) {
      if (this.seats[p.seat]?.hands?.length && this.inRound()) throw new Error('Finish this round first.');
      this.seats[p.seat] = null;
    }
    this.seats[seatIdx] = emptySeat(clientId);
    p.seat = seatIdx;
  }

  // A player can sit as the dealer. The dealer still follows the fixed rules,
  // but their chips act as the bank: they collect what players lose and pay what players win.
  sitDealer(clientId) {
    const p = this.mustPlayer(clientId);
    if (this.inRound()) throw new Error('Wait for the round to end.');
    if (this.banker && this.banker !== clientId) throw new Error('Someone is already the dealer.');
    if (p.seat !== null) {
      this.seats[p.seat] = null;
      p.seat = null;
    }
    this.banker = clientId;
    this.addLog(`${p.name} is now the dealer.`);
  }

  // Moving to the dealer seat needs everyone else's approval. A vote that
  // runs out counts as "no".
  requestDealer(clientId) {
    const p = this.mustPlayer(clientId);
    if (this.banker === clientId) throw new Error('You are already the dealer.');
    if (this.vote) throw new Error('A vote is already running.');
    const voters = Object.values(this.players)
      .filter((x) => x.id !== clientId && x.connected && !x.kicked)
      .map((x) => x.id);
    this.voteSeq = (this.voteSeq || 0) + 1;
    if (!voters.length) { this.applyDealer(clientId); return null; }
    this.vote = { id: this.voteSeq, candidate: clientId, voters, votes: {} };
    this.addLog(`${p.name} asked to be the dealer. Everyone else votes.`);
    return this.vote.id;
  }

  // Settings changes from the host also need everyone's yes.
  proposeSettings(hostId, patch, summary) {
    if (this.vote) throw new Error('A vote is already running.');
    this.checkSeatCount(patch?.seats);
    const voters = Object.values(this.players).filter((x) => x.id !== hostId && x.connected && !x.kicked).map((x) => x.id);
    this.voteSeq = (this.voteSeq || 0) + 1;
    if (!voters.length) { this.applySettings(patch); return null; }
    this.vote = { id: this.voteSeq, kind: 'settings', candidate: hostId, patch, summary, voters, votes: {} };
    this.addLog('The host proposed new settings. Everyone votes.');
    return this.vote.id;
  }

  applySettings(patch) {
    if (this.inRound()) { this.pendingSettings = patch; return; }
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
    this.addLog(this.vote.kind === 'settings' ? 'The settings vote ran out, so the answer is no.' : `The vote for ${this.players[this.vote.candidate].name} ran out, so the answer is no.`);
    this.vote = null;
  }

  // Move a player to the dealer seat now, or after the current round.
  applyDealer(clientId) {
    if (this.inRound()) { this.pendingBanker = clientId; return; }
    const p = this.players[clientId];
    if (!p) return;
    if (p.seat !== null) { this.seats[p.seat] = null; p.seat = null; }
    this.banker = clientId;
    this.pendingBanker = null;
    this.addLog(`${p.name} is now the dealer.`);
  }

  leaveDealer(clientId) {
    if (this.banker !== clientId) return;
    if (this.inRound()) throw new Error('Wait for the round to end.');
    if (this.players[clientId].chips < 0) throw new Error('The dealer owes chips. Buy in to cover them before leaving the dealer seat.');
    this.banker = null;
    this.addLog(`${this.players[clientId].name} left the dealer seat.`);
  }

  standUp(clientId) {
    const p = this.mustPlayer(clientId);
    if (p.seat === null) return;
    const seat = this.seats[p.seat];
    if (this.inRound() && seat.hands.length) throw new Error('Finish this round first.');
    this.seats[p.seat] = null;
    p.seat = null;
  }

  disconnect(clientId) {
    const p = this.players[clientId];
    if (!p) return;
    p.connected = false;
  }

  kick(clientId) {
    const p = this.players[clientId];
    if (!p) return;
    if (p.seat !== null) {
      const seat = this.seats[p.seat];
      if (this.inRound() && seat.hands.length) {
        // Stand all of their hands so the round can finish.
        seat.hands.forEach((h) => { if (!h.done) h.done = true; });
        seat.insuranceDecided = true;
      } else {
        this.seats[p.seat] = null;
        p.seat = null;
      }
    }
    if (this.banker === clientId && !this.inRound()) this.banker = null;
    p.kicked = true;
    p.connected = false;
  }

  // Buying in more play chips. The host approves each request.
  requestBuyIn(clientId, amount) {
    const p = this.mustPlayer(clientId);
    amount = Math.round(Number(amount) || 0);
    if (!(amount >= 1) || amount > Number.MAX_SAFE_INTEGER) throw new Error('Pick an amount of at least 1.');
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
    } else {
      this.addLog(`The host said no to ${p.name}'s buy-in.`);
    }
  }

  giveChips(clientId, amount) {
    const p = this.mustPlayer(clientId);
    const before = p.chips;
    p.chips = Math.max(0, p.chips + Math.round(Number(amount) || 0));
    // Chips the host gives count as a buy-in; chips taken count as cashed out.
    p.totalIn = (p.totalIn ?? this.settings.startChips) + (p.chips - before);
  }

  mustPlayer(clientId) {
    const p = this.players[clientId];
    if (!p) throw new Error('Unknown player.');
    return p;
  }

  mustSeat(clientId) {
    const p = this.mustPlayer(clientId);
    if (p.seat === null) throw new Error('Take a seat first.');
    return { p, seat: this.seats[p.seat], idx: p.seat };
  }

  inRound() {
    return ['insurance', 'playing', 'dealer'].includes(this.phase);
  }

  // Pay to look at the next card in the shoe, just out of curiosity. The fee goes to the player dealer;
  // with frozen balances nobody's chips move, so it is free.
  peek(clientId) {
    const p = this.mustPlayer(clientId);
    if (this.inRound()) throw new Error('The next card can be shown between rounds, not while a hand is being played.');
    if (!this.shoe.length) throw new Error('The shoe is empty. It is reshuffled before the next card.');
    const cost = this.settings.peekCost ?? 10;
    if (this.banker && this.banker !== clientId) {
      if (p.chips < cost) throw new Error(`Seeing the next card costs ${cost}.`);
      p.chips -= cost;
      this.players[this.banker].chips += cost;
      this.addLog(`${p.name} paid ${cost} to see the next card.`);
    } else this.addLog(`${p.name} looked at the next card.`);
    // The card is picked now and set aside face up. It is the next card dealt.
    this.pendingCard = this.pendingCard || this.pick();
    return this.pendingCard;
  }

  // ---- Betting ----
  setBet(clientId, bet) {
    if (this.phase !== 'betting' && this.phase !== 'settled') throw new Error('Bets are closed.');
    if (this.phase === 'settled') this.startBetting();
    const { p, seat } = this.mustSeat(clientId);
    const s = this.settings;
    const main = Math.max(0, Math.round(Number(bet.main) || 0));
    const sides = {};
    const on = s.sideBets || SIDE_KEYS;
    let target = null;
    for (const k of SIDE_KEYS) {
      const v = Math.max(0, Math.round(Number(bet.sides?.[k]) || 0));
      if (v > 0) {
        if (!on.includes(k)) throw new Error(`${SIDE_BETS[k].name} is not offered at this table.`);
        if (k === 'friendBust') {
          target = Number(bet.target);
          const ts = this.seats[target];
          if (!ts || ts.playerId === clientId) throw new Error('Pick a friend who is sitting at the table.');
        }
        if (main === 0) throw new Error('Place a main bet before side bets.');
        if (v > s.maxSideBet) throw new Error(`Side bets are at most ${s.maxSideBet}.`);
        sides[k] = v;
      }
    }
    // Chips can go down one at a time; the minimum only counts once you say you are ready.
    if (bet.ready && main < s.minBet) throw new Error(`Minimum bet is ${s.minBet}. Add more chips before you deal in.`);
    if (main > s.maxBet) throw new Error(`Maximum bet is ${s.maxBet}.`);
    const total = main + sumValues(sides);
    if (total > p.chips) throw new Error('Not enough chips.');
    seat.bet = target === null ? { main, sides } : { main, sides, target };
    seat.ready = main > 0 && !!bet.ready;
  }

  startBetting() {
    if (this.phase !== 'settled' && this.phase !== 'betting') return;
    this.phase = 'betting';
    this.dealer = { cards: [], revealed: false };
    this.turn = null;
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (!seat) continue;
      const p = this.players[seat.playerId];
      if (p.kicked) { this.seats[i] = null; p.seat = null; continue; }
      // Every round starts with empty betting spots; players put fresh chips down.
      this.seats[i] = emptySeat(seat.playerId);
    }
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
  dealCount() {
    if (this.phase !== 'betting' || !this.canDeal()) return 0;
    const n = this.seats.filter((seat) => {
      if (!seat) return false;
      const p = this.players[seat.playerId];
      return seat.bet.main >= this.settings.minBet && seat.bet.main + sumValues(seat.bet.sides) <= p.chips && p.connected !== false;
    }).length;
    return n ? 2 * n + 2 : 0;
  }
  deal() {
    if (this.phase === 'settled') this.startBetting();
    if (!this.banker && !this.frozen) throw new Error('Nobody is the dealer. Someone has to sit as the dealer, or the host can deal with frozen balances.');
    if (!this.canDeal()) throw new Error('Nobody has placed a bet.');
    const playing = this.seats.filter((x) => x && x.bet.main >= this.settings.minBet).length;
    // An untouched shoe is shuffled again when a player's code is not in it yet, so the first shoe
    // of a table also mixes in the codes of the people who are playing it.
    const f = this.fair;
    const fresh = f?.current && this.shoe.length === this.shoeSize && Object.keys(f.next.seeds).some((k) => f.current.clientSeeds[k] === undefined);
    if (this.needsShuffle(playing) || fresh) this.newShoe();
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
        p.lastBet = seat.bet;
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
    this.dealer = { cards: [], revealed: false };
    for (let pass = 0; pass < 2; pass++) {
      for (const i of active) this.seats[i].hands[0].cards.push(this.draw());
      this.dealer.cards.push(this.draw());
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
      if (sides.over13) this.settleSide(seat, 'over13', evalOverUnder(pc, true));
      if (sides.under13) this.settleSide(seat, 'under13', evalOverUnder(pc, false));
    }
    this.addLog(`Round ${this.round} dealt.`);
    if (up.r === 'A') {
      this.phase = 'insurance';
      for (const i of active) {
        const seat = this.seats[i];
        const p = this.players[seat.playerId];
        // Players who cannot afford it, or who are away, skip insurance.
        if (p.chips < Math.ceil(seat.bet.main / 2) || !p.connected) seat.insuranceDecided = true;
      }
      if (this.allInsuranceDecided()) this.afterInsurance();
    } else {
      this.afterInsurance();
    }
  }

  allInsuranceDecided() {
    return this.seats.every((s) => !s || !s.hands.length || s.insuranceDecided);
  }

  insurance(clientId, take) {
    if (this.phase !== 'insurance') throw new Error('Insurance is not offered now.');
    const { p, seat } = this.mustSeat(clientId);
    if (!seat.hands.length || seat.insuranceDecided) return;
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

  drawHole() {
    if (this.dealer.cards.length === 1) this.dealer.cards.push(this.draw());
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
    if (!p || p.seat !== this.turn.seat) return [];
    const seat = this.seats[this.turn.seat];
    const h = seat.hands[this.turn.hand];
    const acts = ['hit', 'stand'];
    const two = h.cards.length === 2;
    if (two && !h.splitAces && p.chips >= h.bet) acts.push('double');
    if (two && cardValue(h.cards[0]) === cardValue(h.cards[1]) && seat.hands.length < 4 && p.chips >= h.bet && !h.splitAces) acts.push('split');
    if (two && seat.hands.length === 1 && this.settings.allowSurrender) acts.push('surrender');
    return acts;
  }

  action(clientId, a) {
    if (!this.allowedActions(clientId).includes(a)) throw new Error('You cannot do that now.');
    const p = this.players[clientId];
    const seat = this.seats[this.turn.seat];
    const h = seat.hands[this.turn.hand];
    if (a === 'hit') {
      h.cards.push(this.draw());
      const t = handTotal(h.cards).total;
      if (t >= 21) h.done = true;
    } else if (a === 'stand') {
      h.done = true;
    } else if (a === 'double') {
      p.chips -= h.bet;
      seat.staked += h.bet;
      h.bet *= 2;
      h.doubled = true;
      h.cards.push(this.draw());
      h.done = true;
    } else if (a === 'split') {
      p.chips -= h.bet;
      seat.staked += h.bet;
      const aces = h.cards[0].r === 'A';
      const second = newHand(h.bet);
      second.cards.push(h.cards.pop());
      second.fromSplit = h.fromSplit = true;
      h.cards.push(this.draw());
      second.cards.push(this.draw());
      if (aces) {
        h.splitAces = second.splitAces = true;
        h.done = second.done = true;
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
    this.seats[this.turn.seat].hands[this.turn.hand].done = true;
    this.advance();
  }

  advance() {
    for (let i = 0; i < this.seats.length; i++) {
      const seat = this.seats[i];
      if (!seat) continue;
      for (let j = 0; j < seat.hands.length; j++) {
        if (!seat.hands[j].done) {
          this.turn = { seat: i, hand: j };
          // A player who left gets an automatic stand.
          const p = this.players[seat.playerId];
          if (!p.connected) { seat.hands[j].done = true; continue; }
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
    const anyLive = this.seats.some((s) => s && s.hands.some((h) => !h.surrendered && handTotal(h.cards).total <= 21 && !isBlackjack(h)));
    const anyBustBet = this.seats.some((s) => s && s.hands.length && s.bet.sides.bustIt);
    if (!anyLive && !anyBustBet) return false;
    const { total, soft } = handTotal(this.dealer.cards);
    if (total < 17) return true;
    if (total === 17 && soft && this.settings.dealerHitsSoft17) return true;
    return false;
  }

  dealerStep() {
    if (this.dealerNeedsCard()) {
      this.dealer.cards.push(this.draw());
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
      if (seat.bet.sides.friendBust) {
        const ts = this.seats[seat.bet.target];
        const fh = ts && ts.hands[0];
        const name = ts ? this.players[ts.playerId]?.name || 'Your friend' : 'Your friend';
        if (!fh || !fh.cards.length) {
          // The friend was not dealt in: the bet comes back.
          const stake = seat.bet.sides.friendBust;
          p.chips += stake; seat.returned += stake;
          seat.sideResults.push({ key: 'friendBust', name: SIDE_BETS.friendBust.name, label: `${name} was not dealt in`, win: false, push: true, stake, pay: stake });
        } else {
          // Only one fifth of the friend's own bet counts, so two players cannot make chips by one of
          // them busting on purpose. The rest of the stake goes back.
          const stake = seat.bet.sides.friendBust;
          const counts = Math.min(stake, Math.floor(ts.bet.main / PVP_BUST_PAYS));
          const back = stake - counts;
          if (back > 0) { p.chips += back; seat.returned += back; }
          const bust = handTotal(fh.cards).total > 21;
          if (counts > 0) this.settleSide(seat, 'friendBust', bust ? { win: true, label: `${name} busted`, mult: PVP_BUST_PAYS } : { win: false, label: `${name} did not bust` }, counts);
          else seat.sideResults.push({ key: 'friendBust', name: SIDE_BETS.friendBust.name, label: `${name} bet too little for this to count`, win: false, push: true, stake, pay: back });
        }
      }
      for (const h of seat.hands) {
        const t = handTotal(h.cards).total;
        let pay = 0;
        if (h.surrendered) { h.result = 'Surrender'; pay = h.bet / 2; }
        else if (t > 21) { h.result = 'Bust'; }
        else if (isBlackjack(h) && !dealerBJ) { h.result = 'Blackjack'; pay = h.bet + h.bet * this.settings.blackjackPays; }
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
      // Win streak, for the fire on a hot player's stack.
      if (seat.net > 0) p.streak = (p.streak || 0) + 1; else if (seat.net < 0) p.streak = 0;
      seat.ready = false;
    }
    // A player sitting as the dealer pays and collects everything.
    if (this.banker && this.players[this.banker]) {
      const tableNet = this.seats.reduce((sum, seat) => sum + (seat && seat.hands.length ? seat.net : 0), 0);
      this.players[this.banker].chips -= tableNet;
      this.bankerNet = -tableNet;
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
    if (this.pendingBanker) this.applyDealer(this.pendingBanker);
    if (this.pendingSettings) this.applySettings(this.pendingSettings);
    this.turn = null;
    this.addLog(`Dealer ${dealerBJ ? 'blackjack' : dealerBust ? 'busts with ' + d : 'has ' + d}.`);
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
    const hole = this.dealer.cards[1];
    return {
      settings: this.settings,
      phase: this.phase,
      round: this.round,
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
        yes: Object.values(this.vote.votes).filter(Boolean).length,
        canVote: this.vote.voters.includes(forClientId) && !(forClientId in this.vote.votes),
      } : null,
      frozen: !this.banker && !!this.frozen,
      noDealer: !this.banker && !this.frozen,
      bankShort: this.bankShort(),
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
          streak: this.players[s.playerId]?.streak || 0,
          insurance: s.insurance,
          insuranceDecided: s.insuranceDecided,
          sideResults: s.sideResults,
          net: s.net,
          hands: s.hands.map((h) => ({ ...h, ...handTotal(h.cards), blackjack: isBlackjack(h) })),
        };
      }),
      players: Object.values(this.players).filter((p) => !p.kicked).map((p) => ({ id: p.id, name: p.name, look: p.look, chips: p.chips, seat: p.seat, connected: p.connected, boughtIn: p.boughtIn || 0, totalIn: p.totalIn ?? this.settings.startChips, left: !!p.kicked })),
      hostId: this.hostId || null,
      count: !this.settings.countTraining ? null : {
        running: (this.runCount || 0) - (hide && hole ? hiLo(hole) : 0),
        decksLeft: (this.shoe.length + (hide && hole ? 1 : 0)) / 52,
      },
      ledger: Object.values(this.players).map((p) => ({ id: p.id, name: p.name, totalIn: p.totalIn ?? this.settings.startChips, chips: p.chips, houseNet: p.houseNet || 0, connected: p.connected, kicked: !!p.kicked })),
      buyIns: (this.buyIns || []).filter((b) => b.playerId === forClientId).map((b) => ({ id: b.id, amount: b.amount })),
      fair: this.fair && {
        nextCommit: this.fair.next.commit,
        current: this.fair.current && { n: this.fair.current.n, commit: this.fair.current.commit, clientSeeds: this.fair.current.clientSeeds, decks: this.fair.current.decks, dealt: (this.fair.current.draws || []).length },
        last: this.fair.last,
      },
      shoe: { left: this.shoe.length, size: this.shoeSize, roundsSinceShuffle: this.roundsSinceShuffle },
      log: this.log.slice(-12),
      you: forClientId,
      actions: this.allowedActions(forClientId),
    };
  }

  // Save and restore so the host can refresh the page without losing the table.
  toJSON() {
    const { settings, seats, players, phase, dealer, turn, round, roundsSinceShuffle, log, shoe, shoeSize, banker, bankerNet, pendingBanker, buyIns, runCount, hostId, pendingSettings, frozen, fair } = this;
    return { settings, seats, players, phase, dealer, turn, round, roundsSinceShuffle, log, shoe, shoeSize, banker, bankerNet, pendingBanker, buyIns, runCount, hostId, pendingSettings, frozen, fair };
  }
  static fromJSON(obj) {
    const t = new Table(obj.settings);
    Object.assign(t, obj);
    if (!obj.fair) t.fair.current = null; // a table saved before fair shuffles: its shoe has no seed to show
    // Tables saved before the seat count was a setting keep the seats they had.
    if (!Array.isArray(t.seats) || !t.seats.length) t.seats = Array(seatCount(obj.settings?.seats)).fill(null);
    t.settings = { ...DEFAULT_SETTINGS, ...obj.settings, seats: t.seats.length };
    Object.values(t.players).forEach((p) => (p.connected = false));
    return t;
  }
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
