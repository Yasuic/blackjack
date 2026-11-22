// European roulette (one zero, 37 pockets) for up to 9 players against the house. Pure rules: the host's
// browser owns one RouTable and every bet goes through it. Nothing here touches the page or the network.
import { sha256, MAX_CHIPS } from './game.js?v=20261122j';
import { isFrozen, bankJoin, setBank, clearBank, bankGone, bankSettle, ledgerNet, ledgerSum, bankAdopt } from './bank.js?v=20261122j';

export const ROU_SEATS = 9;
export const ROU_DEFAULTS = {
  minBet: 1,        // smallest bet on one place
  maxInside: 100,   // largest bet on one number (or split, street, corner, six line)
  maxOutside: 500,  // largest bet on red, black, odd, even, low, high, a dozen or a column
  startChips: 1000,
  betTime: 20,      // seconds from the first bet to the spin (0 = the host spins by hand)
};
export const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');
// The order of the pockets round a European wheel, clockwise from zero.
export const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const r2 = (x) => Math.round(x * 100) / 100;
const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };
const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// The numbers a bet covers, from its key. null when the key is not a real bet.
//   n17 one number · s-17-18 or s-17-20 a split (two numbers that touch) · st-16 a street (16, 17, 18)
//   co-16 a corner (16, 17, 19, 20) · li-16 a six line (16 to 21) · red black odd even low high · d1 d2 d3 · c1 c2 c3
export function betNumbers(key) {
  key = String(key);
  const simple = { red: range(1, 36).filter((n) => RED.has(n)), black: range(1, 36).filter((n) => !RED.has(n)), odd: range(1, 36).filter((n) => n % 2 === 1), even: range(1, 36).filter((n) => n % 2 === 0),
    low: range(1, 18), high: range(19, 36), d1: range(1, 12), d2: range(13, 24), d3: range(25, 36),
    c1: range(1, 36).filter((n) => n % 3 === 1), c2: range(1, 36).filter((n) => n % 3 === 2), c3: range(1, 36).filter((n) => n % 3 === 0) };
  if (Object.hasOwn(simple, key)) return simple[key];
  let m;
  if ((m = /^n(\d{1,2})$/.exec(key))) { const n = Number(m[1]); return n >= 0 && n <= 36 ? [n] : null; }
  if ((m = /^s-(\d{1,2})-(\d{1,2})$/.exec(key))) {
    const a = Number(m[1]), b = Number(m[2]);
    if (!(a < b) || b > 36) return null;
    if (a === 0) return b <= 3 ? [0, b] : null;
    if (b - a === 3) return [a, b];                    // one above the other on the layout
    if (b - a === 1 && a % 3 !== 0) return [a, b];     // side by side in the same row of three
    return null;
  }
  if ((m = /^st-(\d{1,2})$/.exec(key))) { const a = Number(m[1]); return a >= 1 && a <= 34 && a % 3 === 1 ? [a, a + 1, a + 2] : null; }
  if ((m = /^co-(\d{1,2})$/.exec(key))) { const a = Number(m[1]); return a >= 1 && a <= 32 && a % 3 !== 0 ? [a, a + 1, a + 3, a + 4] : null; }
  if ((m = /^li-(\d{1,2})$/.exec(key))) { const a = Number(m[1]); return a >= 1 && a <= 31 && a % 3 === 1 ? range(a, a + 5) : null; }
  return null;
}
export const isOutside = (key) => /^(red|black|odd|even|low|high|d[123]|c[123])$/.test(String(key));
// What 1 chip wins on a bet that covers k numbers: 36 / k − 1 (35 for one number, 1 for red or black).
export const betPays = (key) => { const ns = betNumbers(key); return ns ? 36 / ns.length - 1 : 0; };
export function betName(key) {
  const names = { red: 'Red', black: 'Black', odd: 'Odd', even: 'Even', low: '1 to 18', high: '19 to 36', d1: '1st 12', d2: '2nd 12', d3: '3rd 12', c1: 'Column 1', c2: 'Column 2', c3: 'Column 3' };
  if (Object.hasOwn(names, key)) return names[key];
  const ns = betNumbers(key);
  return ns ? ns.join(' / ') : key;
}

