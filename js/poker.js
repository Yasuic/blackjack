// No-limit Texas Hold'em for up to 9 players. Pure rules: the host's browser owns one PokerTable and
// every action goes through it. Nothing here touches the page or the network.
import { SUITS, RANKS, sha256, fairSeed, fairShoe, MAX_CHIPS } from './game.js?v=20261121e';

export const POKER_SEATS = 9;
export const POKER_DEFAULTS = {
  smallBlind: 2,
  bigBlind: 3,
  ante: 0,            // paid by every player dealt in, on top of the blinds
  startStack: 300,   // chips a new player sits down with
  turnTimer: 30,      // seconds per decision, 0 = no clock
  timeBank: 60,       // extra seconds each player owns; used when the clock runs out, 10 come back every hand
  autoStart: true,    // the next hand starts by itself
  sevenDeuce: 15,     // bounty every dealt player pays to someone who wins a hand holding 7-2 (0 = off)
  bombPotEvery: 0,    // every N hands is a bomb pot (0 = only when the host asks for one)
  bombPotAnte: 2,     // what each player posts in a bomb pot, in big blinds
  rabbitHunt: true,   // after a hand ends early, players may look at the cards that would have come
  straddle: false,    // the player left of the big blind may post 2 big blinds before the cards
  showSpeed: 'fast',  // how long an all in showdown takes on screen: fast, normal or long
  runTimes: 10,       // when everyone is all in before the river, the rest of the board is dealt this many times (1 to 10) and the pot is shared between the runs
};

const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };
const rankVal = (c) => (c.r === 'A' ? 14 : c.r === 'K' ? 13 : c.r === 'Q' ? 12 : c.r === 'J' ? 11 : Number(c.r));
export const cardText = (c) => c.r + c.s;

// ---------- Hand ranking ----------
// score5 gives one number for five cards; a higher number is the better hand. Category first
// (8 straight flush .. 0 high card), then the ranks that break ties, most important first.
const CATS = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];
function score5(cs) {
  const v = cs.map(rankVal).sort((a, b) => b - a);
  const flush = cs.every((c) => c.s === cs[0].s);
  const uniq = [...new Set(v)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (v[0] - v[4] === 4) straightHigh = v[0];
    else if (v[0] === 14 && v[1] === 5 && v[4] === 2) straightHigh = 5; // A-2-3-4-5: the ace plays low
  }
  const count = {};
  for (const x of v) count[x] = (count[x] || 0) + 1;
  // Ranks ordered by how many there are, then by rank: this is the tie-break order for every paired hand.
  const groups = Object.keys(count).map(Number).sort((a, b) => count[b] - count[a] || b - a);
  const shape = groups.map((g) => count[g]).join('');
  let cat, tie;
  if (straightHigh && flush) { cat = 8; tie = [straightHigh]; }
  else if (shape === '41') { cat = 7; tie = groups; }
  else if (shape === '32') { cat = 6; tie = groups; }
  else if (flush) { cat = 5; tie = v; }
  else if (straightHigh) { cat = 4; tie = [straightHigh]; }
  else if (shape === '311') { cat = 3; tie = groups; }
  else if (shape === '221') { cat = 2; tie = groups; }
  else if (shape === '2111') { cat = 1; tie = groups; }
  else { cat = 0; tie = v; }
  let s = cat;
  for (let i = 0; i < 5; i++) s = s * 15 + (tie[i] || 0);
  return s;
}
// Best five of up to seven cards. Returns { score, cat, name, cards } where cards are the five that play.
export function bestHand(cards) {
  let best = null;
  const n = cards.length, pick = [];
  const go = (start) => {
    if (pick.length === 5) { const five = pick.map((i) => cards[i]); const s = score5(five); if (!best || s > best.score) best = { score: s, cards: five }; return; }
    for (let i = start; i < n; i++) { pick.push(i); go(i + 1); pick.pop(); }
  };
  if (n < 5) return null;
  go(0);
  const cat = Math.floor(best.score / 15 ** 5);
  return { ...best, cat, name: handName(cat, best.cards) };
}
const RNAME = { 14: 'ace', 13: 'king', 12: 'queen', 11: 'jack', 10: 'ten', 9: 'nine', 8: 'eight', 7: 'seven', 6: 'six', 5: 'five', 4: 'four', 3: 'three', 2: 'two' };
const plural = (r) => (r === 6 ? 'sixes' : RNAME[r] + 's');
function handName(cat, five) {
  const v = five.map(rankVal).sort((a, b) => b - a);
  const count = {};
  for (const x of v) count[x] = (count[x] || 0) + 1;
  const g = Object.keys(count).map(Number).sort((a, b) => count[b] - count[a] || b - a);
  const wheel = v[0] === 14 && v[1] === 5;
  switch (cat) {
    case 8: return wheel ? 'Straight flush, five high' : v[0] === 14 ? 'Royal flush' : `Straight flush, ${RNAME[v[0]]} high`;
    case 7: return `Four ${plural(g[0])}`;
    case 6: return `Full house, ${plural(g[0])} full of ${plural(g[1])}`;
    case 5: return `Flush, ${RNAME[v[0]]} high`;
    case 4: return `Straight, ${RNAME[wheel ? 5 : v[0]]} high`;
    case 3: return `Three ${plural(g[0])}`;
    case 2: return `Two pair, ${plural(g[0])} and ${plural(g[1])}`;
    case 1: return `Pair of ${plural(g[0])}`;
    default: return `${RNAME[v[0]][0].toUpperCase() + RNAME[v[0]].slice(1)} high`;
  }
}
export { CATS };

