// Player stats in every game's ledger: hands, wins, win rate, real and practice +/-, best and worst round, and a
// running total chart with one line per player. Blackjack builds the numbers from its recorded hands
// (Table.playerStats); poker, baccarat and roulette add each settled round with pstatAdd.
import { esc, money } from './common.js?v=20261124j';

// Player stats: hands, wins, win rate, real +/- and practice, best and worst round, and the running total chart.
export const STAT_COLORS = ['#f2c14e', '#4fc3f7', '#81c784', '#e57373', '#ba68c8', '#ffb74d', '#4db6ac', '#f06292', '#aed581', '#90a4ae'];
export function statsHTML(ps) {
  if (!ps?.players?.length) return '<h3>Player stats</h3><div class="hint">No hands played yet.</div>';
  const pl = (n) => `<span class="${n > 0 ? 'up' : n < 0 ? 'down' : ''}">${n > 0 ? '+' : ''}${money(n)}</span>`;
  const rows = ps.players.slice().sort((a, b) => b.net - a.net);
  const color = (name) => STAT_COLORS[ps.names.indexOf(name) % STAT_COLORS.length];
  const table = `<div class="stats-wrap"><table class="stats-t">
    <tr><th>Player</th><th>Hands</th><th>Won</th><th>Win rate</th><th>+/- real</th><th>Practice</th><th>Best</th><th>Worst</th></tr>
    ${rows.map((p) => `<tr><td><i class="st-dot" style="background:${color(p.name)}"></i>${esc(p.name)}${p.dealt ? ` <span class="hint">dealt ${p.dealt}</span>` : ''}</td><td>${p.hands}</td><td>${p.wins}</td><td>${p.hands ? Math.round((p.wins / p.hands) * 100) + '%' : '-'}</td><td>${pl(p.realNet)}</td><td>${pl(p.practiceNet)}</td><td>${pl(p.best)}</td><td>${pl(p.worst)}</td></tr>`).join('')}
  </table></div>`;
  return `<h3>Player stats</h3>${table}<div class="hint">Rounds ${ps.first} to ${ps.last}. ${ps.note || 'A hand that ends even is not a win.'} ${ps.tail ?? 'Side bets and insurance are in the +/-.'}</div>
    <h3>Profit over time</h3>${statsChart(ps, color)}`;
}
function statsChart(ps, color) {
  const pts = ps.series;
  if (pts.length < 2) return '<div class="hint">The chart starts after two rounds.</div>';
  const W = 640, H = 220, L = 52, R = 10, T = 10, B = 24;
  let lo = 0, hi = 0;
  for (const p of pts) for (const v of p.v) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  if (hi === lo) hi = lo + 1;
  const x = (i) => L + (i / (pts.length - 1)) * (W - L - R), y = (v) => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const lines = ps.names.map((n, k) => `<polyline fill="none" stroke="${color(n)}" stroke-width="2" stroke-linejoin="round" points="${pts.map((p, i) => x(i).toFixed(1) + ',' + y(p.v[k]).toFixed(1)).join(' ')}" />`).join('');
  const ticks = [hi, (hi + lo) / 2, lo].map((v) => `<text x="${L - 6}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end" class="st-ax">${money(Math.round(v))}</text>`).join('');
  const xt = `<text x="${L}" y="${H - 6}" class="st-ax">Round ${pts[0].round}</text><text x="${W - R}" y="${H - 6}" text-anchor="end" class="st-ax">Round ${pts[pts.length - 1].round}</text>`;
  const legend = `<div class="og-key">${ps.names.map((n) => `<i style="background:${color(n)}"></i>${esc(n)}`).join('')}</div>`;
  return `<svg class="st-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Running total of each player"><line x1="${L}" x2="${W - R}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="st-zero" />${lines}${ticks}${xt}</svg>${legend}`;
}
