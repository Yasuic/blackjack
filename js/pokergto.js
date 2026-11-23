// Hard computer players for the poker table ("Bots: Hard"). They play in the style of a poker solver:
// opening ranges by seat, 3-bets that mix strong hands with suited aces and other blockers, 4-bets and
// all ins by stack depth, and after the flop bets sized to the board, with bluffs and calls in the
// shares that the pot odds ask for. Moves are picked by frequency with the random source passed in.
// Like the easy bots, a hard bot looks only at what a player in its seat could see: its own cards, the
// board, the bets, the stacks, the seats and the public hand log. It never reads another seat's cards or
// the deck. Hold'em with one board only; for Omaha and two boards it returns null and the easy bot plays.

const RK = '23456789TJQKA';
const RV = { 2: 0, 3: 1, 4: 2, 5: 3, 6: 4, 7: 5, 8: 6, 9: 7, 10: 8, T: 8, J: 9, Q: 10, K: 11, A: 12 };
const SMAP = { '♠': 0, '♥': 1, '♦': 2, '♣': 3, s: 0, h: 1, d: 2, c: 3 };
const suitOf = (s) => SMAP[s] ?? -1;
// A card as a number: rank * 4 + suit (rank 0 is a two, 12 an ace).
export function cardInt(c) {
  const r = RV[c?.r], s = suitOf(c?.s);
  return r === undefined || s < 0 ? -1 : r * 4 + s;
}

// ---------- Fast hand value ----------
// One number for the best five of 5 to 7 cards; a higher number is the better hand.
const CNT = new Int8Array(13), SC = new Int8Array(4), SM = new Int32Array(4);
function straightTop(m) {
  const w = (m << 1) | ((m >> 12) & 1); // bit 0 is the ace played low
  for (let h = 13; h >= 4; h--) if (((w >> (h - 4)) & 31) === 31) return h - 1;
  return -1;
}
function topBits(m, k) {
  let out = 0;
  for (let r = 12; r >= 0 && k > 0; r--) if (m & (1 << r)) { out |= 1 << r; k--; }
  return out;
}
const val = (cat, a, b, mask) => ((cat * 16 + a) * 16 + b) * 8192 + mask;
export const catOf = (v) => Math.floor(v / (256 * 8192));
export function evalCards(cs, n = cs.length) {
  CNT.fill(0); SC.fill(0); SM.fill(0);
  let m = 0;
  for (let i = 0; i < n; i++) { const c = cs[i], r = c >> 2, s = c & 3; CNT[r]++; SC[s]++; SM[s] |= 1 << r; m |= 1 << r; }
  for (let s = 0; s < 4; s++) if (SC[s] >= 5) {
    const sf = straightTop(SM[s]);
    return sf >= 0 ? val(8, sf, 0, 0) : val(5, 0, 0, topBits(SM[s], 5));
  }
  let q = -1, t1 = -1, t2 = -1, p1 = -1, p2 = -1;
  for (let r = 12; r >= 0; r--) {
    const k = CNT[r];
    if (k === 4) q = r;
    else if (k === 3) { if (t1 < 0) t1 = r; else if (t2 < 0) t2 = r; }
    else if (k === 2) { if (p1 < 0) p1 = r; else if (p2 < 0) p2 = r; }
  }
  if (q >= 0) return val(7, q, 0, topBits(m & ~(1 << q), 1));
  if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) return val(6, t1, Math.max(t2, p1), 0);
  const st = straightTop(m);
  if (st >= 0) return val(4, st, 0, 0);
  if (t1 >= 0) return val(3, t1, 0, topBits(m & ~(1 << t1), 2));
  if (p2 >= 0) return val(2, p1, p2, topBits(m & ~(1 << p1) & ~(1 << p2), 1));
  if (p1 >= 0) return val(1, p1, 0, topBits(m & ~(1 << p1), 3));
  return val(0, 0, 0, topBits(m, 5));
}