function randomSeed() {
  const buf = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < 32; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (x) => x.toString(16).padStart(2, '0')).join('');
}
const newCommit = () => { const seed = randomSeed(); return { seed, commit: sha256(seed) }; };
// The pocket for a spin, from the host's hidden seed and the players' seeds. Every pocket is equally likely:
// a 32 bit number is read from a hash, and numbers in the uneven tail are thrown away and read again.
export function spinNumber(serverSeed, clientSeeds = {}) {
  const mix = serverSeed + '|' + Object.keys(clientSeeds).sort().map((k) => k + ':' + clientSeeds[k]).join('|');
  const limit = Math.floor(0x100000000 / 37) * 37;
  for (let i = 0; ; i++) {
    const v = parseInt(sha256(mix + '#' + i).slice(0, 8), 16);
    if (v < limit) return v % 37;
  }
}
export function verifySpin(rec) {
  if (!rec || !rec.serverSeed || sha256(rec.serverSeed) !== rec.commit) return { ok: false, why: 'The seed does not match the code shown before the spin.' };
  return spinNumber(rec.serverSeed, rec.clientSeeds) === rec.n ? { ok: true } : { ok: false, why: 'These seeds give a different number.' };
}

export class RouTable {
  constructor(settings = {}) {
    this.settings = { ...ROU_DEFAULTS };
    this.players = {};   // id -> { id, name, connected, chips, totalIn, look, seat }
    this.hostId = null;
    this.bets = {};      // id -> { key: amount }
    this.lastBets = {};
    this.phase = 'betting'; // betting | done
    this.round = 0;
    this.spin = null;    // { n, color } of the round just spun
    this.pays = {};      // id -> { staked, back, net, wins: [{ key, bet, net }] }
    this.history = [];   // numbers, newest last
    this.spins = [];     // finished spins with their seeds, for checking
    this.log = [];
    this.betStart = null;
    this.ready = {};     // id -> true: who has pressed Spin for the coming spin
    this.bankId = null;  // the player who is the dealer; null = house, practice, frozen ledger
    this.base = {};      // while frozen: each player's real balance, kept aside
    this.fair = { next: newCommit(), seeds: {} };
    this.updateSettings(settings);
  }
  updateSettings(patch = {}) {
    const s = { ...this.settings, ...patch };
    s.minBet = clampInt(s.minBet, 1, 1e6, this.settings.minBet);
    s.maxInside = clampInt(s.maxInside, s.minBet, MAX_CHIPS, Math.max(s.minBet, this.settings.maxInside));
    s.maxOutside = clampInt(s.maxOutside, s.minBet, MAX_CHIPS, Math.max(s.minBet, this.settings.maxOutside));
    s.startChips = clampInt(s.startChips, 1, MAX_CHIPS, this.settings.startChips);
    s.betTime = [0, 10, 15, 20, 30, 45, 60].includes(Number(s.betTime)) ? Number(s.betTime) : this.settings.betTime;
    this.settings = s;
  }
  addLog(line) { this.log.push(line); if (this.log.length > 200) this.log.splice(0, this.log.length - 200); }
  mustPlayer(id) { const p = this.players[id]; if (!p || p.kicked) throw new Error('Join the table first.'); return p; }

