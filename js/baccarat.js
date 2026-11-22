// Baccarat (punto banco) for up to 9 players against the house. Pure rules: the host's browser owns one
// BacTable and every bet goes through it. Nothing here touches the page or the network.
import { sha256, fairShoe, MAX_CHIPS } from './game.js?v=20261122j';
import { isFrozen, bankJoin, setBank, clearBank, bankGone, bankSettle, ledgerNet, ledgerSum, bankAdopt } from './bank.js?v=20261122j';

export const BAC_SEATS = 9;
export const BAC_DEFAULTS = {
  minBet: 1,         // smallest bet on a spot
  maxBet: 500,       // largest bet on Player or Banker
  maxSide: 100,      // largest bet on Tie or a pair
  startChips: 1000,  // chips a new player gets
  betTime: 15,       // seconds from the first bet to the deal (0 = the host deals by hand)
  decks: 8,
};
// What each spot pays for 1 chip bet. Banker pays 0.95 (the house keeps 5% of a Banker win).
export const BAC_SPOTS = {
  player: { name: 'Player', pays: 1, text: '1 to 1' },
  banker: { name: 'Banker', pays: 0.95, text: '0.95 to 1' },
  tie: { name: 'Tie', pays: 8, text: '8 to 1' },
  ppair: { name: 'Player pair', pays: 11, text: '11 to 1' },
  bpair: { name: 'Banker pair', pays: 11, text: '11 to 1' },
};
export const BAC_KEYS = Object.keys(BAC_SPOTS);
const r2 = (x) => Math.round(x * 100) / 100;
const clampInt = (v, lo, hi, dflt) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt; };
export const cardText = (c) => c.r + c.s;
// Ace counts 1, tens and pictures count 0, the rest their number. A hand's total is the last digit of the sum.
export const bacValue = (c) => (c.r === 'A' ? 1 : ['10', 'J', 'Q', 'K'].includes(c.r) ? 0 : Number(c.r));
export const bacTotal = (cs) => cs.reduce((a, c) => a + bacValue(c), 0) % 10;

// One round from a source of cards. Deal order: Player, Banker, Player, Banker. An 8 or 9 on either side
// (a natural) ends it. Otherwise Player draws on 0 to 5; Banker then follows the fixed third card table.
export function bacRound(draw) {
  const P = [draw()], B = [draw()];
  P.push(draw()); B.push(draw());
  const pt = bacTotal(P), bt = bacTotal(B);
  const natural = pt >= 8 || bt >= 8;
  if (!natural) {
    let p3 = null;
    if (pt <= 5) { p3 = draw(); P.push(p3); }
    if (p3 === null) { if (bt <= 5) B.push(draw()); }
    else {
      const v = bacValue(p3);
      const hit = bt <= 2 || (bt === 3 && v !== 8) || (bt === 4 && v >= 2 && v <= 7) || (bt === 5 && v >= 4 && v <= 7) || (bt === 6 && (v === 6 || v === 7));
      if (hit) B.push(draw());
    }
  }
  const fp = bacTotal(P), fb = bacTotal(B);
  return { P, B, pt: fp, bt: fb, natural, winner: fp > fb ? 'player' : fb > fp ? 'banker' : 'tie', ppair: P[0].r === P[1].r, bpair: B[0].r === B[1].r };
}
// What a set of bets gets back (stake included) for a result.
export function bacPay(bets, res) {
  let back = 0;
  const lines = [];
  const win = (k) => { const b = bets[k] || 0; if (!b) return; const w = r2(b * BAC_SPOTS[k].pays); back += b + w; lines.push({ spot: k, bet: b, net: w }); };
  const lose = (k) => { const b = bets[k] || 0; if (b) lines.push({ spot: k, bet: b, net: -b }); };
  const push = (k) => { const b = bets[k] || 0; if (b) { back += b; lines.push({ spot: k, bet: b, net: 0 }); } };
  if (res.winner === 'tie') { push('player'); push('banker'); win('tie'); }
  else { (res.winner === 'player' ? win : lose)('player'); (res.winner === 'banker' ? win : lose)('banker'); lose('tie'); }
  (res.ppair ? win : lose)('ppair');
  (res.bpair ? win : lose)('bpair');
  return { back: r2(back), lines };
}