// ---------- The 169 starting hands ----------
// Index of a two card class: a pair on the diagonal, suited above it, offsuit below it.
const cls = (hi, lo, suited) => (hi === lo ? hi * 13 + hi : suited ? hi * 13 + lo : lo * 13 + hi);
const classOf = (a, b) => { const ra = a >> 2, rb = b >> 2; return cls(Math.max(ra, rb), Math.min(ra, rb), ra !== rb && (a & 3) === (b & 3)); };
export const className = (i) => { const r = Math.floor(i / 13), c = i % 13; return r === c ? RK[r] + RK[r] : r > c ? RK[r] + RK[c] + 's' : RK[c] + RK[r] + 'o'; };
// All 169 classes from strongest to weakest: equity against one and against two random hands,
// worked out once with 30,000 random deals per hand, and the two orders averaged.
const ORDER = 'AA KK QQ JJ TT 99 88 AKs AQs AKo 77 AJs AQo ATs KQs AJo KJs ATo KTs 66 A9s KQo A8s QJs A7s KTo KJo K9s A5s A9o QTs A8o A6s 55 A4s JTs QJo A7o K8s A3s K7s Q9s QTo A5o K9o A6o A2s K6s J9s Q8s A4o JTo 44 K5s Q9o A3o K8o T9s J8s K4s Q7s Q6s K7o A2o K3s J9o T8s Q8o K6o J7s Q5s 98s K5o K2s T9o 33 Q4s J8o K4o T7s Q3s J6s Q7o 97s T8o K3o 87s T6s J5s Q6o Q2s Q5o 98o J7o K2o 22 96s J4s T7o Q4o J3s 86s T5s 76s J2s Q3o J6o T4s 95s 97o J5o T6o T3s 87o 75s J4o 65s Q2o 85s T2s 96o J3o 94s 93s 86o 54s J2o 76o 74s 84s T5o T4o 95o 64s 92s T3o 85o 53s 63s 65o 73s 83s 82s 75o T2o 43s 94o 54o 52s 93o 84o 74o 64o 72s 62s 92o 42s 83o 53o 32s 63o 82o 73o 43o 62o 52o 72o 42o 32o';
const PCT = new Float64Array(169); // share of all two card hands at least as strong, 0 to 1
(() => {
  let sum = 0;
  const names = ORDER.split(' ');
  for (const nm of names) {
    const i = classIndex(nm);
    if (i < 0) continue;
    sum += nm.length === 2 ? 6 : nm[2] === 's' ? 4 : 12;
    PCT[i] = sum / 1326;
  }
  for (let i = 0; i < 169; i++) if (!PCT[i]) PCT[i] = 1;
})();
function classIndex(nm) {
  const h = RK.indexOf(nm[0]), l = RK.indexOf(nm[1]);
  if (h < 0 || l < 0) return -1;
  return h === l ? cls(h, h) : cls(Math.max(h, l), Math.min(h, l), nm[2] === 's');
}

// A range in the usual notation: "77+, A2s+, KTs+, 99-66, A5s-A2s, AJo+, KQ". "A5s:0.5" plays the hand half the time.
export function parseRange(str) {
  const w = new Float32Array(169);
  for (let tok of str.split(',')) {
    tok = tok.trim();
    if (!tok) continue;
    let f = 1;
    const ci = tok.indexOf(':');
    if (ci > 0) { f = Number(tok.slice(ci + 1)); tok = tok.slice(0, ci); }
    const plus = tok.endsWith('+');
    if (plus) tok = tok.slice(0, -1);
    const [a, b] = tok.split('-');
    const p = (s) => ({ h: RK.indexOf(s[0]), l: RK.indexOf(s[1]), t: s[2] || '' });
    const A = p(a), set = (i) => { w[i] = Math.max(w[i], f); };
    const kinds = A.t === 's' ? [true] : A.t === 'o' ? [false] : [true, false];
    if (A.h === A.l) {
      const lo = b ? p(b).h : A.h, hi = plus ? 12 : A.h;
      for (let r = Math.min(lo, hi); r <= Math.max(lo, hi); r++) set(cls(r, r));
    } else {
      const from = b ? p(b).l : A.l, to = plus ? A.h - 1 : A.l;
      for (let k = Math.min(from, to); k <= Math.max(from, to); k++) for (const s of kinds) set(cls(A.h, k, s));
    }
  }
  return w;
}

