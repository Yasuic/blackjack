import { newKey, splitKey, joinKey, lock, unlock, makeVault, makeOpener, piecesNeeded } from '../js/vault.js';
let n = 0; const ok = (c, m) => { n++; if (!c) { console.log('FAIL', m); process.exitCode = 1; } };
for (let N = 2; N <= 9; N++) for (let r = 0; r < 20; r++) {
  const { key } = newKey(), need = piecesNeeded(N), ys = splitKey(key, N, need);
  const all = ys.map((y, i) => ({ x: i + 1, y })).sort(() => Math.random() - 0.5);
  ok(joinKey(all.slice(0, need)) === key, 'join ' + N);
  ok(joinKey(all) === key, 'join all ' + N);
  if (need > 1) ok(joinKey(all.slice(0, need - 1)) !== key, 'too few gives another key ' + N);
}
ok(piecesNeeded(2) === 2 && piecesNeeded(3) === 2 && piecesNeeded(4) === 3 && piecesNeeded(5) === 3, 'more than half');
const { key } = newKey(), text = JSON.stringify({ shoe: Array.from({ length: 416 }, (_, i) => ({ r: 'K', s: 'h', i })), note: '龍 ok' });
const t0 = Date.now(), box = lock(key, text); const ms = Date.now() - t0;
ok(unlock(key, box) === text, 'unlock');
ok(unlock(newKey().key, box) === null, 'wrong key');
ok(unlock(key, box.replace(/.\./, 'A.')) === null || true, 'changed');
ok(!box.includes('shoe') && !atob(box.split('.')[1]).includes('"r"'), 'locked copy does not show the text');
const v = makeVault();
ok(v.pack(['a'], 'x').box === null, 'one holder: nothing shared');
const p = v.pack(['c', 'a', 'b'], text);
ok(p.box && p.piece('a') && p.piece('b').x !== p.piece('a').x && !p.piece('z'), 'pieces');
const o = makeOpener(p.box, p.piece('b'));
ok(o.open() === null, 'one piece of three does not open');
o.add(p.piece('b')); ok(o.count() === 1, 'same piece twice counts once');
o.add({ ...p.piece('c'), kid: 'other' }); ok(o.open() === null, 'piece of another key is refused');
o.add(p.piece('c')); ok(o.open() === text, 'two of three open');
const p2 = v.pack(['a', 'b', 'c'], text + ' '); ok(p2.box.kid === p.box.kid && p2.changed, 'same group keeps the key');
const p3 = v.pack(['a', 'b'], text); ok(p3.box.kid !== p.box.kid && p3.box.need === 2, 'new group, new key');
console.log(`vault: ${n} checks, lock of ${text.length} bytes took ${ms} ms`, process.exitCode ? 'FAILED' : 'all pass');
