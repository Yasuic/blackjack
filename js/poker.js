// No-limit Texas Hold'em for up to 9 players. Pure rules: the host's browser owns one PokerTable and
// every action goes through it. Nothing here touches the page or the network.
import { SUITS, RANKS, sha256, fairSeed, fairShoe, MAX_CHIPS } from './game.js?v=20261121za';

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
  game: 'nlh',        // nlh = no limit Texas Hold'em (2 cards), plo = pot limit Omaha (4 cards, a hand uses exactly 2 of them with 3 from the board)
  doubleBoard: false, // two boards are dealt and each plays for half the pot
  bombGame: 'same',   // the game of a bomb pot: same as the table, nlh or plo
  bombBoards: 0,      // boards in a bomb pot: 0 = same as the table, 1 or 2
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
// Omaha: the best five made of exactly two of the player's cards and exactly three from the board.
export function bestOmaha(hole, board) {
  if (hole.length < 2 || board.length < 3) return null;
  let best = null;
  for (let a = 0; a < hole.length; a++) for (let b = a + 1; b < hole.length; b++)
    for (let x = 0; x < board.length; x++) for (let y = x + 1; y < board.length; y++) for (let z = y + 1; z < board.length; z++) {
      const five = [hole[a], hole[b], board[x], board[y], board[z]], sc = score5(five);
      if (!best || sc > best.score) best = { score: sc, cards: five };
    }
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
    s.game = s.game === 'plo' ? 'plo' : 'nlh';
    s.doubleBoard = !!s.doubleBoard;
    s.bombGame = ['same', 'nlh', 'plo'].includes(s.bombGame) ? s.bombGame : 'same';
    s.bombBoards = [0, 1, 2].includes(Number(s.bombBoards)) ? Number(s.bombBoards) : 0;
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
  // Move to an empty seat between hands. The chips, the stats and the away mark go along; the button stays where it is.
  moveSeat(id, seatIdx) {
    const from = this.seatOf(id);
    if (from < 0) throw new Error('Take a seat first.');
    if (this.inHand()) throw new Error('You can move between hands, before the deal.');
    if (!Number.isInteger(seatIdx) || seatIdx < 0 || seatIdx >= POKER_SEATS) throw new Error('No such seat.');
    if (this.seats[seatIdx]) throw new Error('That seat is taken.');
    this.seats[seatIdx] = this.seats[from]; this.seats[from] = null;
    // The last hand's result still names seats: keep it pointing at this player.
    for (const w of [...(this.result?.wins || []), ...(this.result?.bounty || [])]) if (w.seat === from) w.seat = seatIdx;
    this.addLog(`${this.name(seatIdx)} moved from seat ${from + 1} to seat ${seatIdx + 1}.`);
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

  // Collects the cards of a finished hand and goes back to waiting. Used when too few players can play the next hand.
  clearHand() {
    if (this.phase !== 'done') return false;
    for (const x of this.seats) if (x) Object.assign(x, { bet: 0, total: 0, cards: [], folded: false, allIn: false, acted: false, inHand: false, show: false, mask: null, cc: null, salt: null, won: 0, hand: null, allInAt: 0 });
    this.board = []; this.board2 = []; this.rabbit = null; this.rabbit2 = null; this.pot = 0; this.result = null; this.allInRun = false; this.runAsk = null; this.runout = null; this.runs = 1; this.runBase = null; this.boards = null; this.turn = null; this.bomb = false;
    this.phase = 'waiting';
    return true;
  }

  startHand() {
    if (!this.canStart()) throw new Error('Two players with chips are needed.');
    // Leftovers of the hand before.
    for (let i = 0; i < POKER_SEATS; i++) { const x = this.seats[i]; if (x) Object.assign(x, { bet: 0, total: 0, cards: [], folded: false, allIn: false, acted: false, inHand: false, show: false, mask: null, cc: null, salt: null, vp: false, pf: false, redrawn: false, won: 0, hand: null }); }
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
    const game = bomb && s.bombGame !== 'same' ? s.bombGame : s.game;
    this.plo = game === 'plo';
    this.dbl = bomb && s.bombBoards ? s.bombBoards === 2 : s.doubleBoard;
    this.cur.plo = this.plo; this.cur.dbl = this.dbl;
    this.board = []; this.board2 = []; this.rabbit2 = null; this.pot = 0; this.result = null; this.rabbit = null; this.bomb = bomb; this.allInRun = false; this.runAsk = null; this.allInSeq = 0; for (const q of this.seats) if (q) q.allInAt = 0; this.runout = null; this.runs = 1; this.runBase = null; this.boards = null;
    for (const i of inIdx) { const x = this.seats[i]; x.inHand = true; x.bank = Math.min(this.settings.timeBank, (x.bank ?? this.settings.timeBank) + (this.handNo > 1 ? 10 : 0)); }
    this.addLog(`Hand ${this.handNo}${bomb ? ' (bomb pot)' : ''}${this.plo ? ', pot limit Omaha' : ''}${this.dbl ? ', two boards' : ''}. ${this.name(this.button)} has the button.`);
    const post = (i, amount, what) => {
      const x = this.seats[i], pay = Math.min(x.stack, amount);
      x.stack -= pay; x.bet += pay; x.total += pay;
      if (x.stack === 0) { x.allIn = true; x.allInAt ||= ++this.allInSeq; }
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
  get holeN() { return this.plo ? 4 : 2; }
  // The best hand of a player's cards on a board, by the rules of the game in play.
  best(cards, board) { return this.plo ? bestOmaha(cards, board) : bestHand([...cards, ...board]); }
  prevSeat(i) { return (i + POKER_SEATS - 1) % POKER_SEATS; }
  dealHole(inIdx) {
    // One card at a time, starting left of the button, twice round.
    const order = [];
    let j = this.button;
    for (let k = 0; k < inIdx.length; k++) { j = this.nextFrom(j, (q) => inIdx.includes(q)); order.push(j); }
    for (let r = 0; r < this.holeN; r++) for (const i of order) this.seats[i].cards.push(this.draw());
    // A sealed note of each player's cards, open to all. If the table moves to another browser mid hand,
    // each player hands in their cards with the secret word and the new host checks them against the note.
    for (const i of order) { const x = this.seats[i]; x.salt = randomSeed(); x.cc = sha256(x.cards.map(cardText).join('') + x.salt); }
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
    // Pot limit: the largest raise is the size of the pot after calling.
    const cap = this.plo ? Math.min(max, Math.max(minTo, this.currentBet + this.potTotal() + (this.currentBet - x.bet))) : max;
    return { toCall, canCheck: x.bet >= this.currentBet, canRaise: mayRaise, minTo: mayRaise ? minTo : null, maxTo: mayRaise ? cap : null, allIn: cap === max, potLimit: !!this.plo, isBet: this.currentBet === 0, pot: this.potTotal() };
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
      if (x.stack === 0) { x.allIn = true; x.allInAt ||= ++this.allInSeq; }
      if (this.phase === 'preflop' && !this.bomb) x.vp = true;
      this.addLog(`${nm} calls ${pay}${x.allIn ? ' and is all in' : ''}.`);
    } else if (type === 'raise' || type === 'bet') {
      if (!o.canRaise) throw new Error('You cannot raise now.');
      const to = Math.round(Number(amount));
      if (!Number.isFinite(to) || to > o.maxTo) throw new Error(o.allIn ? 'You do not have that many chips.' : `Pot limit: the largest raise now is to ${o.maxTo}.`);
      if (to < o.minTo) throw new Error(`The smallest ${o.isBet ? 'bet' : 'raise'} is to ${o.minTo}.`);
      const pay = to - x.bet, by = to - this.currentBet;
      x.stack -= pay; x.bet = to; x.total += pay; x.acted = true;
      if (x.stack === 0) { x.allIn = true; x.allInAt ||= ++this.allInSeq; }
      if (by >= this.minRaise) {
        // A full bet or raise: everyone else may act again.
        this.minRaise = by;
        for (const q of this.liveSeats()) if (q !== i) this.seats[q].acted = false;
      }
      if (this.phase === 'preflop' && !this.bomb) { x.vp = true; x.pf = true; }
      if (this.phase !== 'preflop') x.agg = true;
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
        for (const i of live) if (this.seats[i].cards.length !== this.holeN) this.redraw(i); // only after a table move
        this.allInRun = true; this.runout = [];
        for (const i of live) this.seats[i].show = true;
        // Run it more than once: as many runs as the table asks for and the deck has cards for.
        // The first run burns a card before each street as usual; later runs deal straight from the deck.
        const need = 5 - this.board.length, first = need + (need === 5 ? 3 : need === 2 ? 2 : 1);
        this.runBase = [...this.board];
        // Each player picks how many times they like to run it (1 to 10); the lowest pick among the players in the hand counts.
        const most = this.dbl ? 1 : 1 + Math.max(0, Math.min(this.settings.runTimes - 1, Math.floor((this.deck.length - first) / need)));
        if (PokerTable.autoRun) { // tests: each seat's stored pick, the lowest counts
          this.runs = Math.min(most, ...live.map((i) => this.seats[i].runs || 2));
        } else if (most > 1) {
          // Run it once, twice or three times is a question. The player who went all in first picks; with more
          // than once, every other player in the hand must agree, otherwise the board is dealt once.
          const by = [...live].filter((i) => this.seats[i].allIn).sort((a, b) => (this.seats[a].allInAt || 1e9) - (this.seats[b].allInAt || 1e9))[0] ?? live[0];
          this.runs = 1;
          this.runAsk = { by, max: Math.min(3, most), n: 0, yes: [], need: live.filter((i) => i !== by), at: Date.now() };
          this.turn = null;
          return; // the hand waits for the answer: runPick, runAnswer or runTimeout
        } else this.runs = 1;
      }
      this.runGo();
      return;
    }
    this.nextStreet();
    this.seekTurn(this.button);
  }
  // Deals the rest of the board once the number of runs is settled.
  runGo() {
    const live = this.liveSeats();
    if (!PokerTable.noChances) this.runout.push(this.chances(live));
    this.nextStreet();
    this.endStreet();
  }
  runSettle(n, why) {
    const a = this.runAsk;
    if (!a || a.done) return;
    a.done = true; this.runs = n;
    this.addLog(why);
    this.runGo();
  }
  // The first all in player says how many times to deal the rest of the board.
  runPick(id, n) {
    const a = this.runAsk, i = this.seatOf(id);
    if (!a || a.done || a.n || i !== a.by) throw new Error('It is not your choice.');
    n = clampInt(n, 1, a.max, 1);
    if (n === 1) { this.runSettle(1, `${this.name(i)} runs it once.`); return; }
    a.n = n; a.at = Date.now();
    this.addLog(`${this.name(i)} asks to run it ${n} times.`);
  }
  // Every other player in the hand agrees or says no. One no means the board is dealt once.
  runAnswer(id, yes) {
    const a = this.runAsk, i = this.seatOf(id);
    if (!a || a.done || !a.n || !a.need.includes(i) || a.yes.includes(i)) throw new Error('There is nothing to answer.');
    if (!yes) { this.runSettle(1, `${this.name(i)} says no. The board is dealt once.`); return; }
    a.yes.push(i);
    if (a.need.every((q) => a.yes.includes(q))) this.runSettle(a.n, `Everyone agrees: the board is dealt ${a.n} times.`);
  }
  // Nobody answered in time: the board is dealt once.
  runTimeout() { this.runSettle(1, 'No answer in time. The board is dealt once.'); }
  nextStreet() {
    this.draw(); // burn
    // With two boards the first board gets its cards, then the second.
    const give = (n) => { for (let k = 0; k < n; k++) this.board.push(this.draw()); if (this.dbl) for (let k = 0; k < n; k++) this.board2.push(this.draw()); };
    if (this.phase === 'preflop') { give(3); this.phase = 'flop'; }
    else if (this.phase === 'flop') { give(1); this.phase = 'turn'; }
    else if (this.phase === 'turn') { give(1); this.phase = 'river'; }
    this.addLog(`${this.phase[0].toUpperCase() + this.phase.slice(1)}: ${this.board.map(cardText).join(' ')}${this.dbl ? ' | second board: ' + this.board2.map(cardText).join(' ') : ''}.`);
  }

  // Each live hand's chance to win from here, in percent, and its outs: the cards of the next street that
  // would put a hand that is behind in front (or level). Only face up cards are used; folded cards and
  // the deck are never looked at. With two or fewer cards to come every case is counted; before the flop
  // 4,000 random boards are tried.
  chances(live) {
    const boards = this.dbl ? [this.board, this.board2] : [this.board];
    const seen = new Set([...boards.flat(), ...live.flatMap((i) => this.seats[i].cards)].map(cardText));
    const rest = [];
    for (const sName of SUITS) for (const r of RANKS) { const c = { r, s: sName }; if (!seen.has(cardText(c))) rest.push(c); }
    const need = 5 - this.board.length;
    const win = Object.fromEntries(live.map((i) => [i, 0]));
    const bestOn = (board) => { const sc = live.map((i) => this.best(this.seats[i].cards, board).score); const top = Math.max(...sc); return live.filter((_, k) => sc[k] === top); };
    // Each board plays for an equal part of the pot, so a hand's chance is the average over the boards.
    for (const base of boards) {
      let total = 0;
      const part = Object.fromEntries(live.map((i) => [i, 0]));
      const tally = (board) => { const w = bestOn(board); for (const i of w) part[i] += 1 / w.length; total++; };
      if (need === 1) for (const a of rest) tally([...base, a]);
      else if (need === 2) { for (let x = 0; x < rest.length; x++) for (let y = x + 1; y < rest.length; y++) tally([...base, rest[x], rest[y]]); }
      else for (let n = 0, N = (PokerTable.samples || (this.plo ? 1000 : 4000)) / boards.length; n < N; n++) {
        const pick = [];
        while (pick.length < need) { const k = Math.floor(Math.random() * rest.length); if (!pick.includes(k)) pick.push(k); }
        tally([...base, ...pick.map((k) => rest[k])]);
      }
      for (const i of live) win[i] += part[i] / total / boards.length;
    }
    const pct = Object.fromEntries(live.map((i) => [i, Math.round(win[i] * 1000) / 10]));
    const outs = {};
    if (this.board.length >= 3 && !this.dbl) {
      const ahead = bestOn(this.board);
      for (const i of live) if (!ahead.includes(i)) outs[i] = rest.filter((c) => bestOn([...this.board, c]).includes(i)).length;
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
    if (showdown) for (const i of live) if (this.seats[i].cards.length !== this.holeN) this.redraw(i); // only after a table move
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
    const boards = this.dbl && showdown ? [this.board, this.board2] : [this.board];
    if (!this.dbl && showdown && this.allInRun && this.runs > 1 && this.runBase) {
      for (let r = 1; r < this.runs; r++) { const b = [...this.runBase]; while (b.length < 5) b.push(this.draw()); boards.push(b); }
      this.boards = boards;
    }
    const R = boards.length;
    const hands = showdown ? boards.map((b) => Object.fromEntries(live.map((i) => [i, this.best(this.seats[i].cards, b)]))) : null;
    const runWord = this.dbl ? 'board' : 'run';
    if (showdown) {
      for (const i of live) { const x = this.seats[i]; x.hand = hands[0][i]; x.show = true; }
      boards.forEach((b, r) => {
        this.addLog(`Showdown${R > 1 ? `, ${runWord} ${r + 1} of ${R}` : ''}. Board: ${b.map(cardText).join(' ')}.`);
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
          this.addLog(`${this.name(i)} wins ${get}${R > 1 ? ` on ${runWord} ${r + 1}` : ''}${pots.length > 1 ? (n ? ` from side pot ${n}` : ' from the main pot') : ''}${hn ? ` with ${hn}` : ''}.`);
        }
      }
    });
    // Each player's numbers: hands dealt, hands with chips put in by choice before the flop (VPIP), hands raised
    // before the flop (PFR), showdowns reached and showdowns won. Bomb pots have no betting before the flop and are left out of VPIP and PFR.
    const wonSeats = new Set(wins.map((w) => w.seat));
    for (const i of dealtIn) {
      const x = this.seats[i], p = this.players[x.id];
      if (!p) continue;
      const t = (p.stats ||= { hands: 0, pre: 0, vpip: 0, pfr: 0, sd: 0, wsd: 0, won: 0 });
      t.hands++; if (!this.bomb) { t.pre++; if (x.vp) t.vpip++; if (x.pf) t.pfr++; }
      if (showdown && live.includes(i)) { t.sd++; if (wonSeats.has(i)) t.wsd++; }
      if (wonSeats.has(i)) t.won++;
    }
    this.pot = 0;
    // 7-2 bounty: a winner holding seven-two collects from everyone who was dealt in.
    const bounty = [];
    if (this.settings.sevenDeuce > 0 && !this.plo) {
      const winners = [...new Set(wins.map((w) => w.seat))];
      for (const w of winners) {
        const v = this.seats[w].cards.map(rankVal).sort((a, b) => a - b);
        if (v.length !== 2 || v[0] !== 2 || v[1] !== 7) continue;
        this.seats[w].show = true;
        let got = 0;
        for (const i of dealtIn) { if (i === w) continue; const pay = Math.min(this.seats[i].stack, this.settings.sevenDeuce); this.seats[i].stack -= pay; this.seats[w].stack += pay; got += pay; }
        bounty.push({ seat: w, amount: got });
        this.addLog(`${this.name(w)} won with seven-two and collects a bounty of ${got}.`);
      }
    }
    this.result = { wins, showdown, bounty, early, board: [...this.board], runout: this.allInRun && this.runout?.length ? this.runout : null, boards: R > 1 ? boards : null, dbl: !!this.dbl,
      bests: showdown ? boards.map((_, r) => Object.fromEntries(live.map((i) => [i, { name: hands[r][i].name, cards: hands[r][i].cards }]))) : null };
    this.phase = 'done';
    // The record of the hand, with the seed that anyone can check.
    const rec = { ...this.cur, dealt: [...this.dealt], board: [...this.board], board2: this.dbl ? [...this.board2] : undefined, boards: R > 1 ? boards : undefined, button: this.button, wins, bounty,
      seats: dealtIn.map((i) => ({ seat: i, id: this.seats[i].id, name: this.name(i), cards: this.shownCards(i), folded: this.seats[i].folded, total: this.seats[i].total, won: this.seats[i].won || 0, end: this.seats[i].stack })) };
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
  // which: 0 or 1 for one card, anything else for both. A card once shown stays shown.
  showCards(id, which) {
    const i = this.seatOf(id);
    if (i < 0 || this.phase !== 'done') return;
    const x = this.seats[i];
    if (!x.inHand || x.show || x.cards.length !== this.holeN) return;
    const one = Number.isInteger(which) && which >= 0 && which < x.cards.length;
    if (one) {
      const m = x.mask || x.cards.map(() => false);
      if (m[which]) return;
      m[which] = true; x.mask = m;
      if (m.every(Boolean)) x.show = true;
      this.addLog(`${this.name(i)} shows one card: ${cardText(x.cards[which])}.`);
    } else {
      x.show = true;
      this.addLog(`${this.name(i)} shows ${x.cards.map(cardText).join(' ')}.`);
    }
    const rec = this.hist[this.hist.length - 1], mine = rec && rec.hand === this.handNo && rec.seats.find((q) => q.seat === i);
    if (mine) mine.cards = this.shownCards(i);
  }
  // The cards of a seat that everyone may see: both, one (the other is null), or none (null).
  shownCards(i) {
    const x = this.seats[i];
    if (x.show && x.cards.length) return x.cards;
    if (x.mask && x.cards.length && x.mask.some(Boolean)) return x.cards.map((c, k) => (x.mask[k] ? c : null));
    return null;
  }
  // ---- the table moves to another browser ----
  // When the host's browser is gone, a player's browser takes the table over from what every player is told
  // anyway: seats, stacks, bets, the board. The hand in play goes on. The new host knows its own two cards;
  // every other player hands in theirs with the secret word (giveCards). The cards still to come are drawn
  // from a fresh shuffle of the cards nobody has been shown, which is the same chance as the old deck.
  static fromPublic(st, myId, mine) {
    const t = new PokerTable(st.settings);
    Object.assign(t, { hostId: myId, button: st.button, handNo: st.handNo, phase: st.phase, board: [...st.board], pot: st.pot, currentBet: st.currentBet,
      minRaise: st.minRaise ?? st.settings.bigBlind, turn: st.turn, bomb: !!st.bomb, plo: !!st.plo, dbl: !!st.dbl, board2: [...(st.board2 || [])], rabbit2: st.rabbit2 || null, bombNext: !!st.bombNext, result: st.result, rabbit: st.rabbit,
      awayVotes: st.awayVotes || {}, pending: { ...(st.pending || {}) }, log: [...(st.log || [])], hist: st.lastHand ? [st.lastHand] : [], moved: (st.moved || 0) + 1 });
    for (const r of st.ledger || []) t.players[r.id] = { id: r.id, name: r.name, connected: r.id === myId, totalIn: r.totalIn, look: { skin: 2, hair: 0 }, stats: r.stats || undefined };
    st.seats.forEach((x, i) => {
      if (!x) return;
      if (t.players[x.id] && x.look) t.players[x.id].look = x.look;
      t.seats[i] = { id: x.id, stack: x.stack, bet: x.bet, total: x.total, cards: [], folded: x.folded, allIn: x.allIn, acted: !!x.acted, inHand: x.inHand, out: x.out,
        show: false, mask: null, bank: x.bank || 0, runs: x.runs || 2, straddle: !!x.straddle, leaving: !!x.leaving, cc: x.cc || null, salt: null, vp: !!x.vp, pf: !!x.pf, won: x.won || 0 };
      const known = x.id === myId && mine ? mine.cards : x.cards && x.cards.length >= 2 && x.cards.every(Boolean) ? x.cards : null;
      if (x.inHand && known) { t.seats[i].cards = known.map((c) => ({ r: c.r, s: c.s })); if (x.shown) t.seats[i].show = true; }
      if (x.id === myId && mine) t.seats[i].salt = mine.salt;
    });
    if (t.inHand()) {
      t.cur = { hand: t.handNo, commit: null, serverSeed: null, clientSeeds: {}, lines: [], bomb: t.bomb, plo: t.plo, dbl: t.dbl, time: Date.now(), moved: true };
      t.turnStarted = Date.now();
      t.reshuffleRest();
    }
    return t;
  }
  // The deck after a move: every card that is not on the board and not in a hand this browser knows, shuffled fresh.
  reshuffleRest() {
    const seen = new Set([...this.board, ...(this.board2 || []), ...this.seats.flatMap((x) => (x && x.inHand ? x.cards : []))].map(cardText));
    this.deck = pokerDeck(randomSeed(), { move: randomSeed() }).filter((c) => !seen.has(cardText(c)));
    this.dealt = [];
  }
  // Seats still in the hand whose cards this browser has not been given yet.
  missingCards() { return this.inHand() ? this.liveSeats().filter((i) => this.seats[i].cards.length !== this.holeN) : []; }
  // A player hands in their two cards after a move. They count only when they fit the sealed note made at the deal.
  giveCards(id, cards, salt) {
    const i = this.seatOf(id);
    if (i < 0) return false;
    const x = this.seats[i];
    if (!x.inHand || x.cards.length === this.holeN || !x.cc || !Array.isArray(cards) || cards.length !== this.holeN) return false;
    const cs = cards.map((c) => ({ r: String(c?.r), s: String(c?.s) }));
    if (sha256(cs.map(cardText).join('') + String(salt)) !== x.cc) return false;
    const txt = cs.map(cardText);
    if ([...this.board, ...(this.board2 || []), ...(this.rabbit || []), ...(this.rabbit2 || []), ...(this.moved ? this.dealt : [])].some((c) => txt.includes(cardText(c)))) return false; // came out after the move while this player was folded and away
    x.cards = cs; x.salt = String(salt);
    this.deck = this.deck.filter((c) => !txt.includes(cardText(c)));
    return true;
  }
  // A player still in the hand who never came back after a move gets two cards from the unseen cards, so the hand can end.
  redraw(i) {
    const x = this.seats[i];
    if (!x || !x.inHand || x.cards.length === this.holeN) return;
    x.cards = Array.from({ length: this.holeN }, () => this.draw()); x.redrawn = true; x.cc = null;
    this.addLog(`${this.name(i)} did not come back after the table moved, so the seat got new cards from the cards nobody had seen.`);
  }
  // The whole table as plain data (the host's browser keeps it, so a reload carries on), and back again.
  static restore(j) { const t = new PokerTable(); Object.assign(t, j); return t; }
  // Rabbit hunt: the cards that would have come, when the hand ended before the river. One look per hand, shown to all.
  rabbitHunt(id) {
    if (!this.settings.rabbitHunt) throw new Error('Rabbit hunting is off at this table.');
    if (this.phase !== 'done' || !this.result?.early || this.rabbit) return;
    const i = this.seatOf(id);
    if (i < 0 || !this.seats[i].inHand) throw new Error('Only players dealt into the hand can look.');
    const deck = [...this.deck], out = [], out2 = [];
    let n = this.board.length;
    while (n < 5) { deck.shift(); const take = n === 0 ? 3 : 1; for (let k = 0; k < take; k++) out.push(deck.shift()); if (this.dbl) for (let k = 0; k < take; k++) out2.push(deck.shift()); n += take; }
    this.rabbit = out; this.rabbit2 = this.dbl ? out2 : null;
    this.addLog(`${this.name(i)} looked at what would have come: ${out.map(cardText).join(' ')}${this.dbl ? ' | second board: ' + out2.map(cardText).join(' ') : ''}.`);
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
      game: 'poker', settings: this.settings, phase: this.phase, handNo: this.handNo, button: this.button, board: this.board, board2: this.dbl ? this.board2 || [] : null, plo: !!this.plo, dbl: !!this.dbl, rabbit2: this.rabbit2 || null, bomb: !!this.bomb,
      pot: this.pot, minRaise: this.minRaise, pending: this.pending, moved: this.moved || 0, mySalt: me >= 0 ? this.seats[me].salt || null : null, wait: this.waitCards ? this.missingCards().map((i) => this.name(i)) : undefined, potTotal: this.potTotal(), pots: this.inHand() || done ? this.potsNow() : [], currentBet: this.currentBet, turn: this.turn,
      turnLeft: this.turn !== null && this.settings.turnTimer ? Math.max(0, this.settings.turnTimer * 1000 - (Date.now() - (this.turnStarted || Date.now()))) : null,
      hostId: this.hostId, awayVotes: this.awayVotes || {}, canStart: this.canStart(), bombNext: this.bombNext, result: this.result, rabbit: this.rabbit, allInRun: !!this.allInRun && !done ? true : undefined,
      runAsk: this.runAsk && !this.runAsk.done ? { by: this.runAsk.by, max: this.runAsk.max, n: this.runAsk.n, yes: this.runAsk.yes, need: this.runAsk.need, left: Math.max(0, 20000 - (Date.now() - this.runAsk.at)) } : undefined,
      seats: this.seats.map((x, i) => x && {
        id: x.id, name: this.players[x.id]?.name, look: this.players[x.id]?.look, connected: this.players[x.id]?.connected !== false,
        stack: x.stack, bet: x.bet, total: x.total, bank: x.bank || 0, runs: x.runs || 2, shown: !!x.show, mask: x.mask || null, acted: !!x.acted, leaving: !!x.leaving, cc: x.cc || null, vp: !!x.vp, pf: !!x.pf, stats: this.players[x.id]?.stats || null, folded: x.folded, allIn: x.allIn, inHand: x.inHand, out: x.out, won: done ? x.won || 0 : 0, straddle: !!x.straddle,
        cards: x.inHand ? (x.cards.length === this.holeN ? x.cards : Array(this.holeN).fill(null)).map((c, k) => (i === me || x.show || (x.mask && x.mask[k]) ? c : null)) : [],
        hand: x.show && x.hand ? x.hand.name : i === me && x.inHand && !x.folded && x.cards.length === this.holeN && this.board.length >= 3 ? this.best(x.cards, this.board).name + (this.dbl ? ' | ' + this.best(x.cards, this.board2).name : '') : null,
        best: done && x.show && x.hand ? x.hand.cards : null,
      }),
      players: Object.values(this.players).filter((p) => !p.kicked).map((p) => ({ id: p.id, name: p.name, connected: p.connected, seat: this.seatOf(p.id) })),
      ledger: Object.values(this.players).map((p) => { const i = this.seatOf(p.id); const stack = i >= 0 ? this.seats[i].stack + this.seats[i].bet + (this.inHand() ? this.seats[i].total - this.seats[i].bet : 0) : 0; return { id: p.id, name: p.name, totalIn: p.totalIn, stack, net: stack - p.totalIn, stats: p.stats || null }; }),
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
      hands: this.hist.slice(-40).map((h) => ({ hand: h.hand, commit: h.commit, board: h.board, board2: h.board2, plo: !!h.plo, dbl: !!h.dbl, button: h.button, seats: h.seats.map((x) => ({ seat: x.seat, name: x.name, cards: x.cards })),
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
