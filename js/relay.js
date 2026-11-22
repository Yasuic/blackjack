// A second way for browsers to reach the table, for when the usual one fails.
// Normally two browsers find each other at a free public meeting point and then talk directly.
// Some networks block that, and the meeting point is sometimes down. This file sends the same game
// messages through the table owner's own online database service instead (its live message channel).
// Everything sent this way is locked with a key that only the host and that one player hold, so
// other people on the channel cannot read cards, bets or shuffle keys.
import { BACKUP_URL, BACKUP_KEY } from './history.js?v=20261122h';

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = (buf) => { const a = new Uint8Array(buf); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
export const relayWorks = () => typeof WebSocket !== 'undefined' && !!globalThis.crypto?.subtle;

async function newPair() { const kp = await crypto.subtle.generateKey(ECDH, false, ['deriveKey']); return { kp, pub: b64(await crypto.subtle.exportKey('raw', kp.publicKey)) }; }
async function sharedKey(kp, otherPub) {
  const pub = await crypto.subtle.importKey('raw', unb64(otherPub), ECDH, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: pub }, kp.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function lock(key, obj) { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), c: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)))) }; }
async function unlock(key, m) { return JSON.parse(dec.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(m.iv) }, key, unb64(m.c)))); }

// One live channel for a table. Calls onMsg for every message other people send on it.
function channel(code, urlOverride, { onMsg, onOpen, onClose }) {
  const topic = 'realtime:bj-table-' + code;
  let ws = null, ref = 0, joinRef = null, beat = null, shut = false, open = false, again = null;
  const raw = (o) => { try { ws?.readyState === 1 && ws.send(JSON.stringify(o)); } catch {} };
  const connect = () => {
    if (shut) return;
    const url = urlOverride || BACKUP_URL.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(BACKUP_KEY) + '&vsn=1.0.0';
    try { ws = new WebSocket(url); } catch { again = setTimeout(connect, 4000); return; }
    const mine = ws;
    ws.onopen = () => {
      joinRef = String(++ref);
      raw({ topic, event: 'phx_join', payload: { config: { broadcast: { ack: false, self: false }, presence: { key: '' }, postgres_changes: [], private: false }, access_token: BACKUP_KEY }, ref: joinRef, join_ref: joinRef });
      clearInterval(beat);
      beat = setInterval(() => raw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++ref) }), 25000);
    };
    ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.topic !== topic) return;
      if (m.event === 'phx_reply' && m.ref === joinRef) { if (m.payload?.status === 'ok') { open = true; onOpen?.(); } else { try { mine.close(); } catch {} } return; }
      if (m.event === 'broadcast' && m.payload?.event === 'm' && m.payload.payload) onMsg(m.payload.payload);
      if (m.event === 'phx_error' || m.event === 'phx_close') { try { mine.close(); } catch {} }
    };
    ws.onclose = () => {
      if (ws !== mine) return;
      clearInterval(beat);
      const was = open; open = false;
      if (was) onClose?.();
      if (!shut) again = setTimeout(connect, 3000);
    };
    ws.onerror = () => {};
  };
  connect();
  return {
    get open() { return open; },
    send(payload) { raw({ topic, event: 'broadcast', payload: { type: 'broadcast', event: 'm', payload }, ref: String(++ref), join_ref: joinRef }); },
    close() { shut = true; clearTimeout(again); clearInterval(beat); open = false; try { ws?.close(); } catch {} },
  };
}

// A stand-in for a direct link, with the same few methods the game uses on one.
function makeLink(peerName, sendLocked) {
  const on = {};
  let chain = Promise.resolve();
  const link = {
    relay: true, open: false, peer: peerName, clientId: null,
    on(ev, fn) { (on[ev] ||= []).push(fn); },
    emit(ev, x) { (on[ev] || []).forEach((fn) => { try { fn(x); } catch (e) { console.error(e); } }); },
    // Messages are locked one after another, so they leave in the order the game sent them.
    send(msg) { if (!link.open) return; chain = chain.then(() => sendLocked(msg)).catch(() => {}); },
    close() { if (!link.open && link.dead) return; link.open = false; link.dead = true; link.onShut?.(); link.emit('close'); },
  };
  return link;
}