  join(id, name, look) {
    let p = this.players[id];
    const clean = String(name || 'Player').replace(/[<>]/g, '').trim().slice(0, 16) || 'Player';
    if (p) { p.connected = true; p.quiet = false; p.name = clean; if (look) p.look = look; if (p.seat < 0) p.seat = this.freeSeat(); return p; }
    p = { id, name: clean, connected: true, chips: this.settings.startChips, totalIn: this.settings.startChips, look: look || { skin: 2, hair: 0 }, seat: this.freeSeat() };
    this.players[id] = p;
    bankJoin(this, p);
    if (!this.hostId) this.hostId = id;
    this.addLog(`${clean} joined with ${this.settings.startChips}.`);
    return p;
  }
  freeSeat() { const used = new Set(Object.values(this.players).filter((p) => !p.kicked).map((p) => p.seat)); for (let i = 0; i < ROU_SEATS; i++) if (!used.has(i)) return i; return -1; }
  disconnect(id) { const p = this.players[id]; if (p) p.connected = false; delete this.ready[id]; this.spinIfAll(); }
  kick(id) { const p = this.players[id]; if (!p) return; bankGone(this, id); this.clearBets(id, true); p.kicked = true; p.connected = false; p.seat = -1; delete this.ready[id]; this.spinIfAll(); }
  // The wheel turns once every seated player who is online has pressed Spin. A player who is offline is not waited for.
  voters() { return Object.values(this.players).filter((p) => !p.kicked && p.connected && !p.quiet && p.seat >= 0).map((p) => p.id); }
  // A player whose browser has gone silent (closed lid, lost network) before the link is seen to drop: not waited for.
  setQuiet(id, q) { const p = this.players[id]; if (!p || !!p.quiet === !!q) return false; p.quiet = !!q; if (q) delete this.ready[id]; this.spinIfAll(); return true; }
  waitingFor() { return this.voters().filter((id) => !this.ready[id]); }
  pressSpin(id) {
    const p = this.mustPlayer(id);
    if (p.seat < 0) throw new Error('Only seated players start the spin.');
    if (this.phase !== 'betting') throw new Error('The wheel is already turning.');
    if (this.ready[id]) { delete this.ready[id]; return false; } // a second press takes it back
    if (!this.canSpin()) throw new Error('Place a bet first.');
    this.ready[id] = true;
    return this.spinIfAll();
  }
  spinIfAll() {
    if (this.phase !== 'betting') return false;
    if (!this.canSpin()) { this.ready = {}; return false; }
    const v = this.voters();
    if (!v.length || !Object.keys(this.ready).length || v.some((id) => !this.ready[id])) return false;
    this.doSpin();
    return true;
  }
  addChips(id, amount) {
    const p = this.mustPlayer(id);
    amount = clampInt(amount, 1, MAX_CHIPS, 0);
    if (!amount) throw new Error('Pick an amount of at least 1.');
    p.chips = r2(p.chips + amount); p.totalIn += amount;
    this.addLog(`${p.name} added ${amount} (now ${p.chips}).`);
  }
  takeChips(id, amount) {
    const p = this.mustPlayer(id);
    amount = clampInt(amount, 1, MAX_CHIPS, 0);
    if (!amount || amount > p.chips) throw new Error('You do not have that many chips.');
    p.chips = r2(p.chips - amount); p.totalIn -= amount;
    this.addLog(`${p.name} took ${amount} off the table (now ${p.chips}).`);
  }
  // ---- the dealer (see bank.js) ----
  get frozen() { return isFrozen(this); }
  setBank(id) { setBank(this, id); }
  clearBank(byId) { clearBank(this, byId); }
  ledgerSum() { return ledgerSum(this); }
  setClientSeed(id, seed, commit) {
    if (!this.players[id] || commit !== this.fair.next.commit) return;
    this.fair.seeds[id] = String(seed).replace(/[^0-9a-zA-Z]/g, '').slice(0, 64);
  }

