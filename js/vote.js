// A settings change by vote, for poker, baccarat and roulette (blackjack has the same rule in its own code).
// Any seated player may ask for a change. Every other seated player who is online has to say yes within
// 12 seconds; one no, or no answer in time, leaves the settings as they are. A change that passes starts
// between hands, never in the middle of one. The host's browser keeps the vote on the table object.
import { esc } from './common.js?v=20261123g';

export const VOTE_MS = 12000; // short, so one player away from the screen does not hold the table up for long

// cfg: { labels: { key: [name, format?] }, seated(id), voters(by) -> ids of the online seated players other than `by`,
//        name(id), canApply(), apply(patch), log(text) }
export function votePropose(t, cfg, by, patch) {
  const clean = {};
  for (const k of Object.keys(patch || {})) { const v = patch[k]; if (cfg.labels[k] && (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 24))) clean[k] = v; }
  const changes = Object.keys(clean).filter((k) => String(clean[k]) !== String(t.settings[k]));
  if (!changes.length) return 'none';
  if (!cfg.seated(by)) throw new Error('Take a seat to change the settings.');
  if (t.setVote) throw new Error('A vote is already running.');
  for (const k of Object.keys(clean)) if (!changes.includes(k)) delete clean[k];
  const fmt = (k) => { const f = cfg.labels[k][1], v = clean[k]; return f ? f(v) : typeof v === 'boolean' ? (v ? 'on' : 'off') : String(v); };
  const summary = changes.map((k) => `${cfg.labels[k][0]}: ${fmt(k)}`).slice(0, 20);
  const voters = cfg.voters(by);
  t.voteSeq = (t.voteSeq || 0) + 1;
  if (!voters.length) { t.setPending = { ...(t.setPending || {}), ...clean }; cfg.log(`${cfg.name(by)} changed the settings (${summary.join(', ')}).`); return 'saved'; }
  t.setVote = { id: t.voteSeq, by, patch: clean, summary, voters, votes: {}, ends: Date.now() + VOTE_MS };
  cfg.log(`${cfg.name(by)} wants new settings (${summary.join(', ')}). Everyone else votes.`);
  return 'vote';
}
export function voteCast(t, cfg, id, yes) {
  const v = t.setVote;
  if (!v || !v.voters.includes(id) || id in v.votes) return;
  v.votes[id] = !!yes;
  if (!yes) { t.setVote = null; cfg.log(`${cfg.name(id)} voted no. The settings stay the same.`); }
}
// Run by the host's clock. True when something changed and everyone should be told.
export function voteTick(t, cfg, now = Date.now()) {
  let changed = false;
  const v = t.setVote;
  if (v) {
    // A voter who went offline or left their seat is no longer waited for.
    const still = cfg.voters(v.by), wait = v.voters.filter((id) => still.includes(id));
    if (wait.every((id) => v.votes[id] === true)) { t.setVote = null; t.setPending = { ...(t.setPending || {}), ...v.patch }; cfg.log('Everyone said yes to the new settings.'); changed = true; }
    else if (now >= v.ends) { t.setVote = null; cfg.log('The settings vote ran out, so the answer is no.'); changed = true; }
  }
  if (t.setPending && cfg.canApply()) {
    const patch = t.setPending; t.setPending = null;
    try { cfg.apply(patch); cfg.log('New settings are in.'); } catch (e) { cfg.log(`The settings stay the same. ${e.message}`); }
    changed = true;
  }
  return changed;
}
// What one player is told about the vote.
export function voteView(t, cfg, forId) {
  const v = t.setVote;
  if (!v) return t.setPending ? { waiting: true } : null;
  return { id: v.id, name: cfg.name(v.by), summary: v.summary, yes: Object.values(v.votes).filter(Boolean).length, n: v.voters.length,
    canVote: v.voters.includes(forId) && !(forId in v.votes), mine: v.by === forId, left: Math.max(0, v.ends - Date.now()) };
}

// The vote card on a player's screen.
let ends = 0, shownId = null;
export function drawVote(v, send) {
  let box = document.getElementById('vote');
  if (!v || !v.id) { if (box) box.remove(); shownId = null; return; }
  if (shownId !== v.id) { shownId = v.id; ends = Date.now() + v.left; }
  if (!box) { box = document.createElement('div'); box.id = 'vote'; box.className = 'vote-pop'; document.body.appendChild(box); }
  box.hidden = !v.canVote; // only players who still have to answer see the card
  const key = [v.id, v.yes, v.canVote].join(':');
  if (box.dataset.k === key) return;
  box.dataset.k = key;
  box.innerHTML = `<div class="vote-card">
    <div class="vote-title">${v.mine ? 'Waiting for votes' : `${esc(v.name)} wants to change the settings`}</div>
    <ul class="vote-list">${v.summary.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
    <p>${v.mine ? `Everyone else has to say yes. ${v.yes} of ${v.n} said yes so far.` : 'Everyone has to say yes. No answer counts as no.'}</p>
    ${v.canVote ? '<div class="actions"><button class="btn primary" data-vote="1">Yes</button><button class="btn danger" data-vote="0">No</button></div>' : (v.mine ? '' : '<p class="hint">You voted. Waiting for the others.</p>')}
    <div class="vote-bar"><span id="vote-bar"></span></div>
  </div>`;
  box.querySelectorAll('[data-vote]').forEach((b) => b.addEventListener('click', () => send({ t: 'vote', yes: b.dataset.vote === '1' })));
}
setInterval(() => { const bar = document.getElementById('vote-bar'); if (bar) bar.style.width = (100 * Math.max(0, ends - Date.now())) / VOTE_MS + '%'; }, 200);