// ---------- Fair deck ----------
// Before a hand the host's browser shows sha256(server seed) for that hand. Each player's browser sends
// a seed of its own. The order of the 52 cards comes only from the server seed and those player seeds,
// so nobody can choose it, and the seed is shown when the hand is over so anyone can deal it again.
function randomSeed() {
  const buf = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < 32; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (x) => x.toString(16).padStart(2, '0')).join('');
}
const newCommit = () => { const seed = randomSeed(); return { seed, commit: sha256(seed) }; };
// The deck of a finished hand, in the order it was dealt (first card dealt first).
export function pokerDeck(serverSeed, clientSeeds = {}) { return fairShoe(1, serverSeed, clientSeeds).reverse(); }
// Check a finished hand's record: the seed matches what was promised, and the deck gives these cards.
export function verifyHand(rec) {
  if (!rec || sha256(rec.serverSeed) !== rec.commit) return { ok: false, why: 'The seed does not match the code shown before the hand.' };
  const deck = pokerDeck(rec.serverSeed, rec.clientSeeds);
  const dealt = (rec.dealt || []).map(cardText).join(' ');
  const want = deck.slice(0, (rec.dealt || []).length).map(cardText).join(' ');
  return dealt === want ? { ok: true, deck } : { ok: false, why: 'The cards dealt are not the cards this seed gives.' };
}

// ---------- The table ----------
export class PokerTable {
  constructor(settings = {}) {
    this.settings = { ...POKER_DEFAULTS };
    this.seats = new Array(POKER_SEATS).fill(null); // { id, stack, bet, total, cards, folded, allIn, acted, inHand, out, show }
    this.players = {};   // id -> { id, name, connected, totalIn, look }
    this.hostId = null;
    this.button = -1;
    this.handNo = 0;
    this.phase = 'waiting'; // waiting | preflop | flop | turn | river | done
    this.board = [];
    this.pot = 0;          // chips from earlier betting rounds (bets of the round in play sit on the seats)
    this.currentBet = 0;
    this.minRaise = 0;
    this.turn = null;      // seat index to act
    this.deck = [];
    this.dealt = [];
    this.log = [];
    this.hist = [];        // finished hands, newest last
    this.result = null;
    this.rabbit = null;
    this.bombNext = false;
    this.pending = {};     // id -> chips to add when the player is not in a hand
    this.fair = { next: newCommit(), seeds: {}, last: null };
    this.updateSettings(settings, true);
  }

  // ---- settings ----
  updateSettings(patch = {}, force = false) {
    if (!force && this.inHand()) throw new Error('Change settings between hands.');
    const s = { ...this.settings, ...patch };
    s.bigBlind = clampInt(s.bigBlind, 1, 1e6, this.settings.bigBlind);
    s.smallBlind = clampInt(s.smallBlind, 0, s.bigBlind, Math.min(this.settings.smallBlind, s.bigBlind));
    s.ante = clampInt(s.ante, 0, 1e6, this.settings.ante);
    s.startStack = clampInt(s.startStack, 1, MAX_CHIPS, this.settings.startStack);
    s.turnTimer = [0, 10, 15, 20, 30, 45, 60, 90].includes(Number(s.turnTimer)) ? Number(s.turnTimer) : this.settings.turnTimer;
    s.timeBank = clampInt(s.timeBank, 0, 600, this.settings.timeBank);
    s.sevenDeuce = clampInt(s.sevenDeuce, 0, 1e6, this.settings.sevenDeuce);
    s.bombPotEvery = clampInt(s.bombPotEvery, 0, 100, this.settings.bombPotEvery);
    s.bombPotAnte = clampInt(s.bombPotAnte, 1, 100, this.settings.bombPotAnte);
    s.runTimes = clampInt(s.runTimes, 1, 10, this.settings.runTimes);
    for (const k of ['autoStart', 'straddle']) s[k] = !!s[k];
    s.rabbitHunt = true; // always allowed
    s.showSpeed = ['fast', 'normal', 'long'].includes(s.showSpeed) ? s.showSpeed : 'fast';
    this.settings = s;
  }

  addLog(line) { this.log.push(line); if (this.log.length > 200) this.log.splice(0, this.log.length - 200); if (this.cur) this.cur.lines.push(line); }
  inHand() { return this.phase !== 'waiting' && this.phase !== 'done'; }
  mustPlayer(id) { const p = this.players[id]; if (!p) throw new Error('Join the table first.'); return p; }
  seatOf(id) { return this.seats.findIndex((x) => x && x.id === id); }
  name(i) { return this.players[this.seats[i].id]?.name || 'Player'; }
  chipsTotal() { return this.seats.reduce((a, x) => a + (x ? x.stack + x.bet : 0), 0) + this.pot; }