  staked(id) { const b = this.bets[id]; return b ? Object.values(b).reduce((a, x) => a + x, 0) : 0; }
  bet(id, key, amount) {
    const p = this.mustPlayer(id);
    if (this.phase !== 'betting') throw new Error('Bets open again after this spin.');
    key = String(key);
    if (!betNumbers(key)) throw new Error('No such bet.');
    if (p.seat < 0) throw new Error('The table is full. You can watch.');
    if (id === this.bankId) throw new Error('You are the dealer. The dealer does not bet.');
    amount = Math.round(Number(amount));
    if (!Number.isFinite(amount) || amount < 1) throw new Error('Pick a chip first.');
    const b = (this.bets[id] ||= {}), have = b[key] || 0, max = isOutside(key) ? this.settings.maxOutside : this.settings.maxInside;
    if (have + amount > max) amount = max - have;
    if (amount <= 0) throw new Error(`The most on ${betName(key)} is ${max}.`);
    if (amount > p.chips) amount = Math.floor(p.chips);
    if (amount <= 0) throw new Error('You have no chips left. Add chips first.');
    if (have + amount < this.settings.minBet) throw new Error(`The smallest bet is ${this.settings.minBet}.`);
    if (!have && Object.keys(b).length >= 60) throw new Error('That is the most separate bets for one spin.');
    p.chips = r2(p.chips - amount); b[key] = have + amount;
    if (this.betStart === null) this.betStart = Date.now();
  }
  clearBets(id, quiet = false) {
    const p = this.players[id], b = this.bets[id];
    if (!p || !b) return;
    if (this.phase !== 'betting') { if (!quiet) throw new Error('The ball is rolling.'); return; }
    p.chips = r2(p.chips + this.staked(id));
    delete this.bets[id];
    if (!Object.keys(this.bets).some((k) => this.staked(k) > 0)) this.betStart = null;
  }
  // Take the last chip placed on one bet back off.
  unbet(id, key) {
    const p = this.players[id], b = this.bets[id];
    if (!p || !b || !b[key] || this.phase !== 'betting') return;
    p.chips = r2(p.chips + b[key]); delete b[key];
    if (!Object.keys(b).length) delete this.bets[id];
    if (!Object.keys(this.bets).some((k) => this.staked(k) > 0)) this.betStart = null;
  }
  rebet(id) {
    const last = this.lastBets[id];
    if (!last) throw new Error('No bet from the spin before.');
    if (this.staked(id) > 0) throw new Error('Clear your bets first.');
    for (const [k, v] of Object.entries(last)) this.bet(id, k, v);
  }
  canSpin() { return this.phase === 'betting' && Object.keys(this.bets).some((id) => this.staked(id) > 0); }
  chipsTotal() { return r2(Object.values(this.players).reduce((a, p) => a + p.chips, 0) + Object.keys(this.bets).reduce((a, id) => a + this.staked(id), 0)); }

  doSpin() {
    if (!this.canSpin()) throw new Error('Place a bet first.');
    const f = this.fair, seeds = {};
    // Every player's seed counts except the host's own: the host knows the hidden seed, so its own could be picked to fit.
    for (const id of Object.keys(f.seeds).sort()) if (id !== this.hostId) seeds[id] = f.seeds[id];
    const n = spinNumber(f.next.seed, seeds);
    this.round++;
    this.spins.push({ round: this.round, commit: f.next.commit, serverSeed: f.next.seed, clientSeeds: seeds, n });
    if (this.spins.length > 40) this.spins.shift();
    f.next = newCommit(); f.seeds = {};
    this.spin = { n, color: colorOf(n) };
    this.pays = {};
    let allStaked = 0, allBack = 0;
    const before = this.ledgerSum();
    for (const id of Object.keys(this.bets)) {
      const p = this.players[id], staked = this.staked(id);
      if (!p || !staked) continue;
      let back = 0; const wins = [];
      for (const [key, bet] of Object.entries(this.bets[id])) {
        if (betNumbers(key).includes(n)) { const w = r2(bet * betPays(key)); back += bet + w; wins.push({ key, bet, net: w }); }
      }
      back = r2(back);
      p.chips = r2(p.chips + back);
      this.pays[id] = { staked, back, net: r2(back - staked), wins };
      this.lastBets[id] = { ...this.bets[id] };
      allStaked = r2(allStaked + staked); allBack = r2(allBack + back);
    }
    this.roundFrozen = this.frozen;
    if (!this.frozen) this.pays[this.bankId] = bankSettle(this, allStaked, allBack);
    this.bets = {}; // the stakes are settled; the ledger is read below
    { const off = r2(this.ledgerSum() - before); if (off && this.players[this.bankId]) this.players[this.bankId].chips = r2(this.players[this.bankId].chips - off); } // a rounding cent, if any, is the dealer's: the ledger stays at zero
    this.addLog(`Spin ${this.round}: ${n} ${this.spin.color}.`);
    for (const [id, pay] of Object.entries(this.pays)) this.addLog(pay.bank ? `  ${this.players[id].name} (dealer): ${pay.net > 0 ? 'won ' + pay.net : pay.net < 0 ? 'paid ' + -pay.net : 'no change'}.` : `  ${this.players[id].name}: bet ${pay.staked}, ${pay.net > 0 ? 'won ' + pay.net : pay.net < 0 ? 'lost ' + -pay.net : 'no change'}${this.roundFrozen ? ' (practice)' : ''}.`);
    this.history.push(n);
    if (this.history.length > 200) this.history.shift();
    this.bets = {};
    this.betStart = null;
    this.ready = {};
    this.phase = 'done';
    this.doneAt = Date.now();
  }
  next() { if (this.phase !== 'done') return; this.phase = 'betting'; this.spin = null; this.pays = {}; this.betStart = null; this.ready = {}; }

