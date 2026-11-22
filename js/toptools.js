// Top bar tools shared by every game: the card size slider, the "Session profit" readout and the volume sliders.
// All of it is each player's own view; the browser remembers the choices.
import { getVolume, setVolume, isMuted, setMuted, shoutSound, chipSound, throwSound } from './fx.js?v=20261122r';

const SIZE_KEY = 'bj-cardz', MIN = 60, MAX = 160;
let size = 100, onSize = null, useCss = false, bound = false;
try { const v = Number(localStorage.getItem(SIZE_KEY)); if (v >= MIN && v <= MAX) size = v; } catch { /* the default stays */ }

// 1 is the normal card size.
export function cardScale() { return size / 100; }

const SLIDERS = [['main', 'All sounds'], ['game', 'Cards and chips'], ['fx', 'Effects'], ['horn', 'Horns and shouts']];
export function topToolsHTML() {
  const v = getVolume();
  return `<button class="pill tt-profit" id="tt-profit" title="Your net result this session, as in the ledger" hidden></button>
    <label class="tt-size" title="Card size"><span class="tt-ico">🂠</span><input type="range" data-tt="size" min="${MIN}" max="${MAX}" step="5" value="${size}" aria-label="Card size" /></label>
    <div class="tt-wrap">
      <button class="btn small tt-btn" id="tt-btn" title="Sound and card size" aria-haspopup="true">${isMuted() || !v.main ? '🔇' : '🔊'}</button>
      <div class="tt-pop" id="tt-pop" hidden>
        <div class="tt-sp" id="tt-sp" hidden></div>
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
    if (e.target.closest?.('#tt-btn, #tt-profit')) { pop.hidden = !pop.hidden; return; }
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
export function setProfit(n) {
  const el = document.getElementById('tt-profit');
  if (!el) return;
  const sp = document.getElementById('tt-sp');
  if (n === null || n === undefined || !Number.isFinite(n)) { el.hidden = true; if (sp) sp.hidden = true; return; }
  const r = Math.round(n * 100) / 100, txt = (r > 0 ? '+' : r < 0 ? '-' : '') + Math.abs(r).toLocaleString();
  const html = `<span class="tt-pl">Session profit:</span> <b>${txt}</b>`;
  if (el.dataset.v !== html) { el.dataset.v = html; el.innerHTML = html; el.className = 'pill tt-profit ' + (r > 0 ? 'up' : r < 0 ? 'down' : ''); }
  el.hidden = false;
  if (sp) { if (sp.dataset.v !== txt) { sp.dataset.v = txt; sp.innerHTML = `Session profit: <b class="${r > 0 ? 'up' : r < 0 ? 'down' : ''}">${txt}</b>`; } sp.hidden = false; }
}