  // ---- people ----
  join(id, name, look) {
    let p = this.players[id];
    const clean = String(name || 'Player').replace(/[<>]/g, '').trim().slice(0, 16) || 'Player';
    if (p) { p.connected = true; p.name = clean; if (look) p.look = look; return p; }
    p = { id, name: clean, connected: true, totalIn: 0, look: look || { skin: 2, hair: 0 } };
    this.players[id] = p;
    if (!this.hostId) this.hostId = id;
    this.addLog(`${clean} joined.`);
    return p;
  }
  disconnect(id) { const p = this.players[id]; if (p) p.connected = false; }
  // Sit down with a stack. Between hands the seat plays from the next hand on.
  sit(id, seatIdx, buyIn) {
    const p = this.mustPlayer(id);
    if (this.seatOf(id) >= 0) throw new Error('You already have a seat.');
    if (!Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx >= POKER_SEATS) throw new Error('No such seat.');
    if (this.seats[seatIdx]) throw new Error('That seat is taken.');
    const amount = clampInt(buyIn ?? this.settings.startStack, 1, MAX_CHIPS, this.settings.startStack);
    this.seats[seatIdx] = { id, stack: amount, bet: 0, total: 0, cards: [], folded: false, allIn: false, acted: false, inHand: false, out: false, show: false, bank: this.settings.timeBank };
    p.totalIn += amount;
    this.addLog(`${p.name} sat down with ${amount}.`);
  }
  // Leave the seat. In a hand the cards are folded first; the stack leaves the table with the player.
  standUp(id) {
    const i = this.seatOf(id);
    if (i < 0) return;
    const s = this.seats[i], p = this.players[id];
    if (s.inHand && !s.folded && this.inHand()) this.foldSeat(i, true);
    if (s.inHand && this.inHand()) { s.leaving = true; return; } // the chips already in the pot stay; the seat frees when the hand ends
    p.totalIn -= s.stack;
    this.seats[i] = null;
    delete this.pending[id];
    this.addLog(`${p.name} left the seat with ${s.stack}.`);
  }
  sitOut(id, on) { const i = this.seatOf(id); if (i < 0) return; this.seats[i].out = !!on; if (this.awayVotes) delete this.awayVotes[id]; }
  // The other players may mark someone away, so the game does not wait for them. Every other seated player
  // who is not away must agree. The player keeps the seat and the chips and comes back with one press.
  voteAway(voterId, targetId, on = true) {
    const v = this.seatOf(voterId), t = this.seatOf(targetId);
    if (v < 0 || t < 0 || v === t) throw new Error('Only seated players can vote on another seated player.');
    if (this.seats[t].out) return;
    const votes = (this.awayVotes ||= {});
    const set = new Set(votes[targetId] || []);
    if (on) set.add(voterId); else set.delete(voterId);
    votes[targetId] = [...set];
    if (on && set.size === 1) this.addLog(`${this.players[voterId].name} asks to mark ${this.players[targetId].name} away. Every other player must agree.`);
    const voters = this.seats.filter((x) => x && x.id !== targetId && !x.out).map((x) => x.id);
    if (voters.length >= 1 && voters.every((id) => set.has(id))) {
      this.seats[t].out = true; delete votes[targetId];
      this.addLog(`${this.players[targetId].name} was marked away by a vote of all other players.`);
    }
  }
  // More chips. They reach the stack at once when the seat is not in a hand, otherwise when the hand ends.
  addChips(id, amount) {
    const p = this.mustPlayer(id), i = this.seatOf(id);
    if (i < 0) throw new Error('Take a seat first.');
    amount = clampInt(amount, 1, MAX_CHIPS, 0);
    if (!amount) throw new Error('Pick an amount of at least 1.');
    if (this.seats[i].inHand && this.inHand()) { this.pending[id] = (this.pending[id] || 0) + amount; return; }
    this.seats[i].stack += amount; p.totalIn += amount;
    this.addLog(`${p.name} added ${amount} (stack now ${this.seats[i].stack}).`);
  }
  // Take chips off your own stack. Only while you are not in a hand, so nobody can pull chips out of a pot,
  // and it is written in the log for everyone. The ledger counts them as cashed out.
  takeChips(id, amount) {
    const p = this.mustPlayer(id), i = this.seatOf(id);
    if (i < 0) throw new Error('Take a seat first.');
    const x = this.seats[i];
    if (x.inHand && this.inHand()) throw new Error('Wait until the hand is over to take chips off.');
    amount = clampInt(amount, 1, MAX_CHIPS, 0);
    if (!amount || amount > x.stack) throw new Error('You do not have that many chips.');
    x.stack -= amount; p.totalIn -= amount;
    this.addLog(`${p.name} took ${amount} off the table (stack now ${x.stack}).`);
  }
  // The host sets a stack (to fix a mistake). The ledger counts the change as chips bought or taken out.
  setStack(id, amount) {
    const i = this.seatOf(id);
    if (i < 0) throw new Error('That player has no seat.');
    if (this.seats[i].inHand && this.inHand()) throw new Error('Change a stack between hands.');
    amount = clampInt(amount, 0, MAX_CHIPS, this.seats[i].stack);
    this.players[id].totalIn += amount - this.seats[i].stack;
    this.seats[i].stack = amount;
    this.addLog(`The host set ${this.players[id].name}'s stack to ${amount}.`);
  }
  kick(id) { this.standUp(id); const p = this.players[id]; if (p) { p.kicked = true; p.connected = false; } }
  // A player's seed for the coming hand. It only counts when it was made after the host promised its own
  // seed for that hand (the player's browser names the promise it saw), so the host cannot pick its seed to fit.
  setClientSeed(id, seed, commit) {
    if (!this.players[id] || commit !== this.fair.next.commit) return;
    this.fair.seeds[id] = String(seed).replace(/[^0-9a-zA-Z]/g, '').slice(0, 64);
  }

  // ---- starting a hand ----
  eligible() { return this.seats.map((x, i) => (x && !x.out && x.stack > 0 ? i : -1)).filter((i) => i >= 0); }
  canStart() { return !this.inHand() && this.eligible().length >= 2; }
  nextFrom(i, ok) { for (let k = 1; k <= POKER_SEATS; k++) { const j = (i + k) % POKER_SEATS; if (ok(j)) return j; } return -1; }
  draw() { const c = this.deck.shift(); this.dealt.push(c); return c; }