// The host's side: one locked link per player who comes in this way. onLink is called with each new link.
// gen counts how often the table changed hosts. Every host says its number on the channel; a host that
// hears a higher number knows the table moved on while it was away (onBoss).
export function hostRelay(code, urlOverride, { onLink, onOpen, onClose, gen = 0, onBoss }) {
  const peers = {}; // player id -> { key, link, chain }
  const boss = () => ch.send({ k: 'boss', f: 'host', g: gen });
  let bossTimer = null;
  const ch = channel(code, urlOverride, {
    onOpen: () => { boss(); clearInterval(bossTimer); bossTimer = setInterval(boss, 5000); onOpen?.(); }, onClose,
    onMsg: async (m) => {
      if (!m || typeof m !== 'object' || typeof m.f !== 'string' || m.f.length > 24) return;
      if (m.k === 'boss') { if (Number.isInteger(m.g) && m.g > gen && m.g < gen + 50) onBoss?.(m.g); return; }
      const id = m.f;
      if (m.k === 'hi' && typeof m.pub === 'string' && m.pub.length < 200) {
        if (Object.keys(peers).length > 40 && !peers[id]) return;
        // The same hello again (the answer was still on its way): give the same answer, keep the same key.
        if (peers[id]?.pubIn === m.pub && peers[id].link.open) { ch.send({ k: 'hi-ok', f: 'host', to: id, pub: peers[id].pubOut }); return; }
        try {
          const { kp, pub } = await newPair();
          const key = await sharedKey(kp, m.pub);
          const old = peers[id];
          if (old) { old.link.onShut = null; old.link.close(); }
          const link = makeLink('relay-' + id, async (msg) => ch.send({ k: 'd', f: 'host', to: id, ...(await lock(key, msg)) }));
          link.open = true;
          link.onShut = () => { if (peers[id]?.link === link) delete peers[id]; ch.send({ k: 'bye', f: 'host', to: id }); };
          peers[id] = { key, link, chain: Promise.resolve(), pubIn: m.pub, pubOut: pub };
          ch.send({ k: 'hi-ok', f: 'host', to: id, pub });
          onLink(link);
        } catch {}
        return;
      }
      const p = peers[id];
      if (m.k === 'd' && m.to === 'host' && p) p.chain = p.chain.then(async () => { const msg = await unlock(p.key, m); if (p.link.open) p.link.emit('data', msg); }).catch(() => {});
    },
  });
  return { get open() { return ch.open; }, close() { clearInterval(bossTimer); for (const p of Object.values(peers)) { p.link.onShut = null; p.link.open = false; } ch.close(); } };
}

// A player's side. Resolves to a locked link once the host has answered, or null after `wait` milliseconds.
// note (optional) gets note.openAt: when the channel itself opened, so the caller can tell 'no host there' from 'no channel'.
export function guestRelay(code, urlOverride, myId, wait = 15000, note = null) {
  return new Promise((resolve) => {
    let done = false, hello = null, pair = null, key = null, link = null, chain = Promise.resolve();
    const finish = (x) => { if (done) return; done = true; clearInterval(hello); clearTimeout(timer); if (!x) ch.close(); resolve(x); };
    const timer = setTimeout(() => finish(null), wait);
    const ch = channel(code, urlOverride, {
      onOpen: async () => {
        if (note && !note.openAt) note.openAt = Date.now();
        if (link) { link.close(); return; } // the channel dropped and came back: start over from the game's side
        try { pair ||= await newPair(); } catch { finish(null); return; }
        const say = () => ch.send({ k: 'hi', f: myId, pub: pair.pub });
        say(); clearInterval(hello); hello = setInterval(say, 3000);
      },
      onClose: () => { if (link) link.close(); },
      onMsg: async (m) => {
        if (!m || m.f !== 'host' || m.to !== myId) return;
        if (m.k === 'hi-ok' && !link && pair && typeof m.pub === 'string') {
          try { key = await sharedKey(pair.kp, m.pub); } catch { return; }
          if (link) return;
          link = makeLink('relay-host', async (msg) => ch.send({ k: 'd', f: myId, to: 'host', ...(await lock(key, msg)) }));
          link.open = true;
          link.onShut = () => ch.close();
          finish(link);
        } else if (m.k === 'd' && link) chain = chain.then(async () => { const msg = await unlock(key, m); if (link.open) link.emit('data', msg); }).catch(() => {});
        else if (m.k === 'bye' && link) link.close();
      },
    });
  });
}
