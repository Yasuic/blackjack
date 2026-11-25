// Locked cards for poker ("mental poker"). Every player's browser puts its own lock on every card and
// shuffles, so the order of the deck is known to nobody, the host included. A card opens only when every
// lock on it is taken off: a player's own cards open in that player's browser alone, a board card opens
// for everyone once every browser has given its key for it.
//
// The locks are multiplications on the elliptic curve secp256k1: a card is a point P, a lock is a secret
// number a, the locked card is a·P. Locks can be put on and taken off in any order (a·(b·P) = b·(a·P)),
// and taking a lock off is multiplying by the inverse of a. Without the number, a·P says nothing about P.
import { SUITS, RANKS, sha256 } from './game.js?v=20261124s';

const P = 2n ** 256n - 2n ** 32n - 977n;
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const md = (a) => { a %= P; return a < 0n ? a + P : a; };
function powm(b, e, m) { let r = 1n; b %= m; while (e > 0n) { if (e & 1n) r = (r * b) % m; b = (b * b) % m; e >>= 1n; } return r; }
function inv(a, m) { let t = 0n, nt = 1n, r = m, nr = ((a % m) + m) % m; while (nr) { const q = r / nr; [t, nt] = [nt, t - q * nt]; [r, nr] = [nr, r - q * nr]; } if (r !== 1n) throw new Error('no inverse'); return ((t % m) + m) % m; }
// Points in Jacobian form [X, Y, Z]; Z = 0 is the point at infinity.
function dbl([X, Y, Z]) { if (Z === 0n || Y === 0n) return [0n, 1n, 0n]; const YY = md(Y * Y), S = md(4n * X * YY), M = md(3n * X * X), X3 = md(M * M - 2n * S); return [X3, md(M * (S - X3) - 8n * YY * YY), md(2n * Y * Z)]; }
function add(p, q) {
  const [X1, Y1, Z1] = p, [X2, Y2, Z2] = q;
  if (Z1 === 0n) return q; if (Z2 === 0n) return p;
  const Z1Z1 = md(Z1 * Z1), Z2Z2 = md(Z2 * Z2), U1 = md(X1 * Z2Z2), U2 = md(X2 * Z1Z1), S1 = md(Y1 * Z2 * Z2Z2), S2 = md(Y2 * Z1 * Z1Z1);
  if (U1 === U2) return S1 === S2 ? dbl(p) : [0n, 1n, 0n];
  const H = md(U2 - U1), R = md(S2 - S1), HH = md(H * H), HHH = md(H * HH), V = md(U1 * HH), X3 = md(R * R - HHH - 2n * V);
  return [X3, md(R * (V - X3) - S1 * HHH), md(H * Z1 * Z2)];
}
function mul(pt, k) {
  k = ((k % N) + N) % N;
  const tbl = [[0n, 1n, 0n], pt]; for (let i = 2; i < 16; i++) tbl.push(add(tbl[i - 1], pt));
  let r = [0n, 1n, 0n];
  for (const ch of k.toString(16).padStart(64, '0')) { r = dbl(dbl(dbl(dbl(r)))); const d = parseInt(ch, 16); if (d) r = add(r, tbl[d]); }
  return r;
}
function affine([X, Y, Z]) { if (Z === 0n) throw new Error('bad point'); const zi = inv(Z, P), z2 = md(zi * zi); return [md(X * z2), md(Y * z2 * zi)]; }
const onCurve = (x, y) => md(y * y) === md(x * x * x + 7n);
// A point as text: 64 hex digits of x and one digit for the parity of y.
const enc = ([x, y]) => x.toString(16).padStart(64, '0') + (y & 1n ? '1' : '0');
function dec(s) {
  if (typeof s !== 'string' || !/^[0-9a-f]{65}$/.test(s)) throw new Error('bad point');
  const x = BigInt('0x' + s.slice(0, 64)); if (x >= P) throw new Error('bad point');
  let y = powm(md(x * x * x + 7n), (P + 1n) / 4n, P);
  if (!onCurve(x, y)) throw new Error('bad point');
  if ((y & 1n) !== BigInt(s[64] === '1' ? 1 : 0)) y = P - y;
  return [x, y, 1n];
}
const hexN = (k) => k.toString(16).padStart(64, '0');
const numN = (s) => { if (typeof s !== 'string' || !/^[0-9a-f]{1,64}$/.test(s)) throw new Error('bad key'); const k = BigInt('0x' + s) % N; if (!k) throw new Error('bad key'); return k; };

// The 52 cards as points. Each comes from a hash of the card's name, so nobody knows any link between them.
const CARDS = [];
for (const s of SUITS) for (const r of RANKS) CARDS.push({ r, s });
let BASE = null, BYX = null;
function base() {
  if (BASE) return BASE;
  BASE = []; BYX = new Map();
  CARDS.forEach((c, i) => {
    for (let ctr = 0; ; ctr++) {
      const x = BigInt('0x' + sha256(`poker card ${c.r}${c.s} ${ctr}`)) % P, rhs = md(x * x * x + 7n), y = powm(rhs, (P + 1n) / 4n, P);
      if (md(y * y) === rhs) { BASE.push(enc([x, y])); BYX.set(x.toString(16).padStart(64, '0'), i); break; }
    }
  });
  return BASE;
}
export function plainDeck() { return [...base()]; }

function randScalar() {
  const b = new Uint8Array(40); crypto.getRandomValues(b);
  const k = BigInt('0x' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')) % (N - 1n);
  return k + 1n;
}
function shuffleInPlace(a) {
  const r = new Uint32Array(a.length); crypto.getRandomValues(r);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor((r[i] / 4294967296) * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
// A deck as it travels: 52 distinct points on the curve.
export function checkDeck(deck) {
  if (!Array.isArray(deck) || deck.length !== 52 || new Set(deck).size !== 52) return false;
  try { for (const s of deck) dec(s); } catch { return false; }
  return true;
}
// Step one, in turn in every browser: lock every card with one number and shuffle.
export function shufflePass(deck) {
  if (!checkDeck(deck)) throw new Error('bad deck');
  const a = randScalar();
  const out = shuffleInPlace(deck.map((s) => enc(affine(mul(dec(s), a)))));
  return { deck: out, a: hexN(a) };
}
// Step two, in turn in every browser: swap the one number for a new number on each card.
export function lockPass(deck, aHex) {
  if (!checkDeck(deck)) throw new Error('bad deck');
  const ai = inv(numN(aHex), N), b = [];
  const out = deck.map((s) => { const k = randScalar(); b.push(hexN(k)); return enc(affine(mul(dec(s), (k * ai) % N))); });
  return { deck: out, b };
}
// The key that takes this browser's lock off one card.
export function keyFor(bHex) { return hexN(inv(numN(bHex), N)); }
// Opens a locked card with every lock's key. Returns the card, or null if the keys do not open it.
export function openCard(point, keys) {
  try {
    let k = 1n; for (const s of keys) k = (k * numN(s)) % N;
    const [x] = affine(mul(dec(point), k));
    const i = BYX.get(x.toString(16).padStart(64, '0'));
    return i === undefined ? null : { ...CARDS[i] };
  } catch { return null; }
}
base();