// ---------- Ranges before the flop (about 100 big blinds deep) ----------
// Opening ranges by seat, counted from the button: 0 button, 1 cutoff, 2 hijack, 3 lojack, 4 first seat at six, 5 early seat at nine.
const R = (s) => parseRange(s);
const RFI = [
  R('22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,74s+,64s+,53s+,43s:0.5,A2o+,K8o+,K7o:0.5,Q9o+,Q8o:0.4,J9o+,T8o+,98o,87o:0.5,76o:0.3'),
  R('33+,22:0.5,A2s+,K6s+,K5s:0.5,Q8s+,J8s+,T8s+,97s+,86s+,76s,65s,54s:0.6,A8o+,A5o:0.5,KTo+,QTo+,JTo,T9o:0.3'),
  R('44+,33:0.5,A2s+,K8s+,K7s:0.4,Q9s+,J9s+,T8s+,98s,87s,76s:0.5,65s:0.4,ATo+,A9o:0.3,KTo+,QJo,QTo:0.6,JTo:0.4'),
  R('55+,44:0.5,A3s+,A2s:0.5,K9s+,Q9s+,J9s+,T9s,98s:0.6,87s:0.4,76s:0.3,ATo+,KJo+,KTo:0.4,QJo:0.5'),
  R('66+,55:0.5,A4s+,A3s:0.5,KTs+,K9s:0.5,QTs+,JTs,T9s:0.6,98s:0.3,AJo+,ATo:0.4,KQo,KJo:0.4'),
  R('77+,66:0.5,A9s+,A5s:0.6,A4s:0.3,KTs+,QTs+,JTs,T9s:0.4,AJo+,KQo'),
];
// Small blind when everyone else folded: raise some hands, complete some, fold the rest.
const SB_RAISE = R('33+,22:0.6,A2s+,K5s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s,A7o+,A5o,KTo+,QJo,QTo:0.5,JTo:0.5');
const SB_LIMP = R('22,K2s+,Q2s+,J4s+,T5s+,95s+,85s+,74s+,64s+,53s+,43s,A2o+,K5o+,Q7o+,J8o+,T8o+,97o+,87o,76o:0.5');
// Heads up the button is the small blind and opens most hands.
const HU_BTN = R('22+,A2s+,K2s+,Q2s+,J2s+,T3s+,95s+,84s+,74s+,63s+,53s+,43s,A2o+,K2o+,Q4o+,J6o+,T6o+,96o+,86o+,75o+,65o,54o:0.5');
// 3-bets: strong hands for value plus suited wheel aces and other blockers as bluffs. Keyed by the opener's seat.
const TB_VAL = { ep: R('QQ+,AKs,AKo'), mp: R('JJ+,AQs+,AKo,KQs:0.4,TT:0.4'), late: R('TT+,AJs+,AQo+,KQs,99:0.4,KJs:0.4'), hu: R('88+,ATs+,KJs+,AJo+,KQo:0.5') };
const TB_BLUFF = {
  ep: R('A5s:0.6,A4s:0.4,KJs:0.2,76s:0.15,65s:0.15'),
  mp: R('A5s,A4s:0.7,A3s:0.5,K9s:0.35,Q9s:0.3,J9s:0.3,T8s:0.3,65s:0.3,AJo:0.3,KJo:0.2'),
  late: R('A2s-A5s,A9s:0.5,K8s:0.5,K9s:0.5,Q9s:0.5,J9s:0.5,T8s:0.5,97s:0.4,86s:0.4,75s:0.4,65s:0.4,54s:0.4,ATo:0.5,KJo:0.5,QJo:0.3'),
  hu: R('A2s-A9s:0.5,K5s-KTs:0.3,Q8s:0.3,J8s:0.3,T7s:0.3,96s:0.3,85s:0.3,74s:0.3,63s:0.3,53s:0.3,K9o:0.3,Q9o:0.3'),
};
// Flat calls of an open in position.
const CALL_OPEN = {
  ep: R('TT:0.6,99-22:0.8,AQs-ATs,KQs,KJs,QJs,JTs,T9s:0.6,98s:0.4,AQo:0.5'),
  late: R('TT:0.6,99-22,AJs-A6s,KTs+,K9s,QTs+,Q9s,J9s+,T8s+,98s,87s,76s,65s:0.5,AQo-ATo,KQo,KJo:0.5,QJo:0.4'),
};
const SB_CALL = R('TT-66:0.4,AQs:0.3,KQs:0.3,AJs:0.3');
// After our open was 3-bet.
const FB_VAL = R('KK+,AKs,QQ:0.5,AKo:0.7');
const FB_BLUFF = R('A5s:0.5,A4s:0.4,K5s:0.1');
const CALL_3B = R('QQ:0.5,JJ,TT,99:0.6,88:0.4,AQs,AJs,ATs:0.5,KQs,KJs:0.6,QJs:0.6,JTs:0.6,T9s:0.4,98s:0.3,AQo:0.5,AKo:0.3');
// A 3-bet that we did not open against.
const COLD_4B = R('KK+,AKs');
const COLD_CALL = R('QQ,JJ:0.5,AKo:0.6,AQs:0.4');
// Facing a 4-bet or more: all in or call with these; more hands when the stacks are short.
const JAM_DEEP = R('KK+,AKs,AKo:0.8,QQ:0.6');
const JAM_SHORT = R('QQ+,AKs,AKo,JJ:0.6,AQs:0.4,A5s:0.15');