  startHand() {
    if (!this.canStart()) throw new Error('Two players with chips are needed.');
    // Leftovers of the hand before.
    for (let i = 0; i < POKER_SEATS; i++) { const x = this.seats[i]; if (x) Object.assign(x, { bet: 0, total: 0, cards: [], folded: false, allIn: false, acted: false, inHand: false, show: false, won: 0, hand: null }); }
    const inIdx = this.eligible();
    const live = (j) => inIdx.includes(j);
    this.handNo++;
    this.button = this.nextFrom(this.button < 0 ? inIdx[inIdx.length - 1] : this.button, live);
    const s = this.settings;
    const bomb = this.bombNext || (s.bombPotEvery > 0 && this.handNo % s.bombPotEvery === 0);
    this.bombNext = false;
    // The deck: fixed now by the promised seed and the players' seeds, never changed afterwards.
    const f = this.fair, seeds = {};
    // Every seed sent for this hand counts, also from people watching. The host's own seed is left out:
    // the host knows the hidden seed, so a seed of theirs could be picked to fit.
    for (const id of Object.keys(f.seeds).sort()) if (id !== this.hostId) seeds[id] = f.seeds[id];
    f.seeds = {};
    this.cur = { hand: this.handNo, commit: f.next.commit, serverSeed: f.next.seed, clientSeeds: seeds, lines: [], bomb, time: Date.now() };
    this.deck = pokerDeck(f.next.seed, seeds);
    this.dealt = [];
    f.next = newCommit();
    this.board = []; this.pot = 0; this.result = null; this.rabbit = null; this.bomb = bomb; this.allInRun = false; this.runout = null; this.runs = 1; this.runBase = null; this.boards = null;
    for (const i of inIdx) { const x = this.seats[i]; x.inHand = true; x.bank = Math.min(this.settings.timeBank, (x.bank ?? this.settings.timeBank) + (this.handNo > 1 ? 10 : 0)); }
    this.addLog(`Hand ${this.handNo}${bomb ? ' (bomb pot)' : ''}. ${this.name(this.button)} has the button.`);
    const post = (i, amount, what) => {
      const x = this.seats[i], pay = Math.min(x.stack, amount);
      x.stack -= pay; x.bet += pay; x.total += pay;
      if (x.stack === 0) x.allIn = true;
      if (pay && what) this.addLog(`${this.name(i)} posts ${what} ${pay}${x.allIn ? ' and is all in' : ''}.`);
      return pay;
    };
    if (bomb) {
      // Bomb pot: everyone puts in the same amount, there is no betting before the flop.
      for (const i of inIdx) post(i, s.bombPotAnte * s.bigBlind, 'the bomb pot');
      this.dealHole(inIdx);
      this.phase = 'preflop'; this.currentBet = 0; this.minRaise = s.bigBlind; this.turn = null;
      this.endStreet();
      return;
    }
    // Antes go straight to the pot and do not count as a bet.
    if (s.ante) for (const i of inIdx) { const x = this.seats[i], pay = Math.min(x.stack, s.ante); x.stack -= pay; x.total += pay; this.pot += pay; if (x.stack === 0) x.allIn = true; }
    if (s.ante) this.addLog(`Everyone posts the ante of ${s.ante}.`);
    // Two players: the button posts the small blind and acts first before the flop.
    const heads = inIdx.length === 2;
    const sb = heads ? this.button : this.nextFrom(this.button, live);
    const bb = this.nextFrom(sb, live);
    if (!this.seats[sb].allIn) post(sb, s.smallBlind, 'the small blind');
    if (!this.seats[bb].allIn) post(bb, s.bigBlind, 'the big blind');
    this.currentBet = s.bigBlind; this.minRaise = s.bigBlind;
    let first = this.nextFrom(bb, live);
    // Straddle: the player after the big blind posts two big blinds blind and acts last before the flop.
    if (s.straddle && inIdx.length >= 3 && this.seats[first].straddle && this.seats[first].stack >= 2 * s.bigBlind) {
      post(first, 2 * s.bigBlind, 'a straddle');
      this.currentBet = 2 * s.bigBlind; this.minRaise = 2 * s.bigBlind;
      first = this.nextFrom(first, live);
    }
    this.dealHole(inIdx);
    this.phase = 'preflop';
    this.turn = null;
    this.seekTurn(this.prevSeat(first));
  }
  prevSeat(i) { return (i + POKER_SEATS - 1) % POKER_SEATS; }
  dealHole(inIdx) {
    // One card at a time, starting left of the button, twice round.
    const order = [];
    let j = this.button;
    for (let k = 0; k < inIdx.length; k++) { j = this.nextFrom(j, (q) => inIdx.includes(q)); order.push(j); }
    for (let r = 0; r < 2; r++) for (const i of order) this.seats[i].cards.push(this.draw());
  }