function randomSeed() {
  const buf = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < 32; i++) buf[i] = Math.floor(Math.random() * 256);
  return Array.from(buf, (x) => x.toString(16).padStart(2, '0')).join('');
}
const newCommit = () => { const seed = randomSeed(); return { seed, commit: sha256(seed) }; };
// Check a finished shoe: the seed matches the code shown before it, and it gives the cards that were dealt.
export function verifyShoe(rec) {
  if (!rec || !rec.serverSeed || sha256(rec.serverSeed) !== rec.commit) return { ok: false, why: 'The seed does not match the code shown before the shoe.' };
  const shoe = fairShoe(rec.decks, rec.serverSeed, rec.clientSeeds);
  for (const c of rec.dealt) { const d = shoe.pop(); if (!d || d.r !== c.r || d.s !== c.s) return { ok: false, why: 'The cards dealt are not the cards this seed gives.' }; }
  return { ok: true };
}

export class BacTable {
  constructor(settings = {}) {
    this.settings = { ...BAC_DEFAULTS };
    this.players = {};   // id -> { id, name, connected, chips, totalIn, look, seat }
    this.hostId = null;
    this.bets = {};      // id -> { player, banker, tie, ppair, bpair }
    this.lastBets = {};
    this.phase = 'betting'; // betting | done
    this.round = 0;
    this.hand = null;    // the cards and result of the round just dealt
    this.pays = {};      // id -> { staked, back, net, lines }
    this.history = [];   // results, newest last
    this.log = [];
    this.betStart = null;
    this.shoe = [];
    this.shoeNo = 0;
    this.cur = null;     // the shoe in play: { shoe, commit, serverSeed, clientSeeds, decks, dealt }
    this.past = [];      // finished shoes with their seeds open
    this.bankId = null;  // the player who is the dealer; null = house, practice, frozen ledger
    this.base = {};      // while frozen: each player's real balance, kept aside
    this.fair = { next: newCommit(), seeds: {} };
    this.updateSettings(settings);
  }
  updateSettings(patch = {}) {
    const s = { ...this.settings, ...patch };
    s.minBet = clampInt(s.minBet, 1, 1e6, this.settings.minBet);
    s.maxBet = clampInt(s.maxBet, s.minBet, MAX_CHIPS, Math.max(s.minBet, this.settings.maxBet));
    s.maxSide = clampInt(s.maxSide, s.minBet, MAX_CHIPS, Math.max(s.minBet, this.settings.maxSide));
    s.startChips = clampInt(s.startChips, 1, MAX_CHIPS, this.settings.startChips);
    s.betTime = [0, 8, 10, 15, 20, 30, 45, 60].includes(Number(s.betTime)) ? Number(s.betTime) : this.settings.betTime;
    s.decks = [6, 8].includes(Number(s.decks)) ? Number(s.decks) : this.settings.decks;
    this.settings = s;
  }
  addLog(line) { this.log.push(line); if (this.log.length > 200) this.log.splice(0, this.log.length - 200); }
  mustPlayer(id) { const p = this.players[id]; if (!p || p.kicked) throw new Error('Join the table first.'); return p; }

  // ---- people ----
  join(id, name, look) {
    let p = this.players[id];
    const clean = String(name || 'Player').replace(/[<>]/g, '').trim().slice(0, 16) || 'Player';
    if (p) { p.connected = true; p.name = clean; if (look) p.look = look; if (p.seat < 0) p.seat = this.freeSeat(); return p; }
    p = { id, name: clean, connected: true, chips: this.settings.startChips, totalIn: this.settings.startChips, look: look || { skin: 2, hair: 0 }, seat: this.freeSeat() };
    this.players[id] = p;
    bankJoin(this, p);
    if (!this.hostId) this.hostId = id;
    this.addLog(`${clean} joined with ${this.settings.startChips}.`);
    return p;
  }
  freeSeat() { const used = new Set(Object.values(this.players).filter((p) => !p.kicked).map((p) => p.seat)); for (let i = 0; i < BAC_SEATS; i++) if (!used.has(i)) return i; return -1; }
  disconnect(id) { const p = this.players[id]; if (p) p.connected = false; }
  kick(id) { const p = this.players[id]; if (!p) return; bankGone(this, id); this.clearBets(id, true); p.kicked = true; p.connected = false; p.seat = -1; }
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

