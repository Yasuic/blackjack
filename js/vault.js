// Keeps the hidden part of a table (the shoe or deck still to come, its seeds, a face down card) safe for a host change.
// The host locks that hidden part with a key and sends the locked copy to the players. The key itself is cut into
// pieces (Shamir secret sharing over GF(256)), one piece per seated player, and more than half of the pieces are
// needed to put the key together again. One piece, or any group of half the players or fewer, learns nothing.
// When the host's browser goes away, the next host collects the pieces from the players who come back and opens
// the locked copy, so the game goes on with the same cards in the same order.
import { sha256 } from './game.js?v=20261122l';

const hex = (bytes) => Array.from(bytes, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s) => { const out = new Uint8Array(s.length >> 1); for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16); return out; };
function rand(n) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}
function mul(a, b) { let p = 0; for (let i = 0; i < 8; i++) { if (b & 1) p ^= a; const hi = a & 0x80; a = (a << 1) & 0xff; if (hi) a ^= 0x1b; b >>= 1; } return p; }
function inv(a) { let r = 1; for (let i = 0; i < 254; i++) r = mul(r, a); return r; }

export const piecesNeeded = (n) => Math.floor(n / 2) + 1; // more than half
export function newKey() { return { kid: hex(rand(6)), key: hex(rand(32)) }; }
// Cut a key into n pieces; any `need` of them give the key back. Piece number i (from 1) is the i-th entry.
export function splitKey(key, n, need) {
  const secret = unhex(key), out = Array.from({ length: n }, () => new Uint8Array(secret.length));
  for (let b = 0; b < secret.length; b++) {
    const co = [secret[b], ...rand(need - 1)];
    for (let x = 1; x <= n; x++) { let y = 0; for (let j = co.length - 1; j >= 0; j--) y = mul(y, x) ^ co[j]; out[x - 1][b] = y; }
  }
  return out.map(hex);
}
// pieces: [{ x, y }] with different x. With too few pieces the answer is simply a wrong key (unlock then fails).
export function joinKey(pieces) {
  const ys = pieces.map((p) => unhex(p.y)), len = ys[0].length, out = new Uint8Array(len);
  for (let b = 0; b < len; b++) {
    let s = 0;
    pieces.forEach((p, i) => {
      let num = 1, den = 1;
      pieces.forEach((q, j) => { if (i !== j) { num = mul(num, q.x); den = mul(den, p.x ^ q.x); } });
      s ^= mul(ys[i][b], mul(num, inv(den)));
    });
    out[b] = s;
  }
  return hex(out);
}
function stream(key, iv, n) {
  const out = new Uint8Array(n);
  for (let i = 0, blk = 0; i < n; blk++) { const h = unhex(sha256(key + ':' + iv + ':' + blk)); for (let j = 0; j < 32 && i < n; j++, i++) out[i] = h[j]; }
  return out;
}
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export function lock(key, text) {
  const iv = hex(rand(12)), plain = new TextEncoder().encode(text), ks = stream(key, iv, plain.length);
  for (let i = 0; i < plain.length; i++) plain[i] ^= ks[i];
  const ct = b64(plain);
  return iv + '.' + ct + '.' + sha256(key + ':mac:' + iv + ':' + ct);
}
// Gives the text back, or null when the key is wrong or the copy was changed.
export function unlock(key, sealed) {
  try {
    const [iv, ct, mac] = String(sealed).split('.');
    if (sha256(key + ':mac:' + iv + ':' + ct) !== mac) return null;
    const data = unb64(ct), ks = stream(key, iv, data.length);
    for (let i = 0; i < data.length; i++) data[i] ^= ks[i];
    return new TextDecoder().decode(data);
  } catch { return null; }
}

// The host's side: one key per group of piece holders. Call with the ids of the seated players other than the host.
// Returns what to send: box (the locked copy, for everyone) and piece(id) for each holder. With fewer than two
// holders nothing is shared, because a single player would then hold the whole key.
export function makeVault() {
  let forIds = null, k = null, pieces = {}, need = 0, last = '', lastBox = null;
  return {
    pack(holderIds, hiddenText) {
      const ids = [...holderIds].sort(), tag = ids.join(',');
      if (tag !== forIds) {
        forIds = tag; pieces = {}; last = ''; k = null;
        if (ids.length >= 2) { k = newKey(); need = piecesNeeded(ids.length); const ys = splitKey(k.key, ids.length, need); ids.forEach((id, i) => { pieces[id] = { kid: k.kid, x: i + 1, y: ys[i], need }; }); }
      }
      if (!k) return { box: null, piece: () => null, changed: last !== 'none' && ((last = 'none'), true) };
      const changed = hiddenText !== last;
      if (changed) { last = hiddenText; lastBox = { kid: k.kid, need, ct: lock(k.key, hiddenText) }; }
      return { box: lastBox, piece: (id) => pieces[id] || null, changed };
    },
  };
}
// The new host's side: add pieces as players come back; open() gives the hidden text once enough are in.
export function makeOpener(box, own) {
  const got = {};
  const add = (p) => { if (p && box && p.kid === box.kid && Number.isInteger(p.x) && p.x > 0 && p.x < 256 && /^[0-9a-f]{64}$/.test(String(p.y))) got[p.x] = { x: p.x, y: p.y }; };
  add(own);
  return {
    add,
    count: () => Object.keys(got).length,
    need: box?.need || 0,
    open() {
      const list = Object.values(got);
      if (!box || list.length < box.need) return null;
      return unlock(joinKey(list.slice(0, box.need)), box.ct);
    },
  };
}
export function cleanBox(b) { return b && typeof b.kid === 'string' && Number.isInteger(b.need) && typeof b.ct === 'string' && b.ct.length < 600000 ? { kid: b.kid.slice(0, 20), need: b.need, ct: b.ct } : null; }
export function cleanPiece(p) { return p && typeof p.kid === 'string' && Number.isInteger(p.x) && typeof p.y === 'string' ? { kid: p.kid.slice(0, 20), x: p.x, y: p.y.slice(0, 64), need: p.need | 0 } : null; }

// ---------- For the poker and baccarat pages (blackjack has the same steps in its own code) ----------
// Host, at every push: lock the hidden part and send the locked copy to everyone, and each seated player's piece
// to that player. keep holds the vault between calls. Players on the second path (relay) get no piece.
export function shareHidden(keep, net, seatedIds, hiddenText) {
  keep.vault ||= makeVault();
  const pack = keep.vault.pack(seatedIds.filter((id) => net.direct(id)), hiddenText);
  if (!pack.changed) return;
  for (const id of net.ids()) net.send(id, { t: 'vault', box: pack.box, piece: net.direct(id) ? pack.piece(id) : null });
}
// New host: wait up to 8 seconds for enough pieces. v is what this browser held as a player ({ box, piece }).
// Gives null when there is no locked copy. hold.done ends with the hidden text, or null when too few pieces came.
export function startHold(v, ms = 8000) {
  if (!v || !v.box) return null;
  const opener = makeOpener(v.box, v.piece), until = Date.now() + ms;
  let res; const done = new Promise((r) => { res = r; });
  const poll = setInterval(() => {
    const text = opener.count() >= opener.need ? opener.open() : null;
    if (text || Date.now() > until) { clearInterval(poll); res(text); }
  }, 200);
  return { kid: v.box.kid, add: opener.add, done, hellos: {} };
}