  // What everyone is told. The seed of the coming spin is never in it; the seed of a finished spin is.
  publicState(forId) {
    const totals = {};
    for (const b of Object.values(this.bets)) for (const [k, v] of Object.entries(b)) totals[k] = (totals[k] || 0) + v;
    return {
      game: 'roulette', settings: this.settings, phase: this.phase, round: this.round, hostId: this.hostId, spin: this.spin, pays: this.pays,
      bets: this.bets, lastBets: this.lastBets, totals, canSpin: this.canSpin(), ready: Object.keys(this.ready), waiting: this.waitingFor(), history: this.history.slice(-60),
      betLeft: this.betStart !== null && this.settings.betTime ? Math.max(0, this.settings.betTime * 1000 - (Date.now() - this.betStart)) : null,
      players: Object.values(this.players).filter((p) => !p.kicked).map((p) => ({ id: p.id, name: p.name, connected: p.connected, chips: p.chips, totalIn: p.totalIn, look: p.look, seat: p.seat, away: !!p.quiet, net: ledgerNet(this, p), base: this.base?.[p.id] || null })),
      bankId: this.bankId, frozen: this.frozen, roundFrozen: !!this.roundFrozen, ledgerSum: this.ledgerSum(),
      fair: { nextCommit: this.fair.next.commit, mySeed: !!this.fair.seeds[forId], seeds: Object.keys(this.fair.seeds).filter((id) => id !== this.hostId).length, spins: this.spins.slice(-25) },
      log: this.log.slice(-50),
    };
  }
  static restore(j) { const t = new RouTable(); Object.assign(t, j); if (!t.ready) t.ready = {}; if (!('bankId' in j)) t.base = null; bankAdopt(t); return t; }
  // Another player's browser takes the table over from what everyone is told. Chips and bets stay.
  static fromPublic(st, myId) {
    const t = new RouTable(st.settings);
    Object.assign(t, { hostId: myId, phase: st.phase, round: st.round, spin: st.spin, pays: st.pays || {}, bets: JSON.parse(JSON.stringify(st.bets || {})), lastBets: st.lastBets || {},
      history: [...(st.history || [])], log: [...(st.log || [])], spins: [...(st.fair?.spins || [])] });
    for (const p of st.players) t.players[p.id] = { id: p.id, name: p.name, connected: p.id === myId, chips: p.chips, totalIn: p.totalIn, look: p.look || { skin: 2, hair: 0 }, seat: p.seat };
    t.bankId = st.bankId || null; t.base = {}; t.roundFrozen = !!st.roundFrozen;
    for (const id of st.ready || []) t.ready[id] = true;
    for (const p of st.players) if (p.base) t.base[p.id] = { ...p.base };
    if (!('bankId' in st)) { t.base = null; bankAdopt(t); }
    if (t.canSpin()) t.betStart = Date.now();
    if (t.phase === 'done') t.doneAt = Date.now();
    return t;
  }
}
