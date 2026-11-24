// A person with several seats: a move (hit, stand, double, split, insurance, bet) makes only the figure in the seat
// it was for move, on this screen and in the message to the other screens. A move with no seat moves all of them.
import assert from 'node:assert/strict';
const stub = () => new Proxy(function () {}, { get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : stub()), apply: () => stub(), construct: () => stub() });
globalThis.document = stub(); globalThis.localStorage = stub(); globalThis.sessionStorage = stub(); globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.location = { hostname: 'x', search: '', protocol: 'https:' };
const sent = [];
globalThis.Peer = class { constructor() { this.open = false; } on() {} destroy() {} connect() { return { on() {}, send(m) { sent.push(m); } }; } };
const { startPresence, actKind } = await import('../js/presence.js');
const calls = [];
const room = { livePose() {}, liveGone() {}, gesture: (id, k, s) => calls.push([id, k, s]), pose: () => null };
const api = startPresence({ game: 'blackjack', room: () => room, code: () => 'abc', me: () => ({ id: 'ann', name: 'Ann' }), at: () => true });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const cases = [[{ t: 'action', a: 'hit' }, 2, 'tap'], [{ t: 'action', a: 'stand' }, 0, 'wave'], [{ t: 'action', a: 'double' }, 5, 'push'], [{ t: 'action', a: 'split' }, 1, 'push'], [{ t: 'insurance', take: true, seat: 3 }, undefined, 'push'], [{ t: 'bet', main: 10, seat: 4 }, undefined, 'push']];
for (const [m, seat, kind] of cases) {
  calls.length = 0;
  api.actFor(m, seat);
  ok(calls.length === 1 && calls[0][1] === kind, `${m.t} ${m.a || ''} makes one move`);
  ok(calls[0][2] === (seat ?? m.seat), `${m.t} ${m.a || ''}: only seat ${seat ?? m.seat}`);
}
calls.length = 0; api.actFor({ t: 'throw' }); ok(calls[0][2] === undefined, 'a move with no seat is for every figure');
ok(actKind({ t: 'action', a: 'hit', auto: true }) === null, 'auto play makes no move');
clearInterval?.(0);
console.log(`gesture per seat: ${n} checks passed`);
process.exit(0);
