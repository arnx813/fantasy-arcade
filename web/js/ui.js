// Tiny DOM toolkit: h() builds elements, plus toast and modal.
export function h(tag, props = {}, ...children) {
  if (props === null || typeof props !== 'object' || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  const svg = tag.startsWith('svg:');
  const el = svg ? document.createElementNS('http://www.w3.org/2000/svg', tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.setAttribute('class', v);
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && !svg && k !== 'list') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export const clear = (el, ...children) => { el.replaceChildren(); append(el, children); return el; };

export function toast(message, kind = 'info', ms = 3600) {
  const t = h('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

export function modal(title, body, { wide = false, onClose } = {}) {
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); onClose?.(); };
  const esc = (e) => e.key === 'Escape' && close();
  const overlay = h('div', { class: 'overlay', onClick: (e) => e.target === overlay && close() },
    h('div', { class: `modal ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal-head' }, h('h2', title), h('button', { class: 'icon-btn', 'aria-label': 'Close', onClick: close, html: ICONS.x })),
      h('div', { class: 'modal-body' }, body)));
  document.body.append(overlay);
  document.addEventListener('keydown', esc);
  overlay.querySelector('input, button.btn')?.focus();
  return { close, el: overlay };
}

const svgIcon = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICONS = {
  x: svgIcon('<path d="M6 6l12 12M18 6L6 18"/>'),
  menu: svgIcon('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  chat: svgIcon('<path d="M4 5h16v11H9l-5 4z"/>'),
  home: svgIcon('<path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z"/>'),
  joystick: svgIcon('<circle cx="12" cy="6" r="3"/><path d="M12 9v6M6 15h12l1 5H5z"/>'),
  reels: svgIcon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M9 5v14M15 5v14"/>'),
  crown: svgIcon('<path d="M4 18h16l-1-10-4 4-3-6-3 6-4-4z"/>'),
  users: svgIcon('<circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5M16 5a3 3 0 010 6M21 20c0-2-1-4-3-5"/>'),
  shield: svgIcon('<path d="M12 3l8 3v6c0 5-4 8-8 9-4-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>'),
  history: svgIcon('<path d="M3 12a9 9 0 103-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
  gear: svgIcon('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 005 12a7 7 0 00.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.4 1 2-3.4-2-1.6A7 7 0 0019 12z"/>'),
  lock: svgIcon('<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>'),
  wallet: svgIcon('<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M16 12h5M3 9h18"/>'),
  copy: svgIcon('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 00-1-1H5a1 1 0 00-1 1v10a1 1 0 001 1h3"/>'),
  chart: svgIcon('<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>'),
};

export function copyText(text) {
  navigator.clipboard?.writeText(text).then(() => toast('Copied', 'success', 1500), () => toast('Copy failed', 'error'));
}