  // ---- betting ----
  betOf(id) { return (this.bets[id] ||= { player: 0, banker: 0, tie: 0, ppair: 0, bpair: 0 }); }
  staked(id) { const b = this.bets[id]; return b ? BAC_KEYS.reduce((a, k) => a + (b[k] || 0), 0) : 0; }
  bet(id, spot, amount) {
    const p = this.mustPlayer(id);
    if (this.phase !== 'betting') throw new Error('Bets open again after this round.');
    if (!BAC_SPOTS[spot]) throw new Error('No such bet.');
    if (p.seat < 0) throw new Error('The table is full. You can watch.');
    if (id === this.bankId) throw new Error('You are the dealer. The dealer does not bet.');
    amount = Math.round(Number(amount));
    if (!Number.isFinite(amount) || amount < 1) throw new Error('Pick a chip first.');
    const b = this.betOf(id), max = spot === 'player' || spot === 'banker' ? this.settings.maxBet : this.settings.maxSide;
    if (b[spot] + amount > max) amount = max - b[spot];
    if (amount <= 0) throw new Error(`The most on ${BAC_SPOTS[spot].name} is ${max}.`);
    if (amount > p.chips) amount = Math.floor(p.chips);
    if (amount <= 0) throw new Error('You have no chips left. Add chips first.');
    if (b[spot] + amount < this.settings.minBet) throw new Error(`The smallest bet is ${this.settings.minBet}.`);
    p.chips = r2(p.chips - amount); b[spot] += amount;
    if (this.betStart === null) this.betStart = Date.now();
  }
  clearBets(id, quiet = false) {
    const p = this.players[id], b = this.bets[id];
    if (!p || !b) return;
    if (this.phase !== 'betting' && !quiet) throw new Error('The cards are out.');
    if (this.phase !== 'betting') return;
    p.chips = r2(p.chips + this.staked(id));
    delete this.bets[id];
    if (!Object.keys(this.bets).some((k) => this.staked(k) > 0)) this.betStart = null;
  }
  rebet(id) {
    const last = this.lastBets[id];
    if (!last) throw new Error('No bet from the round before.');
    if (this.staked(id) > 0) throw new Error('Clear your bets first.');
    for (const k of BAC_KEYS) if (last[k]) this.bet(id, k, last[k]);
  }
  canDeal() { return this.phase === 'betting' && Object.keys(this.bets).some((id) => this.staked(id) > 0); }
  chipsTotal() { return r2(Object.values(this.players).reduce((a, p) => a + p.chips, 0) + Object.keys(this.bets).reduce((a, id) => a + this.staked(id), 0)); }

  // ---- the shoe ----
  newShoe() {
    if (this.cur) { this.past.push({ ...this.cur }); if (this.past.length > 6) this.past.shift(); }
    const f = this.fair, seeds = {};
    // Every player's seed counts except the host's own: the host knows the hidden seed, so its own could be picked to fit.
    for (const id of Object.keys(f.seeds).sort()) if (id !== this.hostId) seeds[id] = f.seeds[id];
    this.shoeNo++;
    this.cur = { shoe: this.shoeNo, commit: f.next.commit, serverSeed: f.next.seed, clientSeeds: seeds, decks: this.settings.decks, dealt: [] };
    this.shoe = fairShoe(this.settings.decks, f.next.seed, seeds);
    f.next = newCommit(); f.seeds = {};
    this.addLog(`New shoe: ${this.settings.decks} decks shuffled.`);
  }
  draw() { const c = this.shoe.pop(); this.cur.dealt.push(c); return c; }

