// Blackjack table logic. Runs only in the host's browser (the "dealer").
// Everything here is plain JavaScript with no browser APIs, so it can be tested in Node.

export const SUITS = ['♠', '♥', '♦', '♣'];
export const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
export const MAX_SEATS = 5;

export const DEFAULT_SETTINGS = {
  decks: 6,              // 1, 2, 6, 8, or 'csm' (randomized: full reshuffle before every round)
  shuffleMode: 'penetration', // 'penetration' or 'rounds'
  penetration: 75,       // reshuffle once this % of the shoe has been dealt
  shuffleEvery: 5,       // or reshuffle every N rounds
  startChips: 1000,
  minBet: 10,
  maxBet: 1000,
  maxSideBet: 100,
  dealerHitsSoft17: false,
  blackjackPays: 1.5,    // 3:2
  allowSurrender: true,
  autoDeal: true,        // deal as soon as every seated player is ready
  betTimer: 20,          // seconds for betting before the dealer deals on its own (0 = off)
  turnTimer: 30,         // seconds per decision before the dealer stands for you (0 = off)
};

// ---------- Side bets ----------
// Payouts are "to one": a 25 means a $10 bet wins $250 and you also get your $10 back.
export const SIDE_BETS = {
  perfectPairs: {
    name: 'Perfect Pairs',
    short: 'PP',
    about: 'Your first two cards are a pair.',
    table: [['Perfect pair (same suit)', 25], ['Coloured pair (same colour)', 12], ['Mixed pair', 6]],
  },
  twentyOnePlus3: {
    name: '21+3',
    short: '21+3',
    about: 'Your first two cards plus the dealer up card make a poker hand.',
    table: [['Suited three of a kind', 100], ['Straight flush', 40], ['Three of a kind', 30], ['Straight', 10], ['Flush', 5]],
  },
  luckyLadies: {
    name: 'Lucky Ladies',
    short: 'LL',
    about: 'Your first two cards total 20.',
    table: [['Two Q♥ and dealer has blackjack', 1000], ['Two Q♥', 200], ['Matched 20 (same rank and suit)', 25], ['Suited 20', 10], ['Any 20', 4]],
  },
  royalMatch: {
    name: 'Royal Match',
    short: 'RM',
    about: 'Your first two cards are the same suit.',
    table: [['Suited K and Q', 25], ['Any suited cards', 2.5]],
  },
  luckyLucky: {
    name: 'Lucky Lucky',
    short: 'LkLk',
    about: 'Your first two cards plus the dealer up card total 19, 20 or 21.',
    table: [['Suited 7-7-7', 200], ['Suited 6-7-8', 100], ['7-7-7', 50], ['6-7-8', 30], ['Suited 21', 15], ['Any 21', 3], ['20', 2], ['19', 2]],
  },
  over13: {
    name: 'Over 13',
    short: '>13',
    about: 'Your first two cards total more than 13 (aces count as 1).',
    table: [['Total 14 or more', 1]],
  },
  under13: {
    name: 'Under 13',
    short: '<13',
    about: 'Your first two cards total less than 13 (aces count as 1).',
    table: [['Total 12 or less', 1]],
  },
  bustIt: {
    name: 'Dealer Bust',
    short: 'Bust',
    about: 'The dealer busts. More cards in the busted hand pay more.',
    table: [['8+ cards', 250], ['7 cards', 100], ['6 cards', 50], ['5 cards', 9], ['4 cards', 2], ['3 cards', 1]],
  },
};
export const SIDE_KEYS = Object.keys(SIDE_BETS);

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

