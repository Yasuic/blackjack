// Top bar tools shared by every game: the card size slider, the "Session profit" readout and the volume sliders.
// All of it is each player's own view; the browser remembers the choices.
import { getVolume, setVolume, isMuted, setMuted, shoutSound, chipSound, throwSound } from './fx.js?v=20261124s';

const SIZE_KEY = 'bj-cardz', MIN = 60, MAX = 160;
let size = 100, onSize = null, useCss = false, bound = false;
try { const v = Number(localStorage.getItem(SIZE_KEY)); if (v >= MIN && v <= MAX) size = v; } catch { /* the default stays */ }

// 1 is the normal card size.
export function cardScale() { return size / 100; }

// Sound has one place only: these sliders. An old "Sound: off" from the menu becomes "All sounds" at 0.
try { if (isMuted()) { setVolume('main', 0); setMuted(false); } } catch { /* fine */ }
const SLIDERS = [['main', 'All sounds'], ['game', 'Cards and chips'], ['fx', 'Effects'], ['horn', 'Horns and shouts']];
export function topToolsHTML() {
  const v = getVolume();
  return `<button class="pill tt-profit" id="tt-profit" title="Chips you have put in on the hand in play. Tap for the ledger." hidden></button>
    <label class="tt-size" title="Card size"><span class="tt-ico">🂠</span><input type="range" data-tt="size" min="${MIN}" max="${MAX}" step="5" value="${size}" aria-label="Card size" /></label>
    <div class="tt-wrap">
      <button class="btn small tt-btn" id="tt-btn" title="Sound and card size" aria-label="Sound and card size" aria-haspopup="true">${isMuted() || !v.main ? '🔇' : '🔊'}</button>
      <div class="tt-pop" id="tt-pop" hidden>
        <label class="tt-row"><span>Card size</span><input type="range" data-tt="size" min="${MIN}" max="${MAX}" step="5" value="${size}" /><b data-tt-val="size">${size}%</b></label>
        <div class="tt-head">Volume</div>
        ${SLIDERS.map(([k, name]) => `<label class="tt-row"><span>${name}</span><input type="range" data-tt="vol" data-k="${k}" min="0" max="100" step="5" value="${v[k]}" /><b data-tt-val="${k}">${v[k]}</b></label>`).join('')}
        <button class="btn small tt-reset" data-tt="reset">Reset</button>
      </div>
    </div>`;
}

function applySize(from) {
  if (useCss) document.documentElement.style.setProperty('--cardz', String(size / 100));
  for (const el of document.querySelectorAll('[data-tt="size"]')) if (el !== from) el.value = size;
  for (const el of document.querySelectorAll('[data-tt-val="size"]')) el.textContent = size + '%';
  onSize?.(size / 100);
}
function showVol() {
  const v = getVolume();
  for (const el of document.querySelectorAll('[data-tt="vol"]')) el.value = v[el.dataset.k];
  for (const k of Object.keys(v)) for (const el of document.querySelectorAll(`[data-tt-val="${k}"]`)) el.textContent = v[k];
  const b = document.getElementById('tt-btn');
  if (b) b.textContent = isMuted() || !v.main ? '🔇' : '🔊';
}

// css: true on pages whose cards take their size from the style sheet (poker, baccarat). Blackjack works its
// card sizes out in its own layout code and reads cardScale() there, so it passes onChange to draw again.
export function initTopTools({ css = false, onChange = null } = {}) {
  useCss = css; onSize = onChange;
  if (useCss) document.documentElement.style.setProperty('--cardz', String(size / 100));
  if (bound) return;
  bound = true;
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!el?.dataset?.tt) return;
    if (el.dataset.tt === 'size') {
      size = Math.max(MIN, Math.min(MAX, Number(el.value) || 100));
      try { localStorage.setItem(SIZE_KEY, String(size)); } catch { /* not saved */ }
      applySize(el);
    } else if (el.dataset.tt === 'vol') {
      setVolume(el.dataset.k, el.value);
      if (Number(el.value) > 0 && el.dataset.k === 'main' && isMuted()) setMuted(false);
      showVol();
    }
  });
  // On letting go of a volume slider, a short sound of that group plays, so the level can be heard.
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el?.dataset?.tt !== 'vol') return;
    const k = el.dataset.k;
    if (k === 'horn') shoutSound('bus'); else if (k === 'fx') throwSound('egg', 'hit'); else chipSound(2);
  });
  document.addEventListener('click', (e) => {
    const pop = document.getElementById('tt-pop');
    if (!pop) return;
    if (e.target.closest?.('#tt-btn')) { pop.hidden = !pop.hidden; return; }
    // Session profit opens the game's ledger (sound has its own speaker button).
    if (e.target.closest?.('#tt-profit')) { pop.hidden = true; document.querySelector('[data-act=ledger-toggle], [data-act=ledger], [data-act=show-ledger], [data-act=pk-ledger]')?.click(); return; }
    if (e.target.closest?.('[data-tt="reset"]')) {
      size = 100; try { localStorage.setItem(SIZE_KEY, '100'); } catch { /* not saved */ }
      for (const k of ['main', 'game', 'fx', 'horn']) setVolume(k, 100);
      setMuted(false); applySize(null); showVol();
      return;
    }
    if (!pop.hidden && !e.target.closest?.('#tt-pop')) pop.hidden = true;
  });
}