  // ---- betting ----
  liveSeats() { return this.seats.map((x, i) => (x && x.inHand && !x.folded ? i : -1)).filter((i) => i >= 0); }
  needsAct(i) { const x = this.seats[i]; return !!x && x.inHand && !x.folded && !x.allIn && (!x.acted || x.bet < this.currentBet); }
  // Find who acts next, clockwise after seat `from`. Ends the round when nobody has to.
  seekTurn(from) {
    const live = this.liveSeats();
    if (live.length <= 1) { this.turn = null; this.finishHand(); return; }
    const canBet = live.filter((i) => !this.seats[i].allIn);
    // Betting is over when at most one player still has chips and has matched the bet.
    if (canBet.length <= 1 && canBet.every((i) => this.seats[i].bet >= this.currentBet)) { this.turn = null; this.endStreet(); return; }
    const j = this.nextFrom(from, (q) => this.needsAct(q));
    if (j < 0) { this.turn = null; this.endStreet(); return; }
    this.turn = j;
    this.turnStarted = Date.now();
  }
  // What the player to act may do.
  options(id) {
    const i = this.seatOf(id);
    if (!this.inHand() || i < 0 || this.turn !== i) return null;
    const x = this.seats[i], toCall = Math.min(x.stack, this.currentBet - x.bet), max = x.bet + x.stack;
    const others = this.liveSeats().some((q) => q !== i && !this.seats[q].allIn);
    // A raise is open unless this player already acted and only a short all in came since.
    const mayRaise = !x.acted && others && max > this.currentBet;
    const minTo = Math.min(max, this.currentBet + this.minRaise);
    return { toCall, canCheck: x.bet >= this.currentBet, canRaise: mayRaise, minTo: mayRaise ? minTo : null, maxTo: mayRaise ? max : null, isBet: this.currentBet === 0, pot: this.potTotal() };
  }
  potTotal() { return this.pot + this.seats.reduce((a, x) => a + (x ? x.bet : 0), 0); }

  act(id, type, amount) {
    const i = this.seatOf(id), o = this.options(id);
    if (!o) throw new Error('It is not your turn.');
    const x = this.seats[i], nm = this.name(i);
    if (type !== 'fold' && type !== 'check' && type !== 'call' && type !== 'raise' && type !== 'bet') throw new Error('Unknown move.');
    // Seconds used past the clock come out of the player's time bank.
    if (this.settings.turnTimer && this.turnStarted) { const over = (Date.now() - this.turnStarted) / 1000 - this.settings.turnTimer; if (over > 0) x.bank = Math.max(0, Math.round((x.bank || 0) - over)); }
    if (type === 'fold') { this.foldSeat(i); return; }
    if (type === 'check') {
      if (!o.canCheck) throw new Error('You cannot check: there is a bet to call.');
      x.acted = true; this.addLog(`${nm} checks.`);
    } else if (type === 'call') {
      if (o.canCheck) throw new Error('There is nothing to call.');
      const pay = o.toCall;
      x.stack -= pay; x.bet += pay; x.total += pay; x.acted = true;
      if (x.stack === 0) x.allIn = true;
      this.addLog(`${nm} calls ${pay}${x.allIn ? ' and is all in' : ''}.`);
    } else if (type === 'raise' || type === 'bet') {
      if (!o.canRaise) throw new Error('You cannot raise now.');
      const to = Math.round(Number(amount));
      if (!Number.isFinite(to) || to > o.maxTo) throw new Error('You do not have that many chips.');
      if (to < o.minTo) throw new Error(`The smallest ${o.isBet ? 'bet' : 'raise'} is to ${o.minTo}.`);
      const pay = to - x.bet, by = to - this.currentBet;
      x.stack -= pay; x.bet = to; x.total += pay; x.acted = true;
      if (x.stack === 0) x.allIn = true;
      if (by >= this.minRaise) {
        // A full bet or raise: everyone else may act again.
        this.minRaise = by;
        for (const q of this.liveSeats()) if (q !== i) this.seats[q].acted = false;
      }
      this.addLog(`${nm} ${o.isBet ? 'bets' : 'raises to'} ${to}${x.allIn ? ' and is all in' : ''}.`);
      this.currentBet = to;
    } else throw new Error('Unknown move.');
    this.seekTurn(i);
  }
  foldSeat(i, leaving = false) {
    const x = this.seats[i];
    x.folded = true; x.acted = true;
    this.addLog(`${this.name(i)} folds${leaving ? ' and leaves' : ''}.`);
    if (this.turn === i || this.liveSeats().length <= 1) this.seekTurn(i);
  }
  // The clock ran out, or the player is away: check when it is free, otherwise fold.
  timeout(id) {
    const o = this.options(id);
    if (!o) return;
    this.addLog(`${this.players[id].name} ran out of time.`);
    this.act(id, o.canCheck ? 'check' : 'fold');
  }

  // ---- streets ----
  collect() { for (const x of this.seats) if (x) { this.pot += x.bet; x.bet = 0; x.acted = false; } this.currentBet = 0; this.minRaise = this.settings.bigBlind; }
  // Chips nobody matched go back before the next card, so the pot only holds called money.
  refundUncalled() {
    const bets = this.seats.map((x, i) => (x && x.inHand ? [x.bet, i] : null)).filter(Boolean).sort((a, b) => b[0] - a[0]);
    if (bets.length < 2 || bets[0][0] === bets[1][0]) return;
    const [top, i] = bets[0], back = top - bets[1][0], x = this.seats[i];
    if (x.folded) return;
    x.bet -= back; x.total -= back; x.stack += back;
    if (x.stack > 0) x.allIn = false;
    this.addLog(`${back} goes back to ${this.name(i)}.`);
  }
  endStreet() {
    this.refundUncalled();
    this.collect();
    const live = this.liveSeats();
    if (live.length <= 1) { this.finishHand(); return; }
    if (this.phase === 'river') { this.finishHand(); return; }
    const canBet = live.filter((i) => !this.seats[i].allIn);
    if (canBet.length <= 1) {
      // Nobody left to bet against: the hands turn face up and the rest of the board comes.
      // Before each new card the chances of every hand are worked out, for the display.
      if (!this.allInRun) {
        this.allInRun = true; this.runout = [];
        for (const i of live) this.seats[i].show = true;
        // Run it more than once: as many runs as the table asks for and the deck has cards for.
        // The first run burns a card before each street as usual; later runs deal straight from the deck.
        const need = 5 - this.board.length, first = need + (need === 5 ? 3 : need === 2 ? 2 : 1);
        this.runBase = [...this.board];
        // Each player picks how many times they like to run it (1 to 10); the lowest pick among the players in the hand counts.
        const want = Math.min(this.settings.runTimes, ...live.map((i) => this.seats[i].runs || 2));
        this.runs = 1 + Math.max(0, Math.min(want - 1, Math.floor((this.deck.length - first) / need)));
      }
      if (!PokerTable.noChances) this.runout.push(this.chances(live));
      this.nextStreet();
      this.endStreet();
      return;
    }
    this.nextStreet();
    this.seekTurn(this.button);
  }
  nextStreet() {
    this.draw(); // burn
    if (this.phase === 'preflop') { this.board.push(this.draw(), this.draw(), this.draw()); this.phase = 'flop'; }
    else if (this.phase === 'flop') { this.board.push(this.draw()); this.phase = 'turn'; }
    else if (this.phase === 'turn') { this.board.push(this.draw()); this.phase = 'river'; }
    this.addLog(`${this.phase[0].toUpperCase() + this.phase.slice(1)}: ${this.board.map(cardText).join(' ')}.`);
  }