export function buildShoe(decks) {
  const shoe = [];
  for (let d = 0; d < decks; d++) for (const s of SUITS) for (const r of RANKS) shoe.push({ r, s });
  for (let i = shoe.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shoe[i], shoe[j]] = [shoe[j], shoe[i]];
  }
  return shoe;
}

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
    this.seats = Array(MAX_SEATS).fill(null);
    this.players = {}; // clientId -> { name, chips, seat, connected }
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
  newShoe() {
    this.shoe = buildShoe(this.shoeDecks());
    this.shoeSize = this.shoe.length;
    this.roundsSinceShuffle = 0;
    this.addLog('The shoe was shuffled.');
  }
  needsShuffle(players = MAX_SEATS) {
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
      this.shoe = buildShoe(this.shoeDecks());
      this.shoeSize = this.shoe.length;
      this.addLog('Shoe ran out mid round and was reshuffled.');
    }
    return this.shoe.pop();
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
    this.settings = s;
    if (old.decks !== s.decks) this.newShoe();
  }

  addLog(msg) {
    this.log.push(msg);
    if (this.log.length > 40) this.log.shift();
  }

  // ---- Players ----
  join(clientId, name) {
    name = String(name || 'Player').trim().slice(0, 16) || 'Player';
    let p = this.players[clientId];
    if (p) {
      p.connected = true;
      p.name = name;
      return p;
    }
    p = { id: clientId, name, chips: this.settings.startChips, seat: null, connected: true, lastBet: null };
    this.players[clientId] = p;
    this.addLog(`${name} joined.`);
    return p;
  }

  sit(clientId, seatIdx) {
    const p = this.mustPlayer(clientId);
    if (seatIdx < 0 || seatIdx >= MAX_SEATS) throw new Error('No such seat.');
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

  castVote(clientId, yes) {
    const v = this.vote;
    if (!v || !v.voters.includes(clientId) || clientId in v.votes) return;
    v.votes[clientId] = !!yes;
    const name = this.players[v.candidate].name;
    if (!yes) {
      this.vote = null;
      this.addLog(`${this.players[clientId].name} voted no. ${name} stays where they are.`);
      return;
    }
    if (v.voters.every((id) => v.votes[id] === true)) {
      this.vote = null;
      this.addLog(`Everyone said yes. ${name} moves to the dealer seat.`);
      this.applyDealer(v.candidate);
    }
  }

  expireVote(voteId) {
    if (!this.vote || this.vote.id !== voteId) return;
    this.addLog(`The vote for ${this.players[this.vote.candidate].name} ran out, so the answer is no.`);
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

  giveChips(clientId, amount) {
    const p = this.mustPlayer(clientId);
    p.chips = Math.max(0, p.chips + Math.round(Number(amount) || 0));
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

  // ---- Betting ----
  setBet(clientId, bet) {
    if (this.phase !== 'betting' && this.phase !== 'settled') throw new Error('Bets are closed.');
    if (this.phase === 'settled') this.startBetting();
    const { p, seat } = this.mustSeat(clientId);
    const s = this.settings;
    const main = Math.max(0, Math.round(Number(bet.main) || 0));
    const sides = {};
    for (const k of SIDE_KEYS) {
      const v = Math.max(0, Math.round(Number(bet.sides?.[k]) || 0));
      if (v > 0) {
        if (main === 0) throw new Error('Place a main bet before side bets.');
        if (v > s.maxSideBet) throw new Error(`Side bets are at most ${s.maxSideBet}.`);
        sides[k] = v;
      }
    }
    if (main > 0 && main < s.minBet) throw new Error(`Minimum bet is ${s.minBet}.`);
    if (main > s.maxBet) throw new Error(`Maximum bet is ${s.maxBet}.`);
    const total = main + sumValues(sides);
    if (total > p.chips) throw new Error('Not enough chips.');
    seat.bet = { main, sides };
    seat.ready = main > 0 && !!bet.ready;
  }

  startBetting() {
    if (this.phase !== 'settled' && this.phase !== 'betting') return;
    this.phase = 'betting';
    this.dealer = { cards: [], revealed: false };
    this.turn = null;
    for (let i = 0; i < MAX_SEATS; i++) {
      const seat = this.seats[i];
      if (!seat) continue;
      const p = this.players[seat.playerId];
      if (p.kicked) { this.seats[i] = null; p.seat = null; continue; }
      const last = seat.bet;
      const fresh = emptySeat(seat.playerId);
      // Keep last round's bet if the player can still afford it (rebet).
      if (last && last.main > 0 && last.main + sumValues(last.sides) <= p.chips) fresh.bet = last;
      this.seats[i] = fresh;
    }
  }

  canDeal() {
    return this.phase === 'betting' && this.seats.some((s) => s && s.bet.main > 0 && this.players[s.playerId].connected !== false);
  }

  // ---- Dealing ----
  deal() {
    if (this.phase === 'settled') this.startBetting();
    if (!this.canDeal()) throw new Error('Nobody has placed a bet.');
    const playing = this.seats.filter((x) => x && x.bet.main > 0).length;
    if (this.needsShuffle(playing)) this.newShoe();
    this.round++;
    this.roundsSinceShuffle++;
    const active = [];
    this.seats.forEach((seat, i) => {
      if (!seat) return;
      const p = this.players[seat.playerId];
      const stake = seat.bet.main + sumValues(seat.bet.sides);
      if (seat.bet.main > 0 && stake <= p.chips && p.connected !== false) {
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

  afterInsurance() {
    const up = this.dealer.cards[0];
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
    for (let i = 0; i < MAX_SEATS; i++) {
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
      seat.ready = false;
    }
    // A player sitting as the dealer pays and collects everything.
    if (this.banker && this.players[this.banker]) {
      const tableNet = this.seats.reduce((sum, seat) => sum + (seat && seat.hands.length ? seat.net : 0), 0);
      this.players[this.banker].chips -= tableNet;
      this.bankerNet = -tableNet;
    } else this.bankerNet = null;
    this.phase = 'settled';
    if (this.pendingBanker) this.applyDealer(this.pendingBanker);
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
    const hide = !this.dealer.revealed && this.dealer.cards.length === 2;
    return {
      settings: this.settings,
      phase: this.phase,
      round: this.round,
      turn: this.turn,
      dealer: {
        cards: this.dealer.cards.map((c, i) => (hide && i === 1 ? { hidden: true } : c)),
        total: hide ? handTotal([this.dealer.cards[0]]).total : handTotal(this.dealer.cards).total,
        soft: hide ? false : handTotal(this.dealer.cards).soft,
      },
      vote: this.vote ? {
        id: this.vote.id,
        candidate: this.vote.candidate,
        name: this.players[this.vote.candidate].name,
        voters: this.vote.voters.length,
        yes: Object.values(this.vote.votes).filter(Boolean).length,
        canVote: this.vote.voters.includes(forClientId) && !(forClientId in this.vote.votes),
      } : null,
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
          insurance: s.insurance,
          insuranceDecided: s.insuranceDecided,
          sideResults: s.sideResults,
          net: s.net,
          hands: s.hands.map((h) => ({ ...h, ...handTotal(h.cards), blackjack: isBlackjack(h) })),
        };
      }),
      players: Object.values(this.players).filter((p) => !p.kicked).map((p) => ({ id: p.id, name: p.name, chips: p.chips, seat: p.seat, connected: p.connected })),
      shoe: { left: this.shoe.length, size: this.shoeSize, roundsSinceShuffle: this.roundsSinceShuffle },
      log: this.log.slice(-12),
      you: forClientId,
      actions: this.allowedActions(forClientId),
    };
  }

  // Save and restore so the host can refresh the page without losing the table.
  toJSON() {
    const { settings, seats, players, phase, dealer, turn, round, roundsSinceShuffle, log, shoe, shoeSize, banker, bankerNet, pendingBanker } = this;
    return { settings, seats, players, phase, dealer, turn, round, roundsSinceShuffle, log, shoe, shoeSize, banker, bankerNet, pendingBanker };
  }
  static fromJSON(obj) {
    const t = new Table(obj.settings);
    Object.assign(t, obj);
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
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, isNaN(v) ? lo : v));
}