  // ---- a round ----
  deal() {
    if (!this.canDeal()) throw new Error('Place a bet first.');
    if (!this.cur || this.shoe.length < 16) this.newShoe();
    this.round++;
    const res = bacRound(() => this.draw());
    // The cards are dealt face down. Nobody's browser is told a card before it is turned over, except the player
    // who peels that side (the largest bet on Player or on Banker), who is told only the cards of that side.
    const top = (spot) => { let best = null, amt = 0; for (const id of Object.keys(this.bets)) { const b = this.bets[id][spot] || 0; if (b > amt && this.players[id] && !this.players[id].kicked) { amt = b; best = id; } } return best; };
    this.full = res;
    this.peel = { stage: 1, open: { P0: false, B0: false, P1: false, B1: false }, who: { P: BacTable.noPeel ? null : top('player'), B: BacTable.noPeel ? null : top('banker') }, at: Date.now(), last: Date.now() };
    this.hand = null;
    this.phase = 'peel';
    if (BacTable.noPeel) { for (const k of Object.keys(this.peel.open)) this.peel.open[k] = true; this.peelAdvance(); }
  }
  // The keys of the cards on the table now, in the order they are turned when nobody peels them.
  peelKeys() { return this.peel ? ['P0', 'B0', 'P1', 'B1', 'P2', 'B2'].filter((k) => k in this.peel.open) : []; }
  // A player turns one card of the side they peel.
  openCard(id, key) {
    if (this.phase !== 'peel' || !(key in this.peel.open) || this.peel.open[key]) return false;
    if (this.peel.who[key[0]] !== id) throw new Error('This card is not yours to turn.');
    this.peel.open[key] = true; this.peel.last = Date.now();
    this.peelAdvance();
    return true;
  }
  // The host's clock: cards nobody peels turn one by one, and a peeler who takes too long has the cards turned for them.
  peelTick(now = Date.now(), wait = 12000, step = 650) {
    if (this.phase !== 'peel') return false;
    const closed = this.peelKeys().filter((k) => !this.peel.open[k]);
    const auto = closed.find((k) => !this.peel.who[k[0]] || this.players[this.peel.who[k[0]]]?.connected === false || now - this.peel.at >= wait);
    if (!auto || now - this.peel.last < step) return false;
    this.peel.open[auto] = true; this.peel.last = now;
    this.peelAdvance();
    return true;
  }
  peelAdvance() {
    const p = this.peel;
    if (Object.values(p.open).some((v) => !v)) return;
    if (p.stage === 1 && (this.full.P[2] || this.full.B[2])) {
      p.stage = 2; p.at = Date.now(); p.last = Date.now();
      if (this.full.P[2]) p.open.P2 = false;
      if (this.full.B[2]) p.open.B2 = false;
      if (BacTable.noPeel) { for (const k of Object.keys(p.open)) p.open[k] = true; this.finish(); }
      return;
    }
    this.finish();
  }
  // Every card is face up: pay the bets.
  finish() {
    const res = this.full;
    this.full = null; this.peel = null;
    this.hand = res;
    this.pays = {};
    let allStaked = 0, allBack = 0;
    const before = this.ledgerSum();
    for (const id of Object.keys(this.bets)) {
      const p = this.players[id], staked = this.staked(id);
      if (!p || !staked) continue;
      const { back, lines } = bacPay(this.bets[id], res);
      p.chips = r2(p.chips + back);
      this.pays[id] = { staked, back, net: r2(back - staked), lines };
      this.lastBets[id] = { ...this.bets[id] };
      allStaked = r2(allStaked + staked); allBack = r2(allBack + back);
    }
    this.roundFrozen = this.frozen;
    if (!this.frozen) this.pays[this.bankId] = bankSettle(this, allStaked, allBack);
    this.bets = {}; // the stakes are settled; the ledger is read below
    { const off = r2(this.ledgerSum() - before); if (off && this.players[this.bankId]) this.players[this.bankId].chips = r2(this.players[this.bankId].chips - off); } // a rounding cent, if any, is the dealer's: the ledger stays at zero
    const who = res.winner === 'tie' ? 'Tie' : res.winner === 'player' ? 'Player wins' : 'Banker wins';
    this.addLog(`Round ${this.round}: Player ${res.P.map(cardText).join(' ')} (${res.pt}), Banker ${res.B.map(cardText).join(' ')} (${res.bt}). ${who}${res.natural ? ' with a natural' : ''}${res.ppair ? ', Player pair' : ''}${res.bpair ? ', Banker pair' : ''}.`);
    for (const [id, pay] of Object.entries(this.pays)) this.addLog(pay.bank ? `  ${this.players[id].name} (dealer): ${pay.net > 0 ? 'won ' + pay.net : pay.net < 0 ? 'paid ' + -pay.net : 'no change'}.` : `  ${this.players[id].name}: bet ${pay.staked}, ${pay.net > 0 ? 'won ' + pay.net : pay.net < 0 ? 'lost ' + -pay.net : 'no change'}${this.roundFrozen ? ' (practice)' : ''}.`);
    this.history.push({ w: res.winner[0], pp: res.ppair, bp: res.bpair, n: res.natural, pt: res.pt, bt: res.bt });
    if (this.history.length > 120) this.history.shift();
    this.bets = {};
    this.betStart = null;
    this.phase = 'done';
    this.doneAt = Date.now();
  }
  next() { if (this.phase !== 'done') return; this.phase = 'betting'; this.hand = null; this.pays = {}; this.betStart = null; }

