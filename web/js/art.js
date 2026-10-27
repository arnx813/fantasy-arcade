// Lobby tile artwork: each original gets its own marquee colour and a geometric motif
// drawn from the game's own objects. Pure SVG strings, no image assets.
const W = 300, H = 400;
// Gradient ids must be unique per inline SVG on the page, or every tile reuses the first.
let gid = 0;
const bg = (a, b) => { const id = `tg${++gid}`; return `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#${id})"/>`; };
const wrap = (inner) => `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`;
const bulbs = (c) => [...Array(9)].map((_, i) => `<circle cx="${30 + i * 30}" cy="18" r="4" fill="${c}" opacity="${i % 2 ? 0.9 : 0.45}"/>`).join('');

const MOTIFS = {
  crash: () => bg('#ff6a3d', '#7a1e3c') + bulbs('#ffd9a8') +
    `<path d="M20 290 C 120 285, 190 240, 250 90" stroke="#fff" stroke-width="10" fill="none" stroke-linecap="round"/>
     <g transform="translate(250 90) rotate(-62)"><path d="M0-22 L13 10 L0 4 L-13 10Z" fill="#ffd23f"/><circle r="4" cy="-4" fill="#7a1e3c"/></g>
     <circle cx="252" cy="88" r="38" fill="none" stroke="#ffd23f" stroke-width="3" stroke-dasharray="4 8"/>`,
  mines: () => bg('#2fbf8f', '#124a3e') + bulbs('#c4ffe9') +
    [...Array(16)].map((_, i) => { const x = 40 + (i % 4) * 58, y = 70 + Math.floor(i / 4) * 58; const bomb = i === 6 || i === 13;
      return `<rect x="${x}" y="${y}" width="48" height="48" rx="8" fill="${bomb ? '#0d2e27' : i % 3 ? '#4fe0ae' : '#8ff5cf'}"/>` +
        (bomb ? `<circle cx="${x + 24}" cy="${y + 26}" r="12" fill="#ff5d73"/><path d="M${x + 30} ${y + 14} l6 -6" stroke="#ffd23f" stroke-width="3"/>` :
          `<path d="M${x + 24} ${y + 12} l10 12 -10 12 -10 -12z" fill="#fff" opacity="${i % 3 ? 0.55 : 0.9}"/>`); }).join(''),
  plinko: () => bg('#d23de0', '#4b1466') + bulbs('#f7c8ff') +
    [...Array(7)].map((_, r) => [...Array(r + 3)].map((_, c) => `<circle cx="${150 + (c - (r + 2) / 2) * 34}" cy="${60 + r * 34}" r="5" fill="#fff" opacity="0.85"/>`).join('')).join('') +
    `<circle cx="167" cy="128" r="11" fill="#ffd23f"/>` +
    [...Array(9)].map((_, i) => `<rect x="${12 + i * 31}" y="306" width="27" height="20" rx="4" fill="${['#ff5d73', '#ff8a4d', '#ffb320', '#ffd23f', '#fff1a8', '#ffd23f', '#ffb320', '#ff8a4d', '#ff5d73'][i]}"/>`).join(''),
  dice: () => bg('#4d7cff', '#1c2a7a') + bulbs('#cfe0ff') +
    `<g transform="translate(150 175) rotate(-14)"><rect x="-70" y="-70" width="140" height="140" rx="26" fill="#fff"/>
     ${[[-35, -35], [35, -35], [0, 0], [-35, 35], [35, 35]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13" fill="#1c2a7a"/>`).join('')}</g>
     <rect x="30" y="296" width="240" height="12" rx="6" fill="#ff5d73"/><rect x="30" y="296" width="132" height="12" rx="6" fill="#45e0a8"/>`,
  limbo: () => bg('#ffb320', '#9a3a00') + bulbs('#fff0c2') +
    `${[0, 1, 2, 3, 4].map((i) => `<rect x="${40 + i * 48}" y="${280 - i * 44}" width="34" height="${30 + i * 44}" rx="6" fill="#fff" opacity="${0.35 + i * 0.15}"/>`).join('')}
     <path d="M30 70 h240" stroke="#fff" stroke-width="4" stroke-dasharray="10 10"/>`,
  blackjack: () => bg('#1aa36b', '#0b4a33') + bulbs('#bff5dd') +
    `<g transform="translate(110 170) rotate(-10)"><rect x="-55" y="-78" width="110" height="156" rx="12" fill="#fff"/><text x="0" y="22" text-anchor="middle" font-family="Rubik, sans-serif" font-size="64" fill="#1b1b22">A</text></g>
     <g transform="translate(190 185) rotate(9)"><rect x="-55" y="-78" width="110" height="156" rx="12" fill="#fff"/><text x="0" y="22" text-anchor="middle" font-family="Rubik, sans-serif" font-size="56" fill="#d1304a">K</text></g>`,
  hilo: () => bg('#ff4f8b', '#6e1640') + bulbs('#ffd0e1') +
    `<path d="M150 60 l50 60 h-100z" fill="#fff"/><path d="M150 330 l50 -60 h-100z" fill="#fff" opacity="0.55"/>
     <rect x="105" y="140" width="90" height="120" rx="12" fill="#fff"/><text x="150" y="222" text-anchor="middle" font-family="Rubik, sans-serif" font-size="56" fill="#6e1640">7</text>`,
  keno: () => bg('#7a5cff', '#2c1b7a') + bulbs('#dcd2ff') +
    [...Array(25)].map((_, i) => { const x = 36 + (i % 5) * 48, y = 60 + Math.floor(i / 5) * 48; const hit = [2, 8, 11, 17, 21].includes(i);
      return `<rect x="${x}" y="${y}" width="40" height="40" rx="8" fill="${hit ? '#ffd23f' : '#fff'}" opacity="${hit ? 1 : 0.22}"/>`; }).join(''),
  tower: () => bg('#23b5d3', '#0d4a66') + bulbs('#c8f3ff') +
    [...Array(6)].map((_, r) => [0, 1, 2].map((c) => `<rect x="${55 + c * 66}" y="${300 - r * 46}" width="56" height="36" rx="7" fill="${r < 3 && c === (r % 3) ? '#ffd23f' : '#fff'}" opacity="${r < 3 && c === (r % 3) ? 1 : 0.25}"/>`).join('')).join(''),
  wheel: () => bg('#ff7a2f', '#7a2410') + bulbs('#ffe0c8') +
    `<g transform="translate(150 190)">${[...Array(12)].map((_, i) => `<path d="M0 0 L${Math.cos((i * 30 * Math.PI) / 180) * 105} ${Math.sin((i * 30 * Math.PI) / 180) * 105} A105 105 0 0 1 ${Math.cos(((i + 1) * 30 * Math.PI) / 180) * 105} ${Math.sin(((i + 1) * 30 * Math.PI) / 180) * 105}Z" fill="${['#fff', '#ffd23f', '#7a2410', '#45e0a8'][i % 4]}" opacity="0.9"/>`).join('')}<circle r="22" fill="#7a2410"/></g>
     <path d="M150 70 l-12 -22 h24z" fill="#fff"/>`,
  roulette: () => bg('#c7283f', '#4d0d1d') + bulbs('#ffc9d2') +
    `<g transform="translate(150 190)"><circle r="108" fill="#2a0b14"/>${[...Array(18)].map((_, i) => `<path d="M0 0 L${Math.cos((i * 20 * Math.PI) / 180) * 98} ${Math.sin((i * 20 * Math.PI) / 180) * 98} A98 98 0 0 1 ${Math.cos(((i + 1) * 20 * Math.PI) / 180) * 98} ${Math.sin(((i + 1) * 20 * Math.PI) / 180) * 98}Z" fill="${i === 0 ? '#1aa36b' : i % 2 ? '#e33b55' : '#1b1426'}"/>`).join('')}<circle r="52" fill="#4d0d1d"/><circle cx="62" cy="-48" r="9" fill="#fff"/></g>`,
  baccarat: () => bg('#3a8f9c', '#123a44') + bulbs('#c9f0f5') +
    `<g transform="translate(95 190) rotate(-6)"><rect x="-50" y="-70" width="100" height="140" rx="12" fill="#fff"/><text x="0" y="20" text-anchor="middle" font-family="Rubik, sans-serif" font-size="56" fill="#1b1b22">9</text></g>
     <g transform="translate(205 190) rotate(6)"><rect x="-50" y="-70" width="100" height="140" rx="12" fill="#fff" opacity="0.6"/><text x="0" y="20" text-anchor="middle" font-family="Rubik, sans-serif" font-size="56" fill="#d1304a">6</text></g>`,
  videopoker: () => bg('#5965ff', '#1e2273') + bulbs('#d3d6ff') +
    [0, 1, 2, 3, 4].map((i) => `<rect x="${22 + i * 52}" y="${130 + (i === 2 ? -12 : 0)}" width="46" height="66" rx="7" fill="#fff" opacity="${i === 4 ? 0.45 : 1}"/><text x="${45 + i * 52}" y="${174 + (i === 2 ? -12 : 0)}" text-anchor="middle" font-family="Rubik, sans-serif" font-size="22" fill="${i % 2 ? '#d1304a' : '#1e2273'}">${['10', 'J', 'Q', 'K', 'A'][i]}</text>`).join('') +
    `<rect x="40" y="236" width="220" height="10" rx="5" fill="#ffd23f"/>`,
  coinflip: () => bg('#f2c230', '#8a5a00') + bulbs('#fff3c4') +
    `<ellipse cx="150" cy="190" rx="92" ry="92" fill="#ffe27a" stroke="#fff" stroke-width="8"/><ellipse cx="150" cy="190" rx="62" ry="62" fill="none" stroke="#8a5a00" stroke-width="6" stroke-dasharray="6 9"/>
     <path d="M130 160 h40 l-12 22 h12 l-30 40 8-30 h-14z" fill="#8a5a00"/>`,
};

export const tileArt = (id) => wrap((MOTIFS[id] || MOTIFS.dice)());
export const GAME_COLORS = { crash: '#ff6a3d', mines: '#2fbf8f', plinko: '#d23de0', dice: '#4d7cff', limbo: '#ffb320', blackjack: '#1aa36b', hilo: '#ff4f8b', keno: '#7a5cff', tower: '#23b5d3', wheel: '#ff7a2f', roulette: '#c7283f', baccarat: '#3a8f9c', videopoker: '#5965ff', coinflip: '#f2c230' };

// Provider titles get a generated pattern from their id so each looks distinct.
export function providerArt(id, name) {
  let seed = [...id].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const hue = Math.floor(rnd() * 360);
  const shapes = [...Array(14)].map(() => {
    const x = rnd() * 300, y = rnd() * 225, r = 10 + rnd() * 40;
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="hsl(${(hue + rnd() * 80) % 360} 85% ${55 + rnd() * 20}%)" opacity="${0.25 + rnd() * 0.5}"/>`;
  }).join('');
  return `<svg viewBox="0 0 300 225" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><rect width="300" height="225" fill="hsl(${hue} 55% 22%)"/>${shapes}</svg>`;
}