// ---------- Monte Carlo equity against ranges ----------
const COMBOS = [];
for (let a = 0; a < 52; a++) for (let b = a + 1; b < 52; b++) COMBOS.push([a, b]);
function rng(seed) {
  let s = (seed >>> 0) || 0x9e3779b9;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
// What is known about the board alone, worked out once per decision.
function boardInfo(board) {
  let top = 0, mask = 0;
  for (const b of board) { const r = b >> 2; if (r > top) top = r; mask |= 1 << r; }
  return { board, top, mask, bc: boardCat(board) };
}
function boardCat(board) {
  const n = {};
  for (const x of board) n[x >> 2] = (n[x >> 2] || 0) + 1;
  const k = Object.values(n).sort((a, b) => b - a);
  return k[0] >= 4 ? 7 : k[0] === 3 && k[1] >= 2 ? 6 : k[0] === 3 ? 3 : k[0] === 2 && k[1] === 2 ? 2 : k[0] === 2 ? 1 : 0;
}
// How strong two cards are on this board: s is 0 nothing, 1 a draw, 2 a weak pair, 3 top pair or an
// overpair, 4 two pair or better that the board does not give to everyone. draw: 1 a straight draw, 2 a flush draw.
const HS = new Int32Array(7);
export function strength(h1, h2, bi) {
  const board = bi.board, n = board.length;
  HS[0] = h1; HS[1] = h2;
  for (let k = 0; k < n; k++) HS[k + 2] = board[k];
  const v = evalCards(HS, n + 2), c = catOf(v), bc = bi.bc;
  const r1 = h1 >> 2, r2 = h2 >> 2, on1 = (bi.mask >> r1) & 1, on2 = (bi.mask >> r2) & 1;
  let s = 0;
  if ((c >= 4 && c > bc) || (c === 3 && bc < 3) || (c === 2 && bc === 0)) s = 4;
  else if (r1 === r2 && !on1) s = r1 > bi.top ? 3 : 2;
  else { const pr = Math.max(on1 ? r1 : -1, on2 ? r2 : -1); if (pr >= 0) s = pr >= bi.top ? 3 : 2; }
  let draw = 0;
  if (n < 5 && c < 4) {
    for (let su = 0; su < 4; su++) {
      let k = 0;
      for (let q = 0; q < n + 2; q++) if ((HS[q] & 3) === su) k++;
      if (k === 4 && ((h1 & 3) === su || (h2 & 3) === su)) draw = 2;
    }
    const m = bi.mask | (1 << r1) | (1 << r2), w = (m << 1) | ((m >> 12) & 1);
    const hm = (1 << (r1 + 1)) | (1 << (r2 + 1)) | (r1 === 12 || r2 === 12 ? 1 : 0);
    for (let lo = 0; lo <= 10; lo++) if (((w >> lo) & 15) === 15 && ((hm >> lo) & 15)) { draw = Math.max(draw, 1); break; }
    if (s === 0 && draw) s = 1;
  }
  return { s, draw, cat: c };
}
// A weight for every two card combo a player could hold: how well it fits what the player did.
// pre: the share of starting hands the player plays like this (1 = any two cards); post: weights by strength.
function rangeWeights(dead, bi, pre, post) {
  const w = new Float64Array(COMBOS.length), board = bi.board;
  let sum = 0;
  for (let k = 0; k < COMBOS.length; k++) {
    const [a, b] = COMBOS[k];
    if (dead[a] || dead[b]) { w[k] = sum; continue; }
    const p = PCT[classOf(a, b)];
    let x = p <= pre ? 1 : Math.max(0.03, Math.exp(-(p - pre) / 0.07));
    if (post && board.length >= 3) x *= post[strength(a, b, bi).s];
    sum += x; w[k] = sum;
  }
  return w;
}
function pick(cum, u) {
  let lo = 0, hi = cum.length - 1;
  const target = u * cum[hi];
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] <= target) lo = mid + 1; else hi = mid; }
  return lo;
}
// The share of the pot our hand wins against each opponent's range, with the rest of the board random.
export function equity(hole, board, ranges, iters, seed) {
  const r = rng(seed), dead = new Uint8Array(52);
  for (const c of hole) dead[c] = 1;
  for (const c of board) dead[c] = 1;
  const deck = [];
  for (let c = 0; c < 52; c++) if (!dead[c]) deck.push(c);
  const used = new Uint8Array(52), cs = new Int32Array(7), vs = new Int32Array(7), need = 5 - board.length;
  let won = 0, done = 0;
  for (let it = 0; it < iters; it++) {
    const vh = [];
    let bad = false;
    for (const cum of ranges) {
      let tries = 0, k;
      do { k = pick(cum, r()); tries++; } while ((used[COMBOS[k][0]] || used[COMBOS[k][1]]) && tries < 12);
      const [a, b] = COMBOS[k];
      if (used[a] || used[b]) { bad = true; break; }
      used[a] = used[b] = 1; vh.push(a, b);
    }
    if (!bad) {
      const run = [];
      while (run.length < need) { const c = deck[Math.floor(r() * deck.length)]; if (!used[c]) { used[c] = 1; run.push(c); } }
      let n = 0;
      for (const c of board) cs[n++] = c;
      for (const c of run) cs[n++] = c;
      for (let q = 0; q < 5; q++) vs[q] = cs[q];
      cs[5] = hole[0]; cs[6] = hole[1];
      const me = evalCards(cs, 7);
      let best = 0, ties = 0;
      for (let v = 0; v < vh.length; v += 2) {
        vs[5] = vh[v]; vs[6] = vh[v + 1];
        const s = evalCards(vs, 7);
        if (s > best) best = s;
        if (s === me) ties++;
      }
      if (me > best) won += 1; else if (me === best) won += 1 / (ties + 1);
      done++;
      for (const c of run) used[c] = 0;
    }
    for (const c of vh) used[c] = 0;
  }
  return done ? won / done : 0.5;
}