  // ---- what everyone is told (never the shoe, never a seed of a shoe still in play) ----
  publicState(forId) {
    const tot = { player: 0, banker: 0, tie: 0, ppair: 0, bpair: 0 };
    for (const b of Object.values(this.bets)) for (const k of BAC_KEYS) tot[k] += b[k] || 0;
    return {
      game: 'baccarat', settings: this.settings, phase: this.phase, round: this.round, hostId: this.hostId, hand: this.phase === 'peel' ? this.peelView() : this.hand, pays: this.pays,
      peel: this.phase === 'peel' ? { stage: this.peel.stage, open: { ...this.peel.open }, who: { ...this.peel.who }, left: Math.max(0, 12000 - (Date.now() - this.peel.at)),
        mine: Object.fromEntries(this.peelKeys().filter((k) => !this.peel.open[k] && this.peel.who[k[0]] === forId).map((k) => [k, this.full[k[0]][Number(k[1])]])) } : null,
      bets: this.bets, lastBets: this.lastBets, totals: tot, canDeal: this.canDeal(), history: this.history.slice(-72),
      betLeft: this.betStart !== null && this.settings.betTime ? Math.max(0, this.settings.betTime * 1000 - (Date.now() - this.betStart)) : null,
      cardsLeft: undefined, shoeNo: this.shoeNo,
      players: Object.values(this.players).filter((p) => !p.kicked).map((p) => ({ id: p.id, name: p.name, connected: p.connected, chips: p.chips, totalIn: p.totalIn, look: p.look, seat: p.seat, net: ledgerNet(this, p), base: this.base?.[p.id] || null })),
      bankId: this.bankId, frozen: this.frozen, roundFrozen: !!this.roundFrozen, ledgerSum: this.ledgerSum(),
      fair: { nextCommit: this.fair.next.commit, mySeed: !!this.fair.seeds[forId], seeds: Object.keys(this.fair.seeds).filter((id) => id !== this.hostId).length,
        cur: this.cur ? { shoe: this.cur.shoe, commit: this.cur.commit, decks: this.cur.decks, dealt: this.cur.dealt.length - (this.full ? this.full.P.length + this.full.B.length : 0) } : null, // cards of a round still face down are not counted yet: the count would tell if a third card is coming
        past: this.past.map((r) => ({ shoe: r.shoe, commit: r.commit, serverSeed: r.serverSeed, clientSeeds: r.clientSeeds, decks: r.decks, dealt: r.dealt })) },
      log: this.log.slice(-50),
    };
  }
  // During the peel: only the cards already turned. A card still face down is null, and a third card not yet dealt is left out.
  peelView() {
    const side = (k) => this.peelKeys().filter((x) => x[0] === k).map((x) => (this.peel.open[x] ? this.full[k][Number(x[1])] : null));
    return { P: side('P'), B: side('B'), peel: true };
  }
  static restore(j) { const t = new BacTable(); Object.assign(t, j); if (!('bankId' in j)) t.base = null; bankAdopt(t); return t; }
  // The hidden part of the table for a host change: everything, without the long lists every player is told anyway.
  hidden() { return JSON.stringify({ ...this, log: [], past: [], history: [] }); }
  // Another player's browser takes the table over with the old host's hidden part, opened with the players' pieces
  // of the key (js/vault.js): the same shoe in the same order, the same cards of the round in play.
  static fromHidden(hid, st, myId) {
    if (!hid || !Array.isArray(hid.shoe) || hid.round !== st.round || hid.phase !== st.phase) throw new Error('The locked copy does not fit the table.');
    const t = BacTable.restore(hid), now = Date.now();
    t.hostId = myId;
    t.log = [...(st.log || [])]; t.history = [...(st.history || [])]; t.past = (st.fair?.past || []).map((r) => ({ ...r }));
    for (const p of Object.values(t.players)) p.connected = p.id === myId;
    if (t.peel) { t.peel.at = now; t.peel.last = now; }
    if (t.betStart) t.betStart = now;
    if (t.phase === 'done') t.doneAt = now;
    return t;
  }
  // Another player's browser takes the table over from what everyone is told. Chips, bets and results stay;
  // the cards still in the old shoe are gone with the old host, so a new shoe is shuffled.
  static fromPublic(st, myId) {
    const t = new BacTable(st.settings);
    Object.assign(t, { hostId: myId, phase: st.phase, round: st.round, hand: st.hand, pays: st.pays || {}, bets: JSON.parse(JSON.stringify(st.bets || {})), lastBets: st.lastBets || {},
      history: [...(st.history || [])], log: [...(st.log || [])], shoeNo: st.shoeNo || 0, past: (st.fair?.past || []).map((r) => ({ ...r })) });
    for (const p of st.players) t.players[p.id] = { id: p.id, name: p.name, connected: p.id === myId, chips: p.chips, totalIn: p.totalIn, look: p.look || { skin: 2, hair: 0 }, seat: p.seat };
    t.bankId = st.bankId || null; t.base = {}; t.roundFrozen = !!st.roundFrozen;
    for (const p of st.players) if (p.base) t.base[p.id] = { ...p.base };
    if (!('bankId' in st)) { t.base = null; bankAdopt(t); }
    if (t.phase === 'peel') {
      // A round is never called off and no bet goes back. Cards already turned stay as they are, and so do the
      // cards this player was peeling (their browser was told those). A card nobody but the old host had seen
      // is dealt from the new shoe, which is as random as the card it replaces. The third card rules are
      // applied again to the cards as they now are.
      const view = st.hand || { P: [], B: [] }, mine = st.peel?.mine || {}, open = st.peel?.open || { P0: false, B0: false, P1: false, B1: false };
      const known = (k) => mine[k] || (open[k] ? view[k[0]]?.[Number(k[1])] : null) || null;
      t.newShoe();
      // Once the third cards are on the table, everyone has seen how many there are. A third card dealt again
      // has to fit that: a new Player card that would change whether the Banker draws is passed over for the next one.
      const keys = ['P0', 'B0', 'P1', 'B1', ...['P2', 'B2'].filter((k) => k in open)], second = st.peel?.stage === 2;
      for (let n = 0; n < 120; n++) {
        const feed = keys.map(known);
        t.full = bacRound(() => feed.shift() || t.draw());
        if (!second || (!!t.full.P[2] === ('P2' in open) && !!t.full.B[2] === ('B2' in open))) break;
      }
      const stage = t.full.P[2] || t.full.B[2] ? (st.peel?.stage === 2 ? 2 : 1) : 1;
      t.peel = { stage, open: {}, who: { P: st.peel?.who?.P || null, B: st.peel?.who?.B || null }, at: Date.now(), last: Date.now() };
      for (const k of ['P0', 'B0', 'P1', 'B1']) t.peel.open[k] = !!open[k];
      if (stage === 2) { if (t.full.P[2]) t.peel.open.P2 = !!open.P2; if (t.full.B[2]) t.peel.open.B2 = !!open.B2; }
      t.hand = null;
      t.addLog('The table moved to a new host during a round. The round goes on with the same bets: cards already turned stay, and a card nobody had seen is dealt from the new shoe.');
    }
    if (t.canDeal()) t.betStart = Date.now();
    if (t.phase === 'done') t.doneAt = Date.now();
    return t;
  }
}