  // Each live hand's chance to win from here, in percent, and its outs: the cards of the next street that
  // would put a hand that is behind in front (or level). Only face up cards are used; folded cards and
  // the deck are never looked at. With two or fewer cards to come every case is counted; before the flop
  // 4,000 random boards are tried.
  chances(live) {
    const seen = new Set([...this.board, ...live.flatMap((i) => this.seats[i].cards)].map(cardText));
    const rest = [];
    for (const sName of SUITS) for (const r of RANKS) { const c = { r, s: sName }; if (!seen.has(cardText(c))) rest.push(c); }
    const need = 5 - this.board.length;
    const win = Object.fromEntries(live.map((i) => [i, 0]));
    let total = 0;
    const best = (board) => { const sc = live.map((i) => bestHand([...this.seats[i].cards, ...board]).score); const top = Math.max(...sc); return live.filter((_, k) => sc[k] === top); };
    const tally = (board) => { const w = best(board); for (const i of w) win[i] += 1 / w.length; total++; };
    if (need === 1) for (const a of rest) tally([...this.board, a]);
    else if (need === 2) { for (let x = 0; x < rest.length; x++) for (let y = x + 1; y < rest.length; y++) tally([...this.board, rest[x], rest[y]]); }
    else for (let n = 0; n < (PokerTable.samples || 4000); n++) {
      const pick = [];
      while (pick.length < need) { const k = Math.floor(Math.random() * rest.length); if (!pick.includes(k)) pick.push(k); }
      tally([...this.board, ...pick.map((k) => rest[k])]);
    }
    const pct = Object.fromEntries(live.map((i) => [i, Math.round((win[i] / total) * 1000) / 10]));
    const outs = {};
    if (this.board.length >= 3) {
      const ahead = best(this.board);
      for (const i of live) if (!ahead.includes(i)) outs[i] = rest.filter((c) => best([...this.board, c]).includes(i)).length;
    }
    return { n: this.board.length, pct, outs };
  }