// ---------- Reading the table (public information only) ----------
// Seats dealt into this hand in the order they act after the flop: left of the button first, the button last.
function order(t) {
  const out = [], N = t.seats.length;
  for (let k = 1; k <= N; k++) { const i = (t.button + k) % N, x = t.seats[i]; if (x && x.inHand) out.push(i); }
  return out;
}
// The public log of this hand, split into the lines before the flop and the lines of the current street.
function handLines(t) {
  const lines = t.cur?.lines || [];
  const start = lines.findIndex((l) => l.startsWith(`Hand ${t.handNo}`));
  if (start < 0) return null;
  const hand = lines.slice(start);
  const flop = hand.findIndex((l) => /^Flop: /.test(l));
  let last = -1;
  hand.forEach((l, k) => { if (/^(Flop|Turn|River): /.test(l)) last = k; });
  return { all: hand, pre: flop < 0 ? hand : hand.slice(0, flop), street: last < 0 ? hand : hand.slice(last + 1) };
}
const RAISE_RE = / raises to \d+/, BET_RE = / (bets|raises to) \d+/;
function seatByName(t, line) {
  for (let i = 0; i < t.seats.length; i++) if (t.seats[i] && line.startsWith(t.name(i) + ' ')) return i;
  return -1;
}

// ---------- The move ----------
// Same answer shape as the easy bot: { a: 'fold' | 'check' | 'call' | 'bet' | 'raise', amount }. null means "let the easy bot play".
export function botMoveHard(t, id, rnd = Math.random) {
  const o = t.options(id);
  if (!o) return null;
  if (t.plo || t.dbl) return null;
  const i = t.seatOf(id), x = t.seats[i];
  if (typeof t.known === 'function' && !t.known(i)) return null;
  if (!x || !x.cards || x.cards.length !== 2) return null;
  const hole = x.cards.map(cardInt), board = t.board.map(cardInt);
  if (hole.some((c) => c < 0) || board.some((c) => c < 0)) return null;
  const bb = t.settings.bigBlind || 1, ord = order(t), live = t.liveSeats().filter((q) => q !== i);
  if (!live.length) return null;
  const eff = Math.min(x.stack + x.bet, Math.max(...live.map((q) => t.seats[q].stack + t.seats[q].bet)));
  const lines = handLines(t);
  const c = { t, o, i, x, bb, hole, board, ord, live, eff, effBB: eff / bb, lines, rnd, seed: Math.floor(rnd() * 4294967296) };
  const m = board.length === 0 ? preflop(c) : postflop(c);
  return legal(m, o);
}
// Turns a wish into a move the table accepts.
function legal(m, o) {
  if (!m) return null;
  if (m.a === 'raise' || m.a === 'bet') {
    if (!o.canRaise) return o.canCheck ? { a: 'check' } : { a: 'call' };
    const to = Math.round(Math.max(o.minTo, Math.min(o.maxTo, Number(m.amount) || o.minTo)));
    return { a: o.isBet ? 'bet' : 'raise', amount: to };
  }
  if (m.a === 'call') return o.canCheck ? { a: 'check' } : { a: 'call' };
  if (m.a === 'fold' || m.a === 'check') return o.canCheck ? { a: 'check' } : { a: 'fold' };
  return null;
}
const raiseTo = (c, to) => {
  // A raise that would leave little behind goes all in instead.
  const max = c.x.stack + c.x.bet;
  return { a: 'raise', amount: to >= max * 0.45 ? c.o.maxTo : to };
};
const jam = (c) => ({ a: 'raise', amount: c.o.maxTo });

// How wide a player's starting hands are, from what they did before the flop.
function preWidth(c, q, raises, lastRaiser) {
  const y = c.t.seats[q];
  if (c.t.bomb) return 1;
  if (q === lastRaiser) return raises >= 3 ? 0.04 : raises === 2 ? 0.08 : y.stack + y.bet <= 15 * c.bb ? 0.3 : 0.22;
  if (y.pf) return raises >= 3 ? 0.05 : 0.14;
  if (y.vp) return raises === 0 ? 0.5 : raises === 1 ? (q === bbSeat(c) ? 0.5 : 0.3) : 0.09;
  return 1;
}
const bbSeat = (c) => (c.ord.length === 2 ? c.ord[0] : c.ord[1]);
function preInfo(c) {
  const { t } = c;
  let raises, last = -1;
  if (c.lines) {
    const rl = c.lines.pre.filter((l) => RAISE_RE.test(l));
    raises = rl.length;
    if (rl.length) last = seatByName(t, rl[rl.length - 1]);
  } else {
    // No log to read (the table moved to this browser mid hand): judge by the size of the bet.
    const cb = t.currentBet, b = c.bb;
    raises = t.board.length ? c.ord.filter((q) => t.seats[q].pf).length : cb <= b ? 0 : cb <= 5.5 * b ? 1 : cb <= 15 * b ? 2 : 3;
  }
  if (last < 0 && t.board.length === 0 && raises > 0 && t.raiser >= 0) last = t.raiser;
  if (last < 0 && raises > 0) { const pfs = c.ord.filter((q) => t.seats[q].pf); if (pfs.length === 1) last = pfs[0]; }
  return { raises, last };
}
function seatRole(c, q) {
  const n = c.ord.length, k = c.ord.indexOf(q);
  if (n === 2) return k === 1 ? 'SB' : 'BB';
  if (k === 0) return 'SB';
  if (k === 1) return 'BB';
  return n - 1 - k; // seats from the button
}
const distKey = (d) => (d === 'SB' ? 'late' : d === 'BB' ? 'late' : d >= 3 ? 'ep' : d >= 1 ? 'mp' : 'late');