// Lobby hero: an original night-arcade scene drawn from simple shapes. The cabinet
// screen (x 890-1050, y 120-230 in a 1200x420 box) is left blank: the live Crash
// multiplier is laid over it in HTML.
export function heroScene() {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const stars = [...Array(70)].map(() => `<circle cx="${(rnd() * 1200).toFixed(0)}" cy="${(rnd() * 230).toFixed(0)}" r="${(0.6 + rnd() * 1.6).toFixed(1)}" fill="#fff" opacity="${(0.25 + rnd() * 0.6).toFixed(2)}"/>`).join('');
  // Skyline: deterministic blocks with a few lit windows.
  let x = 0, blocks = '', windows = '';
  while (x < 1200) {
    const w = 40 + rnd() * 70, ht = 60 + rnd() * 120;
    blocks += `<rect x="${x.toFixed(0)}" y="${(420 - ht).toFixed(0)}" width="${w.toFixed(0)}" height="${ht.toFixed(0)}" fill="#15121f"/>`;
    for (let wy = 420 - ht + 12; wy < 400; wy += 18) for (let wx = x + 8; wx < x + w - 10; wx += 14)
      if (rnd() < 0.18) windows += `<rect x="${wx.toFixed(0)}" y="${wy.toFixed(0)}" width="6" height="8" fill="${rnd() < 0.5 ? '#ff2e88' : '#29d8ff'}" opacity="0.55"/>`;
    x += w + 4;
  }
  return `<svg viewBox="0 0 1200 420" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="hs-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0c0b14"/><stop offset="0.55" stop-color="#231342"/><stop offset="1" stop-color="#3a1240"/></linearGradient>
    <radialGradient id="hs-moon" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#fff4fb"/><stop offset="0.7" stop-color="#ffd6ec"/><stop offset="1" stop-color="#ff9fd0" stop-opacity="0"/></radialGradient>
    <radialGradient id="hs-glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#ff2e88" stop-opacity="0.55"/><stop offset="1" stop-color="#ff2e88" stop-opacity="0"/></radialGradient>
    <linearGradient id="hs-cab" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#1c1730"/><stop offset="1" stop-color="#2b2147"/></linearGradient>
    <linearGradient id="hs-trail" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#29d8ff" stop-opacity="0"/><stop offset="1" stop-color="#29d8ff"/></linearGradient>
    <filter id="hs-blur"><feGaussianBlur stdDeviation="6"/></filter>
  </defs>
  <rect width="1200" height="420" fill="url(#hs-sky)"/>
  ${stars}
  <circle cx="700" cy="96" r="70" fill="url(#hs-moon)" opacity="0.9"/>
  <!-- Crash rocket arcing across the sky -->
  <path d="M520 360 C 640 340, 760 260, 840 120" stroke="url(#hs-trail)" stroke-width="5" fill="none" stroke-linecap="round"/>
  <path d="M520 360 C 640 340, 760 260, 840 120" stroke="#29d8ff" stroke-width="14" fill="none" opacity="0.18" filter="url(#hs-blur)"/>
  <g transform="translate(842 116) rotate(-58)"><path d="M0 -16 L9 8 L0 3 L-9 8 Z" fill="#fff"/><path d="M-4 9 L0 20 L4 9 Z" fill="#ff2e88"/></g>
  ${blocks}${windows}
  <rect y="400" width="1200" height="20" fill="#0d0b14"/>
  <!-- Neon glow pooling under the cabinet -->
  <ellipse cx="970" cy="404" rx="190" ry="26" fill="url(#hs-glow)"/>
  <!-- Arcade cabinet -->
  <g>
    <path d="M870 70 h200 l14 26 v304 h-228 v-304 z" fill="url(#hs-cab)" stroke="#ff2e88" stroke-width="3"/>
    <rect x="880" y="80" width="180" height="26" rx="6" fill="#ff2e88"/>
    <text x="970" y="99" text-anchor="middle" font-family="Bungee, sans-serif" font-size="17" fill="#fff">FANTASY</text>
    <rect x="884" y="114" width="172" height="122" rx="10" fill="#07060c" stroke="#29d8ff" stroke-width="3"/>
    <path d="M864 250 h212 l-16 46 h-180 z" fill="#241c3d" stroke="#ff2e88" stroke-width="2"/>
    <circle cx="930" cy="272" r="9" fill="#29d8ff"/><rect x="928" y="252" width="4" height="20" rx="2" fill="#9aa"/>
    <circle cx="990" cy="272" r="8" fill="#ff2e88"/><circle cx="1018" cy="266" r="8" fill="#ffd23f"/><circle cx="1036" cy="280" r="8" fill="#3ee08f"/>
    <rect x="930" y="318" width="80" height="44" rx="6" fill="#120f1f" stroke="#2f2650"/>
    <rect x="958" y="332" width="24" height="5" rx="2" fill="#ff2e88"/>
  </g>
</svg>`;
}