  // ---- the end of a hand ----
  // Pots from what each player put in: one pot per all in level, open to the players who paid that level.
  pots() {
    const inn = this.seats.map((x, i) => (x && x.inHand ? { i, total: x.total, folded: x.folded } : null)).filter(Boolean);
    const levels = [...new Set(inn.filter((p) => !p.folded).map((p) => p.total))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const L of levels) {
      const amount = inn.reduce((a, p) => a + Math.max(0, Math.min(p.total, L) - prev), 0);
      const who = inn.filter((p) => !p.folded && p.total >= L).map((p) => p.i);
      if (amount > 0) pots.push({ amount, who });
      prev = L;
    }
    // Chips a folded player put in above every live level (cannot happen in normal play) join the last pot.
    const extra = inn.reduce((a, p) => a + Math.max(0, p.total - prev), 0);
    if (extra) { if (pots.length) pots[pots.length - 1].amount += extra; else pots.push({ amount: extra, who: inn.filter((p) => !p.folded).map((p) => p.i) }); }
    return pots;
  }
  finishHand() {
    this.refundUncalled();
    this.collect();
    this.turn = null;
    const live = this.liveSeats();
    const showdown = live.length > 1;
    const early = this.board.length < 5;
    const dealtIn = this.seats.map((x, i) => (x && x.inHand ? i : -1)).filter((i) => i >= 0);
    // Seats in dealing order from the left of the button: the first of them gets an odd chip.
    const order = [];
    for (let k = 1; k <= POKER_SEATS; k++) order.push((this.button + k) % POKER_SEATS);
    const wins = [];
    const pots = this.pots();
    const paid = pots.reduce((a, p) => a + p.amount, 0);
    if (paid !== this.pot) throw new Error(`Pot mismatch: ${paid} against ${this.pot}`);
    // The boards: one, or one per run when the all in is run more than once.
    const boards = [this.board];
    if (showdown && this.allInRun && this.runs > 1 && this.runBase) {
      for (let r = 1; r < this.runs; r++) { const b = [...this.runBase]; while (b.length < 5) b.push(this.draw()); boards.push(b); }
      this.boards = boards;
    }
    const R = boards.length;
    const hands = showdown ? boards.map((b) => Object.fromEntries(live.map((i) => [i, bestHand([...this.seats[i].cards, ...b])]))) : null;
    if (showdown) {
      for (const i of live) { const x = this.seats[i]; x.hand = hands[0][i]; x.show = true; }
      boards.forEach((b, r) => {
        this.addLog(`Showdown${R > 1 ? `, run ${r + 1} of ${R}` : ''}. Board: ${b.map(cardText).join(' ')}.`);
        for (const i of order) if (live.includes(i)) this.addLog(`${this.name(i)} ${r ? 'has' : 'shows'} ${this.seats[i].cards.map(cardText).join(' ')}: ${hands[r][i].name}.`);
      });
    }
    pots.forEach((pot, n) => {
      for (let r = 0; r < R; r++) {
        // Each run plays for an equal part of the pot; chips that do not divide go to the earlier runs.
        const amount = Math.floor(pot.amount / R) + (r < pot.amount % R ? 1 : 0);
        if (!amount) continue;
        let winners;
        if (pot.who.length === 1 || !showdown) winners = pot.who.length ? pot.who : live;
        else { const best = Math.max(...pot.who.map((i) => hands[r][i].score)); winners = pot.who.filter((i) => hands[r][i].score === best); }
        const share = Math.floor(amount / winners.length);
        let odd = amount - share * winners.length;
        for (const i of order) {
          if (!winners.includes(i)) continue;
          const get = share + (odd > 0 ? 1 : 0);
          if (odd > 0) odd--;
          this.seats[i].stack += get; this.seats[i].won = (this.seats[i].won || 0) + get;
          const hn = showdown ? hands[r][i].name : null;
          wins.push({ seat: i, amount: get, pot: n, run: r, hand: hn });
          this.addLog(`${this.name(i)} wins ${get}${R > 1 ? ` on run ${r + 1}` : ''}${pots.length > 1 ? (n ? ` from side pot ${n}` : ' from the main pot') : ''}${hn ? ` with ${hn}` : ''}.`);
        }
      }
    });
    this.pot = 0;
    // 7-2 bounty: a winner holding seven-two collects from everyone who was dealt in.
    const bounty = [];
    if (this.settings.sevenDeuce > 0) {
      const winners = [...new Set(wins.map((w) => w.seat))];
      for (const w of winners) {
        const v = this.seats[w].cards.map(rankVal).sort((a, b) => a - b);
        if (v[0] !== 2 || v[1] !== 7) continue;
        this.seats[w].show = true;
        let got = 0;
        for (const i of dealtIn) { if (i === w) continue; const pay = Math.min(this.seats[i].stack, this.settings.sevenDeuce); this.seats[i].stack -= pay; this.seats[w].stack += pay; got += pay; }
        bounty.push({ seat: w, amount: got });
        this.addLog(`${this.name(w)} won with seven-two and collects a bounty of ${got}.`);
      }
    }
    this.result = { wins, showdown, bounty, early, board: [...this.board], runout: this.allInRun && this.runout?.length ? this.runout : null, boards: R > 1 ? boards : null,
      bests: showdown ? boards.map((_, r) => Object.fromEntries(live.map((i) => [i, { name: hands[r][i].name, cards: hands[r][i].cards }]))) : null };
    this.phase = 'done';
    // The record of the hand, with the seed that anyone can check.
    const rec = { ...this.cur, dealt: [...this.dealt], board: [...this.board], boards: R > 1 ? boards : undefined, button: this.button, wins, bounty,
      seats: dealtIn.map((i) => ({ seat: i, id: this.seats[i].id, name: this.name(i), cards: this.seats[i].show ? this.seats[i].cards : null, folded: this.seats[i].folded, total: this.seats[i].total, won: this.seats[i].won || 0, end: this.seats[i].stack })) };
    this.fair.last = { hand: rec.hand, commit: rec.commit, serverSeed: rec.serverSeed, clientSeeds: rec.clientSeeds, dealt: rec.dealt }; // host side only
    this.hist.push(rec); if (this.hist.length > 100) this.hist.shift();
    this.cur = null;
    // Chips bought during the hand arrive now; seats that asked to leave are freed; broke players sit out.
    for (let i = 0; i < POKER_SEATS; i++) {
      const x = this.seats[i];
      if (!x) continue;
      const add = this.pending[x.id];
      if (add) { x.stack += add; this.players[x.id].totalIn += add; delete this.pending[x.id]; this.addLog(`${this.name(i)} added ${add}.`); }
      if (x.leaving) { this.players[x.id].totalIn -= x.stack; this.addLog(`${this.name(i)} left the seat with ${x.stack}.`); this.seats[i] = null; }
    }
  }
  // Show your own cards after the hand (a bluff shown, or a fold you want seen).
  showCards(id) {
    const i = this.seatOf(id);
    if (i < 0 || this.phase !== 'done' || !this.seats[i].inHand || this.seats[i].show) return;
    this.seats[i].show = true;
    const rec = this.hist[this.hist.length - 1], mine = rec && rec.hand === this.handNo && rec.seats.find((x) => x.seat === i);
    if (mine) mine.cards = this.seats[i].cards;
    this.addLog(`${this.name(i)} shows ${this.seats[i].cards.map(cardText).join(' ')}.`);
  }
  // The whole table as plain data (the host's browser keeps it, so a reload carries on), and back again.
  static restore(j) { const t = new PokerTable(); Object.assign(t, j); return t; }
  // Rabbit hunt: the cards that would have come, when the hand ended before the river. One look per hand, shown to all.
  rabbitHunt(id) {
    if (!this.settings.rabbitHunt) throw new Error('Rabbit hunting is off at this table.');
    if (this.phase !== 'done' || !this.result?.early || this.rabbit) return;
    const i = this.seatOf(id);
    if (i < 0 || !this.seats[i].inHand) throw new Error('Only players dealt into the hand can look.');
    const deck = [...this.deck], out = [];
    let n = this.board.length;
    while (n < 5) { deck.shift(); const take = n === 0 ? 3 : 1; for (let k = 0; k < take; k++) out.push(deck.shift()); n += take; }
    this.rabbit = out;
    this.addLog(`${this.name(i)} looked at what would have come: ${out.map(cardText).join(' ')}.`);
  }
  // The host asks for a bomb pot on the next hand.
  setBombNext(on) { this.bombNext = !!on; }
  setRuns(id, n) { const i = this.seatOf(id); if (i >= 0) this.seats[i].runs = clampInt(n, 1, 10, 2); }
  setStraddle(id, on) { const i = this.seatOf(id); if (i >= 0) this.seats[i].straddle = !!on; }

