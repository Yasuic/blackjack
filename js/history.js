// Hand history kept on the host's browser, and its export.
// The last five tables this browser hosted are kept in the browser's own database (IndexedDB), so
// closing the browser does not clear them. A sixth table drops the oldest one. Each finished round
// is also sent to an online backup; that copy can only be read back with the table's secret id,
// which never leaves the host's browser.
const DB = 'bj-history', KEEP = 5;
const BACKUP_URL = 'https://vhelbcidtatbqjojuizg.supabase.co';
const BACKUP_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoZWxiY2lkdGF0YnFqb2p1aXpnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTUxODEyNDAsImV4cCI6MjExMDc1NzI0MH0.WyJwWIvWwOBmKeFFXz4SKb59Bsk0TDkvvDqdyLAK2AY';

let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('no database'));
    const rq = indexedDB.open(DB, 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains('tables')) d.createObjectStore('tables', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('rounds')) d.createObjectStore('rounds', { keyPath: ['table', 'round'] });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}
const done = (rq) => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });
const range = (id) => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

export function newTableId() {
  const b = new Uint8Array(24);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

// Note a table this browser hosts. Keeps the five newest tables and drops the rest with their rounds.
export async function openTable(meta) {
  try {
    const d = await db();
    const tx = d.transaction(['tables', 'rounds'], 'readwrite');
    const ts = tx.objectStore('tables');
    const old = await done(ts.get(meta.id));
    ts.put({ ...(old || {}), ...meta, seen: Date.now() });
    const all = (await done(ts.getAll())).filter((t) => t.id !== meta.id).sort((a, b) => (b.created || 0) - (a.created || 0));
    for (const t of all.slice(KEEP - 1)) { ts.delete(t.id); tx.objectStore('rounds').delete(range(t.id)); }
  } catch {}
}

// Store finished rounds (each one once) and send the new ones to the online backup. Never waits on the network.
export async function saveRounds(tableId, rounds) {
  if (!tableId || !rounds?.length) return;
  try {
    const d = await db();
    const tx = d.transaction('rounds', 'readwrite');
    const os = tx.objectStore('rounds');
    for (const r of rounds) {
      const have = await done(os.get([tableId, r.round]));
      if (!have) os.put({ ...r, table: tableId });
    }
  } catch {}
  backup(tableId);
}

export async function listTables() {
  try {
    const d = await db();
    const tx = d.transaction(['tables', 'rounds']);
    const tables = await done(tx.objectStore('tables').getAll());
    for (const t of tables) t.rounds = await done(tx.objectStore('rounds').count(range(t.id)));
    return tables.sort((a, b) => (b.created || 0) - (a.created || 0));
  } catch { return []; }
}

export async function getRounds(tableId) {
  try {
    const d = await db();
    return (await done(d.transaction('rounds').objectStore('rounds').getAll(range(tableId)))).sort((a, b) => a.round - b.round);
  } catch { return []; }
}

// ---------- Online backup ----------
const head = { apikey: BACKUP_KEY, Authorization: 'Bearer ' + BACKUP_KEY, 'Content-Type': 'application/json' };
const busy = new Set();
export const backupState = { ok: 0, failed: 0, last: '' };
async function backup(tableId) {
  if (busy.has(tableId) || typeof fetch === 'undefined') return;
  busy.add(tableId);
  try {
    const todo = (await getRounds(tableId)).filter((r) => !r.backed).slice(0, 40);
    for (const r of todo) {
      const { table, backed, ...data } = r;
      let good = false;
      try {
        const res = await fetch(BACKUP_URL + '/rest/v1/hand_history', {
          method: 'POST', headers: { ...head, Prefer: 'return=minimal' }, keepalive: true,
          body: JSON.stringify({ table_id: tableId, round_no: r.round, shuffle_no: r.shoe || 0, data }),
        });
        good = res.ok || res.status === 409; // 409: this round is already saved
        backupState.last = good ? '' : 'The backup answered ' + res.status + '.';
      } catch { backupState.last = 'The backup could not be reached.'; }
      if (!good) { backupState.failed++; break; } // try again with the next round
      backupState.ok++;
      try { const d = await db(); d.transaction('rounds', 'readwrite').objectStore('rounds').put({ ...r, backed: true }); } catch {}
    }
  } finally { busy.delete(tableId); }
}

// Read a table's rounds back from the online backup. Needs the table's secret id.
export async function fetchBackup(tableId) {
  const res = await fetch(BACKUP_URL + '/rest/v1/rpc/hand_history_for', { method: 'POST', headers: head, body: JSON.stringify({ p_table_id: tableId }) });
  if (!res.ok) throw new Error('The online backup answered ' + res.status + '.');
  return (await res.json()).map((row) => ({ ...row.data, round: row.round_no })).sort((a, b) => a.round - b.round);
}

// ---------- Export ----------
const p2 = (n) => String(n).padStart(2, '0');
const stamp = (t) => { if (!t) return ''; const d = new Date(t); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`; };
const clock = (t) => stamp(t).slice(11);
const pl = (n) => (n > 0 ? '+' : '') + (n || 0);
const sideList = (o) => Object.entries(o || {}).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v}`).join(', ');
const evLine = (e) => `${clock(e.t)} ${e.who ? e.who + ': ' : ''}${e.k}${e.d ? ' (' + e.d + ')' : ''}`;

export function sinceLastShuffle(rounds) {
  if (!rounds.length) return rounds;
  const last = rounds[rounds.length - 1].shoe;
  return rounds.filter((r) => r.shoe === last);
}

export function toText(meta, rounds, scope, tail = []) {
  const out = ['Blackjack hand history', `Table ${meta.code || ''}${meta.created ? ', opened ' + stamp(meta.created) : ''}${meta.host ? ', host ' + meta.host : ''}`,
    `Exported ${stamp(Date.now())} (times are this computer's local time)`, `Scope: ${scope}. Rounds: ${rounds.length}.`, ''];
  let shoe = null;
  const shoes = [...new Set(rounds.map((r) => r.shoe))];
  for (const r of rounds) {
    if (r.shoe !== shoe) {
      shoe = r.shoe;
      const inShoe = rounds.filter((x) => x.shoe === shoe);
      out.push('='.repeat(72), `SHUFFLE ${shoes.indexOf(shoe) + 1}   (${inShoe.length} ${inShoe.length === 1 ? 'round' : 'rounds'}: round ${inShoe[0].round}${inShoe.length > 1 ? ' to ' + inShoe[inShoe.length - 1].round : ''})`, '='.repeat(72), '');
    }
    out.push(`Round ${r.round}   ${stamp(r.time)}   Dealer: ${r.dealerName}${r.frozen || !r.counted ? '   [practice: frozen ledger, not counted]' : ''}${r.midShuffle ? '   [the shoe ran out and was reshuffled in this round]' : ''}`);
    out.push(`  Dealer cards: ${r.dealer} = ${r.dealerTotal > 21 ? 'bust ' + r.dealerTotal : r.dealerTotal}`);
    for (const s of r.seats) {
      const b = s.bet || {};
      const sides = sideList(b.sides);
      out.push(`  Seat ${s.seat}  ${s.name}${s.auto ? '  [auto play]' : ''}   bet ${b.main ?? s.hands[0]?.bet ?? ''}${sides ? `, side bets: ${sides}` : ''}${b.insurance ? `, insurance ${b.insurance}` : ''}   seat result ${pl(s.net)}${s.chipsAfter !== undefined ? `   chips after ${s.chipsAfter}` : ''}`);
      s.hands.forEach((h, j) => out.push(`    Hand ${j + 1}: ${h.cards} = ${h.total}   bet ${h.bet}${h.doubled ? ' (doubled)' : ''}   ${h.result || ''}   ${pl(h.net)}`));
      for (const x of s.sides || []) out.push(`    Side bet ${x.name}: ${pl(x.net)}`);
    }
    if (r.events?.length) { out.push('  What happened, in order:'); for (const e of r.events) out.push('    ' + evLine(e)); }
    out.push('');
  }
  if (tail.length) { out.push('After the last round:'); for (const e of tail) out.push('  ' + evLine(e)); out.push(''); }
  return out.join('\r\n');
}

const cell = (v) => { const s = v === undefined || v === null ? '' : String(v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
export function toCSV(meta, rounds) {
  const cols = ['table', 'round', 'time', 'shuffle', 'practice', 'dealer', 'dealer_cards', 'dealer_total', 'seat', 'player', 'auto_play', 'main_bet', 'side_bets', 'insurance', 'hand', 'cards', 'total', 'hand_bet', 'doubled', 'result', 'hand_net', 'side_bet_results', 'seat_net', 'chips_after', 'player_actions', 'other_events'];
  const rows = [cols.join(',')];
  const shoes = [...new Set(rounds.map((r) => r.shoe))];
  for (const r of rounds) {
    const names = new Set(r.seats.map((s) => s.name));
    const other = (r.events || []).filter((e) => !names.has(e.who) || /join|leave|disconnect|reconnect|removed|buy-in/.test(e.k)).map(evLine).join(' | ');
    for (const s of r.seats) {
      const acts = (r.events || []).filter((e) => e.who === s.name && (!e.d || !/^seat \d+/.test(e.d) || e.d.startsWith(`seat ${s.seat}`))).map(evLine).join(' | ');
      s.hands.forEach((h, j) => rows.push([meta.code, r.round, stamp(r.time), shoes.indexOf(r.shoe) + 1, r.frozen || !r.counted ? 'yes' : 'no', r.dealerName, r.dealer, r.dealerTotal, s.seat, s.name, s.auto ? 'yes' : 'no',
        s.bet?.main ?? '', sideList(s.bet?.sides), s.bet?.insurance || 0, j + 1, h.cards, h.total, h.bet, h.doubled ? 'yes' : 'no', h.result || '', h.net,
        (s.sides || []).map((x) => `${x.name} ${pl(x.net)}`).join('; '), s.net, s.chipsAfter ?? '', acts, other].map(cell).join(',')));
    }
  }
  return '﻿' + rows.join('\r\n');
}

export function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
