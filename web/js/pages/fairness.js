// Fairness: seed management plus an in-browser verifier that recomputes results with
// WebCrypto and the same engine code the server runs (served from /shared).
import { h, clear, toast, ICONS, copyText } from '../ui.js';
import { ENGINES } from '/shared/games/index.js';
import { bytesToFloats, arrayRng, cardLabel } from '/shared/fair.js';
import { crashFromHmacHex } from '/shared/crash.js';
import { GAME_NAMES, mult } from '../format.js';

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(key, msg) {
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}
export async function floatsFor(serverSeed, clientSeed, nonce, blocks = 64) {
  const out = [];
  for (let r = 0; r < blocks; r++) out.push(...bytesToFloats(await hmac(serverSeed, `${clientSeed}:${nonce}:${r}`)));
  return out;
}
const sha256 = async (s) => hex(await crypto.subtle.digest('SHA-256', enc.encode(s)));

function describe(game, e, rng, params) {
  if (e.kind === 'instant') {
    const r = e.play(rng, params, 1_000_000);
    const o = r.outcome;
    const m = r.multBp !== undefined ? mult(r.multBp / 10000) : null;
    switch (game) {
      case 'dice': return [`Roll ${o.roll.toFixed(2)}`, m];
      case 'limbo': return [`Result ${mult(o.result)}`, o.win ? 'win' : 'loss'];
      case 'coinflip': return [`Landed ${o.side}`];
      case 'plinko': return [`Path ${o.path.map((x) => (x ? 'R' : 'L')).join('')}`, `bin ${o.bin}`, mult(o.multiplier)];
      case 'keno': return [`Drawn ${o.drawn.join(', ')}`, `${o.hits.length} hits`, mult(o.multiplier)];
      case 'wheel': return [`Segment ${o.segment}`, mult(o.multiplier)];
      case 'roulette': return [`Pocket ${o.number} (${o.color})`];
      case 'baccarat': return [`Player ${o.player.map(cardLabel).join(' ')} = ${o.playerTotal}`, `Banker ${o.banker.map(cardLabel).join(' ')} = ${o.bankerTotal}`, `${o.winner} wins`];
    }
    return [JSON.stringify(o)];
  }
  const s = e.start(rng, params);
  switch (game) {
    case 'mines': return [`Mines on tiles ${s.mineSet.map((t) => t + 1).sort((a, b) => a - b).join(', ')} (1-25, left to right, top to bottom)`];
    case 'tower': return s.layout.map((safe, i) => `Floor ${i + 1}: safe door${safe.length > 1 ? 's' : ''} ${safe.map((d) => d + 1).join(', ')}`);
    case 'videopoker': return [`Dealt ${s.deck.slice(0, 5).map(cardLabel).join(' ')}`, `Replacements in order ${s.deck.slice(5).map(cardLabel).join(' ')}`];
    case 'hilo': case 'blackjack': {
      const cards = [...Array(game === 'hilo' ? 20 : 12)].map((_, i) => cardLabel(Math.floor(rng.float(i) * 52)));
      return [`Card sequence ${cards.join(' ')}`, game === 'blackjack' ? 'Dealt in order: you, dealer, you, dealer (hole), then each hit, double or split card, then dealer draws.' : 'First card is the starting card; skips and guesses draw the next in order.'];
    }
  }
  return [];
}