  // ---- what each player is told ----
  publicState(forId) {
    const done = this.phase === 'done';
    const me = this.seatOf(forId);
    return {
      game: 'poker', settings: this.settings, phase: this.phase, handNo: this.handNo, button: this.button, board: this.board, bomb: !!this.bomb,
      pot: this.pot, potTotal: this.potTotal(), pots: this.inHand() || done ? this.potsNow() : [], currentBet: this.currentBet, turn: this.turn,
      turnLeft: this.turn !== null && this.settings.turnTimer ? Math.max(0, this.settings.turnTimer * 1000 - (Date.now() - (this.turnStarted || Date.now()))) : null,
      hostId: this.hostId, awayVotes: this.awayVotes || {}, canStart: this.canStart(), bombNext: this.bombNext, result: this.result, rabbit: this.rabbit, allInRun: !!this.allInRun && !done ? true : undefined,
      seats: this.seats.map((x, i) => x && {
        id: x.id, name: this.players[x.id]?.name, look: this.players[x.id]?.look, connected: this.players[x.id]?.connected !== false,
        stack: x.stack, bet: x.bet, total: x.total, bank: x.bank || 0, runs: x.runs || 2, shown: !!x.show, folded: x.folded, allIn: x.allIn, inHand: x.inHand, out: x.out, won: done ? x.won || 0 : 0, straddle: !!x.straddle,
        cards: x.inHand ? (i === me || x.show ? x.cards : x.cards.map(() => null)) : [],
        hand: x.show && x.hand ? x.hand.name : i === me && x.inHand && !x.folded && this.board.length >= 3 ? bestHand([...x.cards, ...this.board]).name : null,
        best: done && x.show && x.hand ? x.hand.cards : null,
      }),
      players: Object.values(this.players).filter((p) => !p.kicked).map((p) => ({ id: p.id, name: p.name, connected: p.connected, seat: this.seatOf(p.id) })),
      ledger: Object.values(this.players).map((p) => { const i = this.seatOf(p.id); const stack = i >= 0 ? this.seats[i].stack + this.seats[i].bet + (this.inHand() ? this.seats[i].total - this.seats[i].bet : 0) : 0; return { id: p.id, name: p.name, totalIn: p.totalIn, stack, net: stack - p.totalIn }; }),
      options: this.options(forId),
      fair: this.fairState(forId),
      lastHand: this.publicHand(this.hist[this.hist.length - 1]),
      log: this.log.slice(-40),
    };
  }
  // A finished hand as everyone may keep it: no seeds, no deck, and only the cards that were shown.
  publicHand(h) {
    if (!h) return null;
    const { serverSeed, clientSeeds, dealt, ...rest } = h;
    void serverSeed; void clientSeeds; void dealt;
    return rest;
  }
  // The promise for the coming hand, the promises of past hands, and the seeds of hands old enough to open.
  // Opening a seed shows every card of that hand, folded ones too, so seeds stay shut for 20 hands
  // unless the host opens them all (at the end of a session).
  fairState(forId) {
    const open = (h) => this.revealAll || h.hand <= this.handNo - 20;
    return {
      nextCommit: this.fair.next.commit, mySeed: !!this.fair.seeds[forId], seeds: Object.keys(this.fair.seeds).filter((id) => id !== this.hostId).length,
      hands: this.hist.slice(-40).map((h) => ({ hand: h.hand, commit: h.commit, board: h.board, button: h.button, seats: h.seats.map((x) => ({ seat: x.seat, name: x.name, cards: x.cards })),
        ...(open(h) ? { serverSeed: h.serverSeed, clientSeeds: h.clientSeeds } : {}) })),
    };
  }
  // The pots as they stand now, for the display: money already collected, split by all in levels.
  potsNow() {
    const saveBets = this.seats.map((x) => (x ? x.bet : 0));
    // Only chips of finished betting rounds count; the bets of the round in play are still in front of the players.
    const inn = this.seats.map((x, i) => (x && x.inHand ? { i, total: x.total - saveBets[i], folded: x.folded } : null)).filter(Boolean);
    const levels = [...new Set(inn.filter((p) => !p.folded).map((p) => p.total))].sort((a, b) => a - b);
    const out = [];
    let prev = 0;
    for (const L of levels) { const amount = inn.reduce((a, p) => a + Math.max(0, Math.min(p.total, L) - prev), 0); if (amount > 0) out.push({ amount, who: inn.filter((p) => !p.folded && p.total >= L).map((p) => p.i) }); prev = L; }
    const extra = inn.reduce((a, p) => a + Math.max(0, p.total - prev), 0);
    if (extra) { if (out.length) out[out.length - 1].amount += extra; else out.push({ amount: extra, who: [] }); }
    return out;
  }
}
export { SUITS, RANKS };