// The player's own net result of the session, the same number as their line in the ledger. null hides it.
// What the player has put in on the hand in play (the ledger only moves once it is settled). 0 or null hides it.
let risk = 0, riskBase = 0, riskWon = 0, riskPaid = 0, lastProfit = null, lastPractice = null;
// Baccarat and roulette: [at risk, balance at the start of the round] for setRisk. A player risks their own
// bets; the bank risks every bet on the table. shown: the chips the page shows (before this result is paid).
export function bankRisk(st, me, betting, settling, shown) {
  if (!me || !(betting || settling)) return [0];
  const sum = (b) => Object.values(b || {}).reduce((a, x) => a + (Number(x) || 0), 0);
  const isBank = st.bankId === me.id;
  let mine = 0, vs = 0;
  if (betting) { mine = sum(st.bets?.[me.id]); if (isBank) for (const [id, b] of Object.entries(st.bets || {})) if (id !== me.id) vs += sum(b); }
  else { const pay = st.pays?.[me.id]; mine = pay && !pay.bank ? Number(pay.staked) || 0 : 0; if (isBank) for (const [id, x] of Object.entries(st.pays || {})) if (id !== me.id && x && !x.bank) vs += Number(x.staked) || 0; }
  return [mine + vs, shown + mine];
}
// n: what this hand can cost the person (their own bets, or for a dealer or bank every bet against them).
// base: their balance when the hand started, so the bar shows the share of it in play.
// won (a dealer only): stakes already the dealer's this hand (busts, surrenders, lost side bets). The bar then shows
// what is still open, with the tally beside it: everything put in against the dealer, less what is won for sure.
export function setRisk(n, base, won = 0, paid = 0) {
  const r2 = (x) => Math.round(x * 100) / 100;
  const w = Number.isFinite(won) && won > 0 ? r2(won) : 0;
  const pd = Number.isFinite(paid) && paid > 0 ? r2(paid) : 0;
  const v = Number.isFinite(n) && n - w > 0 ? r2(n - w) : 0;
  const b = (v || w) && Number.isFinite(base) && base > 0 ? r2(base) : 0;
  if (v === risk && b === riskBase && w === riskWon && pd === riskPaid) return;
  risk = v; riskBase = b; riskWon = w; riskPaid = pd;
  setProfit(lastProfit);
}
// Session profit shows on the Ledger button (ledgerTitle) and in the ledger. The top bar shows "At risk" while a hand is in play.
export function setProfit(n) {
  lastProfit = Number.isFinite(n) ? n : null;
  showTitle();
  const el = document.getElementById('tt-profit');
  if (!el) return;
  if (!risk && !riskWon && !riskPaid) { el.hidden = true; return; }
  const pct = riskBase ? Math.round((risk / riskBase) * 100) : null;
  const tally = (riskWon ? ` <span class="tt-rw">${(risk + riskWon).toLocaleString()} in <span class="up">−${riskWon.toLocaleString()} won</span></span>` : '')
    + (riskPaid ? ` <span class="tt-rw"><span class="down">${riskPaid.toLocaleString()} paid</span></span>` : '');
  const html = `<span class="tt-rl">At risk</span> <b>${risk.toLocaleString()}</b>${pct !== null ? ` <span class="tt-rp">(${pct}%<span class="tt-rof"> of ${riskBase.toLocaleString()}</span>)</span>` : ''}${tally}`;
  if (el.dataset.v !== html) { el.dataset.v = html; el.innerHTML = html; el.className = 'pill tt-profit tt-risk-only'; }
  el.hidden = false;
}
// The Ledger button's own title carries the player's session result: "Ledger (Session: +84)", green or red.
// While the ledger is frozen it shows the practice result in blue instead, since that never counts.
export function ledgerTitle() {
  if (lastPractice !== null) return `Ledger <span class="ld-t prac">(<span class="ld-w">Practice: </span>${signed(lastPractice)})</span>`;
  if (lastProfit === null) return 'Ledger';
  const r = Math.round(lastProfit * 100) / 100;
  return `Ledger <span class="ld-t ${r > 0 ? 'up' : r < 0 ? 'down' : ''}">(<span class="ld-w">Session: </span>${signed(r)})</span>`;
}
function showTitle() {
  const h = ledgerTitle();
  for (const el of document.querySelectorAll('[data-ld-title]')) if (el.innerHTML !== h) el.innerHTML = h;
}
// The player's own session profit, at the top of every game's ledger.
// Practice rounds (frozen ledger, house dealer) are shown live too, in blue and marked, because they never count.
export function setPractice(n) { lastPractice = Number.isFinite(n) ? Math.round(n * 100) / 100 : null; showTitle(); }
const signed = (r) => (r > 0 ? '+' : r < 0 ? '-' : '') + Math.abs(r).toLocaleString();
export function profitLineHTML() {
  if (lastProfit === null) return '';
  const r = Math.round(lastProfit * 100) / 100;
  const prac = lastPractice !== null ? `<div class="ld-mine ld-prac">Practice profit <b>${signed(lastPractice)}</b> <span class="ld-tag">Practice, not counted</span></div>` : '';
  return `<div class="ld-mine">Your session profit <b class="${r > 0 ? 'up' : r < 0 ? 'down' : ''}">${signed(r)}</b></div>${prac}`;
}