function preflop(c) {
  const { t, o, x, bb, hole, rnd } = c;
  const ci = classOf(hole[0], hole[1]), pct = PCT[ci], hu = c.ord.length === 2;
  const { raises, last } = preInfo(c);
  const role = seatRole(c, c.i);
  const unit = raises === 0 ? Math.max(bb, t.currentBet) : bb;
  const r = rnd();
  const limpers = raises === 0 ? c.live.filter((q) => t.seats[q].vp).length : 0;
  // A big part of the stack to call, or someone is all in: call when our share of the pot beats the price.
  const opAllIn = c.live.some((q) => t.seats[q].allIn && t.seats[q].bet > x.bet);
  if (!o.canCheck && (o.toCall >= x.stack * 0.4 || opAllIn)) {
    const ranges = rangesFor(c, raises, last, null);
    const eq = equity(hole, [], ranges, 500, c.seed);
    const req = o.toCall / (o.pot + o.toCall);
    if (eq >= req + 0.01) return o.canRaise && pct <= 0.025 && !opAllIn ? jam(c) : { a: 'call' };
    return { a: 'fold' };
  }
  // Short stacks: all in or fold when nobody has raised.
  if (raises === 0 && c.effBB <= 12) {
    const base = hu ? 0.65 : role === 'SB' ? 0.55 : role === 'BB' ? 0.2 : [0.42, 0.3, 0.24, 0.2, 0.16, 0.13][Math.min(5, role)];
    const width = Math.min(0.8, base * Math.pow(10 / Math.max(2, c.effBB), 0.6)) * (limpers ? 0.6 : 1);
    if (pct <= width && o.canRaise) return jam(c);
    return o.canCheck ? { a: 'check' } : { a: 'fold' };
  }
  if (raises === 0) {
    if (o.canCheck) { // the big blind after limps, or the small blind's complete
      const top = hu ? 0.3 : 0.12;
      if (pct <= top && r < 0.85) return raiseTo(c, unit * (hu ? 3.5 : 4) + limpers * unit);
      return { a: 'check' };
    }
    if (limpers === 0) {
      if (hu) return r < HU_BTN[ci] ? raiseTo(c, unit * 2.5) : r < HU_BTN[ci] + 0.15 && pct < 0.9 ? { a: 'call' } : { a: 'fold' };
      if (role === 'SB') {
        const pr = SB_RAISE[ci], pl = (1 - pr) * SB_LIMP[ci];
        return r < pr ? raiseTo(c, unit * 3) : r < pr + pl ? { a: 'call' } : { a: 'fold' };
      }
      // (The big blind facing a straddle plays the tightest range.)
      const d = typeof role === 'number' ? Math.min(5, role + (c.ord.length >= 8 && role >= 4 ? 1 : 0)) : 5;
      return r < RFI[d][ci] ? raiseTo(c, unit * (d <= 1 ? 2.3 : 2.5)) : { a: 'fold' };
    }
    // Players limped in: raise to isolate them, limp behind with small pairs and suited hands, else fold.
    const d = role === 'SB' ? 4 : role === 'BB' ? 5 : Math.min(5, role + 1);
    if (r < RFI[d][ci] && pct <= 0.3) return raiseTo(c, unit * (3 + limpers + (role === 'SB' ? 1 : 0)));
    const own = role === 'SB' ? (pct <= 0.5 ? 1 : 0) : role === 'BB' ? 1 : RFI[Math.min(5, role)][ci];
    const kind = Math.floor(ci / 13) === ci % 13 || Math.floor(ci / 13) > ci % 13;
    if (own && (kind || role === 'SB') && r < 0.75) return { a: 'call' };
    return { a: 'fold' };
  }
  const opener = last >= 0 ? last : t.raiser;
  const oRole = opener >= 0 ? seatRole(c, opener) : 'BTN';
  const key = hu ? 'hu' : distKey(oRole === 'BTN' ? 0 : oRole);
  const ip = role !== 'SB' && role !== 'BB';
  const cur = t.currentBet, callers = c.live.filter((q) => q !== opener && t.seats[q].bet === cur).length;
  if (raises === 1) {
    if (c.effBB <= 25) { // short: all in over the open or fold
      const w = Math.min(0.35, 0.06 + 0.012 * (25 - c.effBB) + (key === 'late' || key === 'hu' ? 0.06 : 0));
      if (pct <= w && o.canRaise) return jam(c);
      if (role === 'BB' && pct <= 0.3 && o.toCall <= 2 * bb) return { a: 'call' };
      return { a: 'fold' };
    }
    const squeeze = callers > 0 ? 0.5 : 1;
    const p3 = Math.max(TB_VAL[key][ci], TB_BLUFF[key][ci] * squeeze);
    const size = (ip ? 3 : 3.8) * cur + callers * cur;
    if (r < p3 && o.canRaise) return raiseTo(c, size);
    if (role === 'BB') {
      // Defend the big blind by the price of the open: wider against small opens and late seats.
      const openBB = cur / bb, base = hu ? 0.72 : oRole === 'SB' ? 0.7 : { late: 0.62, mp: 0.48, ep: 0.36 }[distKey(oRole)];
      const width = Math.max(0.12, Math.min(0.8, base * Math.min(1.2, 2.5 / Math.max(2, openBB)) * Math.pow(0.85, callers)));
      return pct <= width ? { a: 'call' } : { a: 'fold' };
    }
    const pc = role === 'SB' ? SB_CALL[ci] : (key === 'ep' ? CALL_OPEN.ep : CALL_OPEN.late)[ci] * (callers ? 0.8 : 1);
    return r < p3 + (1 - p3) * pc ? { a: 'call' } : { a: 'fold' };
  }
  if (raises === 2) {
    if (x.pf) { // our open was 3-bet
      const pv = FB_VAL[ci], pb = FB_BLUFF[ci], size = (ip ? 2.3 : 2.6) * cur;
      if (r < pv && o.canRaise) return size >= c.eff * 0.4 ? jam(c) : raiseTo(c, size);
      if (r < pv + pb && o.canRaise) return size >= c.eff * 0.4 ? { a: 'fold' } : raiseTo(c, size);
      const pc = c.effBB >= 40 ? CALL_3B[ci] : JAM_SHORT[ci];
      return rnd() < pc ? { a: 'call' } : { a: 'fold' };
    }
    if (r < COLD_4B[ci] && o.canRaise) return raiseTo(c, 2.4 * cur);
    return rnd() < COLD_CALL[ci] ? { a: 'call' } : { a: 'fold' };
  }
  const w = c.effBB <= 60 ? JAM_SHORT[ci] : JAM_DEEP[ci];
  if (r < w) return o.canRaise && (pct <= 0.02 || c.effBB <= 60) ? jam(c) : { a: 'call' };
  return { a: 'fold' };
}

