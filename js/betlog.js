// The bet log in every game's Ledger: one entry per settled round with each player's bets, what they did and
// their +/-. Each browser keeps the rounds it saw for a table (by table code), so the log stays after a reload.
// Only public information goes in: bets, moves and cards that were face up when the round ended.
// esc and money as in common.js, kept here so the log has no browser-only imports (the tests load it in Node).
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => Number(n).toLocaleString();

const KEEP = 300, SHOW = 60;
const key = (game, code) => `bj-betlog:${game}:${code || ''}`;
const read = (k) => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };

// Adds one settled round. A round already in the log (same id) is left as it is.
export function betLogAdd(game, code, entry) {
  if (!code || !entry || entry.id == null || !entry.rows?.length) return false;
  const k = key(game, code), list = read(k);
  if (list.some((e) => e.id === entry.id)) return false;
  list.push({ t: Date.now(), ...entry });
  if (list.length > KEEP) list.splice(0, list.length - KEEP);
  try { localStorage.setItem(k, JSON.stringify(list)); } catch { /* storage full or blocked: the log is a convenience */ }
  return true;
}
export function betLogList(game, code) { return read(key(game, code)); }

// The fold stays open or closed across the Ledger's redraws.
let open = false;
try { open = sessionStorage.getItem('bj-betlog-open') === '1'; } catch { /* no storage */ }
if (typeof document !== 'undefined') document.addEventListener('toggle', (e) => {
  if (!e.target?.classList?.contains('bl-fold')) return;
  open = e.target.open;
  try { sessionStorage.setItem('bj-betlog-open', open ? '1' : '0'); } catch { /* no storage */ }
}, true);

const pl = (n) => `<span class="${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${n > 0 ? '+' : ''}${money(n)}</span>`;
const hm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

export function betLogHTML(game, code, myId) {
  const list = read(key(game, code));
  const head = `Bet log${list.length ? ` (${list.length} round${list.length === 1 ? '' : 's'})` : ''}`;
  if (!list.length) return `<details class="ig-fold bl-fold"${open ? ' open' : ''}><summary>${head}</summary><div class="hint">Rounds you see settle at this table show here.</div></details>`;
  const rounds = list.slice(-SHOW).reverse().map((e) => `<tr class="bl-round"><td colspan="4">${esc(e.label)} · ${hm(e.t)}${e.note ? ` · ${esc(e.note)}` : ''}</td></tr>
    ${e.rows.map((r) => `<tr class="${myId && r.id === myId ? 'me' : ''}"><td>${esc(r.who)}</td><td>${money(r.bet)}</td><td class="bl-did">${esc(r.did)}</td><td>${r.net == null ? '' : pl(r.net)}</td></tr>`).join('')}`).join('');
  return `<details class="ig-fold bl-fold"${open ? ' open' : ''}><summary>${head}</summary>
    <div class="stats-wrap bl-wrap"><table class="stats-t bl-t"><tr><th>Player</th><th>Bet</th><th>What they did</th><th>+/-</th></tr>${rounds}</table></div>
    <div class="hint">Newest first. This browser keeps the last ${KEEP} rounds it saw at this table${list.length > SHOW ? `; the newest ${SHOW} show here` : ''}.</div></details>`;
}

const cards = (cs) => (cs || []).map((c) => c.r + c.s).join(' ');

// Blackjack: one row per seat, every hand with its moves and result, side bets and insurance.
export function bjEntry(st) {
  if (!st || st.phase !== 'settled') return null;
  const rows = [];
  (st.seats || []).forEach((s, i) => {
    if (!s || !s.hands?.length) return;
    const many = s.hands.length > 1;
    const parts = s.hands.map((h, k) => {
      const acts = (h.acts || []).join(', ');
      return `${many ? `Hand ${k + 1} ` : ''}${cards(h.cards)} = ${h.total}${acts ? `: ${acts}` : h.blackjack ? ': Blackjack' : ''}${h.result ? ` (${h.result})` : ''}`;
    });
    for (const r of s.sideResults || []) parts.push(`${r.name} ${money(r.stake)}: ${r.win ? 'won ' + money(r.pay - r.stake) : r.push ? 'push' : 'lost'}`);
    if (s.insurance) parts.push(`Insurance ${money(s.insurance)}`);
    const sides = Object.values(s.bet?.sides || {}).reduce((a, v) => a + (v || 0), 0);
    rows.push({ id: s.playerId, who: `${s.name} (seat ${i + 1})`, bet: (s.staked || s.hands.reduce((a, h) => a + h.bet, 0)) + (s.staked ? 0 : sides), did: parts.join('; '), net: s.net });
  });
  if (rows.length && st.banker && st.banker.net != null) rows.push({ id: st.banker.id, who: `${st.banker.name} (dealer)`, bet: 0, did: 'Bank', net: st.banker.net });
  if (!rows.length) return null;
  const d = st.dealer;
  const note = d?.cards?.length ? `Dealer ${cards(d.cards)}${d.total ? ' = ' + d.total : ''}` : '';
  return { id: st.round, label: `Round ${st.round}`, note, rows };
}

// Poker: one row per player dealt in, every move by street, the cards shown and what they won.
export function pokerEntry(h) {
  if (!h || h.hand == null || !h.seats?.length) return null;
  const rows = h.seats.map((x) => {
    const won = x.won || 0, net = Number.isFinite(x.start) && Number.isFinite(x.end) ? x.end - x.start : won - (x.total || 0);
    const acts = (x.acts || []).join(', ');
    const shown = x.cards?.length && x.cards.every((c) => c && c.r) ? ` · showed ${cards(x.cards)}` : '';
    return { id: x.id, who: x.name, bet: x.total || 0, did: (acts || (x.folded ? 'Fold' : '')) + shown + (won ? ` · won ${money(won)}` : ''), net };
  });
  return { id: h.hand, label: `Hand ${h.hand}`, note: h.board?.length ? `Board ${cards(h.board)}` : '', rows };
}

// Baccarat and roulette: one row per player with every spot bet, and one for the dealer's bank.
export function bankEntry(st, spotName, resultText) {
  if (!st || st.phase !== 'done' || !st.pays) return null;
  const rows = [];
  for (const [id, pay] of Object.entries(st.pays)) {
    const name = st.players?.find((p) => p.id === id)?.name || 'Player';
    if (pay.bank) { rows.push({ id, who: `${name} (dealer)`, bet: 0, did: 'Bank', net: pay.net }); continue; }
    const bets = pay.lines ? pay.lines.map((l) => [l.spot, l.bet, l.net]) : Object.entries(st.lastBets?.[id] || {}).map(([k, b]) => [k, b, (pay.wins || []).find((w) => w.key === k)?.net ?? -b]);
    rows.push({ id, who: name, bet: pay.staked, did: bets.map(([k, b, n]) => `${spotName(k)} ${money(b)}: ${n > 0 ? 'won ' + money(n) : n < 0 ? 'lost' : 'push'}`).join('; '), net: pay.net });
  }
  return rows.length ? { id: st.round, label: `Round ${st.round}`, note: resultText || '', rows } : null;
}