export async function render(page, _p, ctx) {
  const q = new URLSearchParams(location.search);
  page.append(h('h1', 'Fairness'),
    h('p', { class: 'muted', style: { margin: '8px 0 24px', maxWidth: '68ch' } },
      'Every original game result comes from three inputs: a server seed we commit to in advance (you see its SHA-256 hash), a client seed you choose, and a nonce that counts your bets. Rotate your seed pair to reveal the server seed, then recompute any bet here. The math runs in your browser.'));

  // ---- seeds ----
  const seedBox = h('div', { class: 'panel stack', style: { marginBottom: '20px' } });
  page.append(h('h2', { style: { marginBottom: '12px' } }, 'Your seeds'), seedBox);
  const showSeeds = async () => {
    if (!ctx.store.get('me')) { clear(seedBox, h('p', { class: 'muted' }, 'Sign in to manage your seeds.')); return; }
    const s = await ctx.api.get('/api/fair/seeds');
    const input = h('input', { class: 'input', value: '', placeholder: 'New client seed (leave empty for random)', maxLength: 64 });
    const line = (k, v) => h('label', { class: 'field' }, k, h('div', { class: 'address-box row' }, h('span', { class: 'grow' }, v), h('button', { class: 'icon-btn', 'aria-label': `Copy ${k}`, html: ICONS.copy, onClick: () => copyText(v) })));
    clear(seedBox,
      line('Active client seed', s.clientSeed), line('Active server seed (hashed)', s.serverSeedHash),
      h('div', { class: 'small muted' }, `Bets on this pair: ${s.nonce}`),
      line('Next server seed (hashed)', s.nextServerSeedHash),
      h('div', { class: 'row' }, input, h('button', { class: 'btn btn-primary', onClick: async () => {
        const r = await ctx.attempt(() => ctx.api.post('/api/fair/rotate', { clientSeed: input.value }));
        if (!r) return;
        toast('Seeds rotated. Previous server seed revealed below.', 'success');
        showSeeds();
        showRevealed();
      } }, 'Rotate')));
  };
  const revealed = h('div');
  const showRevealed = async () => {
    if (!ctx.store.get('me')) return;
    const list = await ctx.api.get('/api/fair/revealed');
    clear(revealed, list.length ? h('div', { class: 'panel', style: { padding: '8px', overflowX: 'auto', marginBottom: '20px' } }, h('table', { class: 'data small' },
      h('tr', h('th', 'Server seed'), h('th', 'Client seed'), h('th', { class: 'num' }, 'Bets')),
      list.map((x) => h('tr', h('td', { style: { wordBreak: 'break-all' } }, x.server_seed), h('td', x.client_seed), h('td', { class: 'num' }, String(x.nonce)))))) : null);
  };
  page.append(revealed);

  // ---- verifier ----
  const gameSel = h('select', { class: 'input' }, Object.keys(ENGINES).map((g) => h('option', { value: g, selected: q.get('game') === g }, GAME_NAMES[g])));
  const server = h('input', { class: 'input', value: q.get('server') || '', placeholder: 'Revealed server seed' });
  const client = h('input', { class: 'input', value: q.get('client') || '' });
  const nonce = h('input', { class: 'input', type: 'number', min: '0', value: q.get('nonce') || '0' });
  const params = h('input', { class: 'input', value: q.get('params') || '{}', 'aria-label': 'Game parameters as JSON' });
  const out = h('div', { class: 'stack' });
  const hashOut = h('div', { class: 'small muted', style: { wordBreak: 'break-all' } });
  const PARAM_HINTS = { dice: '{"target":50,"condition":"over"}', limbo: '{"target":2}', coinflip: '{"side":"heads"}', plinko: '{"rows":16,"risk":"high"}',
    keno: '{"picks":[1,2,3],"risk":"classic"}', wheel: '{"segments":30,"risk":"medium"}', roulette: '{"bets":[{"type":"red","amount":1}]}', baccarat: '{"player":1}',
    mines: '{"mines":3}', tower: '{"difficulty":"easy"}', hilo: '{}', blackjack: '{}', videopoker: '{}' };
  gameSel.addEventListener('change', () => (params.value = PARAM_HINTS[gameSel.value]));
  if (!q.get('params')) params.value = PARAM_HINTS[gameSel.value];
  const verify = async () => {
    try {
      const e = ENGINES[gameSel.value];
      const p = e.validate(JSON.parse(params.value || '{}'));
      const floats = await floatsFor(server.value.trim(), client.value, Number(nonce.value));
      hashOut.textContent = `SHA-256 of server seed: ${await sha256(server.value.trim())}`;
      clear(out, describe(gameSel.value, e, arrayRng(floats), p).filter(Boolean).map((x) => h('div', { class: 'address-box' }, x)));
    } catch (err) {
      clear(out, h('p', { class: 'loss' }, err.message));
    }
  };
  page.append(h('h2', { style: { marginBottom: '12px' } }, 'Verify a bet'),
    h('div', { class: 'panel stack', style: { marginBottom: '28px' } },
      h('div', { class: 'row', style: { flexWrap: 'wrap' } }, h('label', { class: 'field grow' }, 'Game', gameSel), h('label', { class: 'field grow' }, 'Nonce', nonce)),
      h('label', { class: 'field' }, 'Server seed', server), h('label', { class: 'field' }, 'Client seed', client),
      h('label', { class: 'field' }, 'Bet settings (JSON)', params),
      h('button', { class: 'btn btn-primary', onClick: verify }, 'Verify'), hashOut, out));

  // ---- crash ----
  const roundHash = h('input', { class: 'input', placeholder: 'Round hash (64 hex characters)' });
  const crashOut = h('div', { class: 'stack' });
  const chain = await ctx.api.get('/api/crash/chain').catch(() => []);
  page.append(h('h2', { style: { marginBottom: '12px' } }, 'Verify a Crash round'),
    h('div', { class: 'panel stack' },
      h('p', { class: 'small muted' }, 'Crash rounds come from a chain of SHA-256 hashes generated in advance. Hashing any round hash gives the previous round, all the way back to the published commitment below. The crash point is HMAC-SHA256 of the round hash keyed with the salt.'),
      chain.map((c) => h('div', { class: 'small', style: { wordBreak: 'break-all' } }, h('span', { class: 'muted' }, `Chain ${c.id} commitment: `), c.terminal_hash, h('span', { class: 'muted' }, ` · salt "${c.salt}" · ${c.used} of ${c.length} rounds used`))),
      h('label', { class: 'field' }, 'Round hash', roundHash),
      h('button', { class: 'btn btn-primary', onClick: async () => {
        const v = roundHash.value.trim();
        if (!/^[0-9a-f]{64}$/.test(v)) return toast('Enter a 64-character hex hash', 'error');
        const salt = chain[0]?.salt ?? '';
        const k = await crypto.subtle.importKey('raw', enc.encode(v), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
        const point = crashFromHmacHex(hex(await crypto.subtle.sign('HMAC', k, enc.encode(salt))));
        clear(crashOut, h('div', { class: 'address-box' }, `Crash point ${mult(point)}`), h('div', { class: 'address-box small' }, `Previous round hash ${await sha256(v)}`));
      } }, 'Verify round'), crashOut));

  showSeeds();
  showRevealed();
  if (q.get('server')) verify();
}