// Each live opponent's range as cumulative weights, read from the public actions.
function rangesFor(c, raises, last, post) {
  const dead = new Uint8Array(52);
  for (const q of c.hole) dead[q] = 1;
  for (const q of c.board) dead[q] = 1;
  const bi = boardInfo(c.board);
  return c.live.map((q) => rangeWeights(dead, bi, preWidth(c, q, raises, last), post ? post(q) : null));
}
// Weights by strength (nothing, draw, weak pair, good pair, strong) for what a player did after the flop.
const W_BET = [0.12, 0.5, 0.3, 1, 1], W_RAISE = [0.05, 0.3, 0.1, 0.45, 1], W_EARLIER = [0.45, 0.8, 0.7, 1, 1], W_CHECK = [1, 1, 1, 0.8, 0.5];

function texture(board) {
  const sc = [0, 0, 0, 0];
  for (const b of board) sc[b & 3]++;
  const maxS = Math.max(...sc), ranks = [...new Set(board.map((b) => b >> 2))].sort((a, b) => a - b);
  let conn = false;
  for (let k = 0; k + 2 < ranks.length; k++) if (ranks[k + 2] - ranks[k] <= 4) conn = true;
  if (ranks.includes(12) && ranks.filter((v) => v <= 3).length >= 2) conn = true;
  const paired = ranks.length < board.length;
  let wet = 0;
  if (board.length < 5 && maxS >= 2) wet++;
  if (maxS >= 3) wet++;
  if (conn) wet++;
  return { wet: wet >= 2 || (wet >= 1 && !paired && board.length === 3 && ranks[ranks.length - 1] - ranks[0] <= 5), paired, maxS };
}

function postflop(c) {
  const { t, o, x, hole, board, rnd } = c;
  const street = board.length === 3 ? 0 : board.length === 4 ? 1 : 2;
  const { raises, last } = preInfo(c);
  const n = c.live.length;
  // Bets and raises on this street and before it, from the public log (or from the bets in front of the players).
  const streetBets = c.lines ? c.lines.street.filter((l) => BET_RE.test(l)).length : t.currentBet > 0 ? 1 : 0;
  const postLines = c.lines ? c.lines.all.slice(c.lines.all.findIndex((l) => /^Flop: /.test(l)) + 1) : [];
  const earlier = (q) => {
    // Streets before this one on which the player bet or raised.
    if (!c.lines) return t.seats[q].agg ? 1 : 0;
    let n = 0, mine = false;
    for (const l of postLines.slice(0, postLines.length - c.lines.street.length)) {
      if (/^(Turn|River): /.test(l)) { if (mine) n++; mine = false; } else if (BET_RE.test(l) && seatByName(t, l) === q) mine = true;
    }
    return n;
  };
  const post = (q) => {
    const y = t.seats[q], w = [1, 1, 1, 1, 1];
    const mul = (a) => { for (let k = 0; k < 5; k++) w[k] *= a[k]; };
    if (t.currentBet > 0 && q === t.raiser) mul(streetBets >= 2 ? W_RAISE : W_BET);
    for (let k = earlier(q); k > 0; k--) mul(W_EARLIER);
    if (t.currentBet === 0 && y.acted) mul(W_CHECK);
    return w;
  };
  const ranges = rangesFor(c, raises, last, post);
  const iters = n === 1 ? 600 : n === 2 ? 450 : 350;
  const eq = equity(hole, board, ranges, iters, c.seed);
  const eqA = n > 1 ? Math.pow(eq, 1 / n) : eq; // as if against one player
  const me = strength(hole[0], hole[1], boardInfo(board));
  const tex = texture(board);
  const ip = c.live.filter((q) => !t.seats[q].allIn).every((q) => c.ord.indexOf(q) < c.ord.indexOf(c.i));
  const behind = x.stack, spr = Math.min(behind, ...c.live.map((q) => t.seats[q].stack + t.seats[q].bet)) / Math.max(1, o.pot);
  const aggressor = last === c.i || (x.agg && street > 0);
  const r = rnd();
  if (o.canCheck) {
    // Bet sizes: small on dry flops, bigger on wet boards and later streets, all in when the stack is short.
    let frac = street === 0 ? (tex.wet ? 0.75 : 0.33) : street === 1 ? (tex.wet ? 0.75 : 0.5) : 0.75;
    if (street === 2 && eqA > 0.9 && r < 0.5) frac = 1.25;
    const lowSpr = spr <= 1.3;
    const betAmt = o.pot * frac, amount = (lowSpr || betAmt >= behind * 0.6) ? o.maxTo : Math.round(t.currentBet + betAmt);
    // Value: strong enough against the range that a bet is called by worse.
    const vt = (street === 0 ? (frac < 0.5 ? 0.56 : 0.62) : street === 1 ? 0.65 : 0.7) + (n - 1) * 0.02;
    if (eqA >= vt) {
      const trap = eqA > 0.9 && street === 0 && !tex.wet && !ip ? 0.25 : eqA > 0.9 && street === 0 && !tex.wet ? 0.15 : 0.05;
      if (r >= trap) return { a: 'bet', amount };
      return { a: 'check' };
    }
    if (n <= 2 && street < 2 && me.s === 1 && me.draw) {
      // Semi bluffs with draws.
      if (r < (street === 0 ? 0.6 : 0.5) / n) return { a: 'bet', amount };
      return { a: 'check' };
    }
    if (n === 1 && street === 2 && eqA < 0.3) {
      // River bluffs in the share the pot odds allow: bluffs make up bet / (pot + 2 bet) of the betting range.
      const s = Math.min(frac, 1), share = s / (1 + 2 * s), perAir = Math.min(0.85, (share / (1 - share)) * 0.9);
      if (r < perAir) return { a: 'bet', amount };
      return { a: 'check' };
    }
    if (n === 1 && street === 0 && aggressor && eqA < 0.5) {
      // Continuation bets with hands that have little: often on dry boards, less on wet ones.
      if (r < (tex.wet ? 0.3 : 0.55)) return { a: 'bet', amount };
      return { a: 'check' };
    }
    if (n === 1 && street === 1 && x.agg && eqA < 0.35 && me.draw && r < 0.5) return { a: 'bet', amount };
    if (n === 1 && ip && street < 2 && eqA >= 0.5 && eqA < vt && r < 0.25) return { a: 'bet', amount: Math.round(o.pot * 0.33) }; // thin value, small
    return { a: 'check' };
  }
  // Facing a bet.
  const req = o.toCall / (o.pot + o.toCall);
  const alpha = o.toCall / Math.max(1, o.pot), mdf = 1 - alpha;
  const allInCall = o.toCall >= x.stack;
  const checkRaise = !ip && x.bet === 0;
  const rv = (street === 0 ? 0.78 : street === 1 ? 0.82 : 0.88) + (streetBets >= 2 ? 0.06 : 0);
  const raiseAmt = Math.round(t.currentBet + (o.pot + o.toCall) * 0.7);
  if (!allInCall && o.canRaise && eqA >= rv && r < (checkRaise ? 0.8 : 0.7)) return raiseTo(c, raiseAmt);
  if (!allInCall && o.canRaise && n === 1 && streetBets < 2) {
    // Bluff raises with draws, about one for every two value raises.
    if (street < 2 && me.s === 1 && me.draw && r < (checkRaise ? 0.22 : 0.12)) return raiseTo(c, raiseAmt);
    if (street === 2 && eqA < 0.12 && r < 0.03) return raiseTo(c, raiseAmt);
  }
  // Calls compare our real share of the final pot with the price; a little more is asked before the river,
  // because later bets can still push us off the hand.
  const extra = allInCall ? 0 : street === 0 ? 0.06 : street === 1 ? 0.04 : 0;
  if (eq >= req + extra) return { a: 'call' };
  if (!allInCall && street < 2 && me.draw && eq + (street === 0 ? 0.06 : 0.03) >= req) return { a: 'call' };
  // Defend often enough that bluffs do not win at once: near the price, call by the minimum defense frequency.
  if (!allInCall && n === 1 && eq >= req * 0.85 && rnd() < Math.max(0, mdf - 0.5)) return { a: 'call' };
  return { a: 'fold' };
}
