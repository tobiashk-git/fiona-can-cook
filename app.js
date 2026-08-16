/* Fiona CAN cook — vanilla JS PWA, no build step.
   Everything starts empty: recipes are added in-app and live in IndexedDB.

   Data model (store 'recipes'):
     { id, title, status:'testing'|'approved', category, time, servings,
       story, ingredients[], method[], tags[], photos[{src,caption}],
       attempts[{id,date,rating,notes,photo}], createdAt, updatedAt, approvedAt }

   A recipe is born in TESTING. Each cook is logged as an attempt (rating + notes
   + optional photo). Approving moves it into the cookbook proper, test log intact.
   Photos are stored as blobs in the 'photos' store and referenced as 'idb:<id>'.
*/
(() => {
'use strict';

// ---------- Categories ----------
const CATEGORIES = [
  { id: 'weeknight', name: 'Weeknight' },
  { id: 'batch',     name: 'Batch & Prep' },
  { id: 'entertain', name: 'Entertaining' },
  { id: 'light',     name: 'Brunch & Light' },
  { id: 'sweet',     name: 'Sweet' },
  { id: 'drinks',    name: 'Drinks' },
];
const catById = id => CATEGORIES.find(c => c.id === id) || CATEGORIES[0];

// ---------- Icons (inline SVG, stroke = currentColor) ----------
const PATHS = {
  home:    '<path d="M3 10.6 12 3.2l9 7.4"/><path d="M5.6 9.4V20.3h12.8V9.4"/>',
  book:    '<path d="M4 4.2h6.2A2.2 2.2 0 0 1 12 6.4v13.4a1.8 1.8 0 0 0-1.8-1.6H4z"/><path d="M20 4.2h-6.2A2.2 2.2 0 0 0 12 6.4v13.4a1.8 1.8 0 0 1 1.8-1.6H20z"/>',
  flask:   '<path d="M9.2 3h5.6"/><path d="M10.3 3v6.4l-5 8.5A1.9 1.9 0 0 0 7 21h10a1.9 1.9 0 0 0 1.7-3.1l-5-8.5V3"/>',
  plus:    '<path d="M12 5.5v13M5.5 12h13"/>',
  search:  '<circle cx="11" cy="11" r="6.8"/><path d="M16.2 16.2 21 21"/>',
  chevron: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  clock:   '<circle cx="12" cy="12" r="8.6"/><path d="M12 6.9V12l3.4 2"/>',
  camera:  '<path d="M3.2 8.4h3.4l1.5-2.2h6.8l1.5 2.2h3.4v10H3.2z"/><circle cx="12" cy="13.3" r="3.3"/>',
};
function icon(name, cls = '') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('fill', 'none');
  s.setAttribute('stroke', 'currentColor');
  s.setAttribute('stroke-width', '1.7');
  s.setAttribute('stroke-linecap', 'round');
  s.setAttribute('stroke-linejoin', 'round');
  s.innerHTML = PATHS[name] || '';
  if (cls) s.setAttribute('class', cls);
  return s;
}

// ---------- IndexedDB ----------
const DB = (() => {
  let dbp;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const r = indexedDB.open('fiona-can-cook', 1);
      r.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('recipes')) db.createObjectStore('recipes', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos'))  db.createObjectStore('photos',  { keyPath: 'id' });
      };
      r.onsuccess = e => res(e.target.result);
      r.onerror = () => rej(r.error);
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return open().then(db => new Promise((res, rej) => {
      const t = db.transaction(store, mode);
      let out;
      Promise.resolve(fn(t.objectStore(store))).then(v => { out = v; });
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    }));
  }
  const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    getAll: store => tx(store, 'readonly', s => req(s.getAll())),
    get: (store, id) => tx(store, 'readonly', s => req(s.get(id))),
    put: (store, val) => tx(store, 'readwrite', s => { s.put(val); }),
    del: (store, id) => tx(store, 'readwrite', s => { s.delete(id); }),
  };
})();

// ---------- State ----------
const state = { recipes: [], photoURLs: {} };

async function loadData() {
  const all = await DB.getAll('recipes').catch(() => []);
  state.recipes = all;
  sortRecipes();
}
function sortRecipes() {
  state.recipes.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}
const getRecipe = id => state.recipes.find(r => r.id === id);
const approved = () => state.recipes.filter(r => r.status === 'approved');
const testing  = () => state.recipes.filter(r => r.status !== 'approved');

async function saveRecipe(r) {
  r.updatedAt = Date.now();
  await DB.put('recipes', r);
  const i = state.recipes.findIndex(x => x.id === r.id);
  if (i >= 0) state.recipes[i] = r; else state.recipes.push(r);
  sortRecipes();
}

// ---------- Small helpers ----------
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  kids.flat().forEach(k => { if (k === null || k === undefined || k === '') return; n.append(k?.nodeType ? k : document.createTextNode(k)); });
  return n;
};
const linesOf = t => t.split('\n').map(s => s.trim()).filter(Boolean);
const slugify = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'recipe';
const uid = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function fmtTime(mins) {
  const m = Number(mins);
  if (!m || m <= 0) return null;
  if (m < 60) return m + ' min';
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}` : `${h} hr`;
}
function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}
const attempts = r => r.attempts || [];
function avgRating(r) {
  const rated = attempts(r).filter(a => a.rating > 0);
  if (!rated.length) return 0;
  return rated.reduce((s, a) => s + a.rating, 0) / rated.length;
}
const starStr = n => '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n));
function lastCooked(r) {
  const ds = attempts(r).map(a => +new Date(a.date)).filter(n => !isNaN(n));
  return ds.length ? Math.max(...ds) : 0;
}
function snippet(r) {
  const last = attempts(r).slice(-1)[0];
  if (last && last.notes) return '“' + last.notes + '”';
  return r.story || (r.ingredients || []).slice(0, 4).join(' · ');
}
function toast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = el('div', { class: 'toast' }); document.body.append(t); }
  t.textContent = msg; t.classList.add('show');
  clearTimeout(t._t); t._t = setTimeout(() => t.classList.remove('show'), 2000);
}

// ---------- Photos ----------
async function photoURL(src) {
  if (!src) return null;
  if (!src.startsWith('idb:')) return src;
  const id = src.slice(4);
  if (state.photoURLs[id]) return state.photoURLs[id];
  const rec = await DB.get('photos', id).catch(() => null);
  if (!rec) return null;
  const url = URL.createObjectURL(rec.blob);
  state.photoURLs[id] = url;
  return url;
}
async function resolvePhotos(r) {
  const out = [];
  for (const p of (r.photos || [])) {
    const url = await photoURL(p.src);
    if (url) out.push({ url, caption: p.caption || '' });
  }
  return out;
}
// the chosen cookbook photo if there is one, otherwise the most recent cook
async function coverURL(r) {
  for (const p of (r.photos || [])) { const u = await photoURL(p.src); if (u) return u; }
  for (const a of [...attempts(r)].reverse()) { if (a.photo) { const u = await photoURL(a.photo); if (u) return u; } }
  return null;
}
/* Long edge 2200px: the cover box is 720 CSS px wide, which is 1440 device px on a
   retina/high-DPI screen. A portrait phone photo stored at 1400 long edge is only
   1050 wide, so it got upscaled 1.37x and looked out of focus. 2200 keeps every
   orientation downsampling (sharp) for ~500KB a photo. */
function downscale(file, max = 2200, quality = 0.82) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > max || height > max) {
        const s = max / Math.max(width, height);
        width = Math.round(width * s); height = Math.round(height * s);
      }
      const c = document.createElement('canvas');
      c.width = width; c.height = height;
      c.getContext('2d').drawImage(img, 0, 0, width, height);
      c.toBlob(b => resolve(b || file), 'image/jpeg', quality);
    };
    img.onerror = () => resolve(file);
    img.src = URL.createObjectURL(file);
  });
}
function imgDims(blob) {
  return new Promise(res => {
    const i = new Image();
    i.onload = () => res({ w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => res({ w: 0, h: 0 });
    i.src = URL.createObjectURL(blob);
  });
}
// device pixels the cover needs on a high-DPI screen (720 CSS px x 2)
const COVER_PX = 1440;

async function storePhoto(blob) {
  const id = uid('p_');
  await DB.put('photos', { id, blob });
  return 'idb:' + id;
}

// ---------- Tags ----------
const VOCAB = ['salmon','tuna','cod','prawn','sea bass','chicken','beef','pork','lamb','sausage','bacon','chorizo','egg','tofu','halloumi','feta','parmesan','mozzarella','ricotta','cheese','yoghurt','cream','butter','miso','soy','ginger','garlic','chilli','lime','lemon','orange','tomato','onion','shallot','leek','spinach','kale','broccoli','courgette','aubergine','pepper','mushroom','potato','sweet potato','squash','carrot','avocado','cucumber','pea','bean','chickpea','lentil','rice','pasta','noodle','orzo','couscous','quinoa','bread','flour','oats','tahini','harissa','pesto','coconut','curry','basil','coriander','parsley','mint','thyme','rosemary','chocolate','vanilla','honey','maple','almond','pistachio','walnut','wine','vermouth','gin','vodka','prosecco'];
function deriveTags(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  return VOCAB.filter(v => t.includes(v)).slice(0, 8);
}
function allTags(list) {
  const set = new Set();
  list.forEach(r => (r.tags || []).forEach(t => set.add(t)));
  return [...set].sort();
}

// ---------- Router ----------
const app = document.getElementById('app');
const go = h => { location.hash = h; };
const parseHash = () => location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
window.addEventListener('hashchange', render);

async function render() {
  const [route, arg] = parseHash();
  window.scrollTo(0, 0);
  switch (route) {
    case 'cookbook': return viewCookbook(arg);
    case 'testing':  return viewTesting();
    case 'recipe':   return viewRecipe(arg);
    case 'new':      return viewForm(null);
    case 'edit':     return viewForm(arg);
    case 'search':   return viewSearch();
    case 'backup':   return viewBackup();
    case 'shared':   return viewShared(arg);
    default:         return viewHome();
  }
}

// ---------- Chrome ----------
function topbar(title, { back = false, action = null } = {}) {
  const inner = el('div', { class: 'inner' });
  if (back) inner.append(el('button', { class: 'back', 'aria-label': 'Back', onclick: () => history.length > 1 ? history.back() : go('/') }, '‹'));
  inner.append(el('h1', {}, title), el('div', { class: 'spacer' }));
  if (action) inner.append(el('button', { class: 'tb-act', onclick: action.onclick }, action.label));
  return el('div', { class: 'topbar' }, inner);
}
function tabbar(active) {
  const n = testing().length;
  const item = (href, ic, label, extra = '') => {
    const a = el('a', { href, class: (extra + (active === label.toLowerCase() ? ' active' : '')).trim() });
    const ti = el('span', { class: 'ti' }, icon(ic));
    a.append(ti, label);
    if (label === 'Testing' && n) a.append(el('span', { class: 'dot' }, String(n)));
    return a;
  };
  return el('nav', { class: 'tabbar' }, el('div', { class: 'inner' },
    item('#/', 'home', 'Home'),
    item('#/cookbook', 'book', 'Cookbook'),
    item('#/new', 'plus', 'Add', 'add'),
    item('#/testing', 'flask', 'Testing'),
    item('#/search', 'search', 'Search'),
  ));
}
function mount(nodes, activeTab) {
  app.innerHTML = '';
  [].concat(nodes).forEach(n => n && app.append(n));
  document.querySelectorAll('.tabbar').forEach(t => t.remove());
  document.body.append(tabbar(activeTab));
}

// ---------- Top-anchored sheet ----------
function openSheet(build) {
  const back = el('div', { class: 'sheet-back' });
  const inner = el('div', { class: 'sheet-in' });
  const sheet = el('div', { class: 'sheet' },
    el('button', { class: 'x', 'aria-label': 'Close', onclick: () => close() }, '×'),
    inner, el('div', { class: 'grab' }),
  );
  document.body.append(back, sheet);
  void sheet.offsetHeight;   // force a reflow so the slide-down transition runs (rAF is unreliable in background tabs)
  back.classList.add('in'); sheet.classList.add('in');
  back.addEventListener('click', () => close());
  const onKey = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  function close() {
    document.removeEventListener('keydown', onKey);
    back.classList.remove('in'); sheet.classList.remove('in');
    setTimeout(() => { back.remove(); sheet.remove(); }, 250);
  }
  build(inner, close);
  return close;
}
function sheetHead(title, sub) {
  return el('div', {}, el('h3', {}, title), sub ? el('p', { class: 'sub' }, sub) : '');
}

// ---------- Star picker ----------
function starPicker(initial = 0) {
  const box = el('div', { class: 'stars' });
  let v = initial;
  const btns = [];
  for (let i = 1; i <= 5; i++) {
    const b = el('button', { type: 'button', 'aria-label': i + ' out of 5' }, '★');
    b.addEventListener('click', () => set(i));
    btns.push(b); box.append(b);
  }
  function set(n) { v = n; btns.forEach((b, i) => b.classList.toggle('on', i < n)); }
  set(initial);
  box.value = () => v;
  return box;
}

// ---------- Recipe card ----------
async function recipeCard(r) {
  const thumb = el('div', { class: 'thumb' });
  const url = await coverURL(r);
  if (url) thumb.append(el('img', { src: url, alt: r.title, loading: 'lazy' }));
  else thumb.append(el('div', { class: 'ph' }, catById(r.category).name.slice(0, 2).toUpperCase()));

  const meta = el('div', { class: 'meta' });
  const t = fmtTime(r.time);
  if (t) meta.append(el('span', { class: 'time' }, t));
  meta.append(el('span', { class: 'pill' }, catById(r.category).name));
  if (r.status !== 'approved') {
    const n = attempts(r).length;
    meta.append(el('span', { class: 'pill testing' }, n ? `Testing · ${n} cook${n > 1 ? 's' : ''}` : 'Testing'));
  }
  const avg = avgRating(r);
  if (avg) meta.append(el('span', { class: 'rating' }, el('span', { class: 'st' }, starStr(avg)), ' ' + avg.toFixed(1)));

  return el('a', { href: `#/recipe/${r.id}`, class: 'rcard' },
    thumb,
    el('div', { class: 'body' }, el('h3', {}, r.title), meta, el('div', { class: 'snip' }, snippet(r))),
    icon('chevron', 'chev'),
  );
}
async function cardList(list) {
  const box = el('div', { class: 'list' });
  for (const r of list) box.append(await recipeCard(r));
  return box;
}
function emptyState(big, text, btnLabel, href) {
  const e = el('div', { class: 'empty' }, el('div', { class: 'big' }, big), el('p', {}, text));
  if (btnLabel) e.append(el('a', { class: 'btn', href }, btnLabel));
  return e;
}

// ---------- Home ----------
async function viewHome() {
  const wrap = el('div');
  const ap = approved(), te = testing();
  const cooks = state.recipes.reduce((s, r) => s + attempts(r).length, 0);

  const hero = el('div', { class: 'hero' },
    el('p', { class: 'eyebrow' }, 'Recipes on trial'),
    el('h1', { class: 'wordmark' }, 'Fiona ', el('em', {}, 'can'), ' cook'),
    el('p', { class: 'lede' }, 'Everything gets tested first. Only the ones worth cooking twice make it into the cookbook.'),
    el('div', { class: 'stats' },
      el('a', { href: '#/cookbook' }, el('span', { class: 'n' }, String(ap.length)), el('span', { class: 'l' }, 'In cookbook')),
      el('a', { href: '#/testing', class: te.length ? 'hot' : '' }, el('span', { class: 'n' }, String(te.length)), el('span', { class: 'l' }, 'In testing')),
      el('a', { href: '#/search' }, el('span', { class: 'n' }, String(cooks)), el('span', { class: 'l' }, 'Cooks logged')),
    ),
  );

  const searchBox = el('div', { class: 'searchbar' },
    el('div', { class: 'box', onclick: () => go('/search') },
      icon('search', 'ic'),
      el('input', { placeholder: 'Search recipes, ingredients…', readonly: 'readonly' })),
  );

  const body = el('div', { class: 'wrap' });

  if (!state.recipes.length) {
    body.append(
      el('div', { class: 'sec-h' }, 'Get started'),
      emptyState('Nothing here yet',
        'The cookbook is blank on purpose. Add the first recipe and it will start life in the testing kitchen.',
        'Add a recipe', '#/new'),
    );
  } else {
    // categories
    const grid = el('div', { class: 'catgrid' });
    CATEGORIES.forEach(c => {
      const n = ap.filter(r => r.category === c.id).length;
      grid.append(el('a', { href: `#/cookbook/${c.id}`, class: 'cat' + (n ? '' : ' empty-cat') },
        el('span', { class: 'bar' }),
        el('span', { class: 'nm' }, c.name),
        el('span', { class: 'ct' }, n ? `${n} recipe${n > 1 ? 's' : ''}` : 'empty'),
      ));
    });
    body.append(el('div', { class: 'sec-h' }, 'The cookbook', el('span', { class: 'count' }, `${ap.length} approved`)), grid);

    if (te.length) {
      const head = el('div', { class: 'sec-h' }, 'In testing', el('a', { href: '#/testing' }, 'See all'));
      const list = [...te].sort((a, b) => (lastCooked(b) || b.updatedAt) - (lastCooked(a) || a.updatedAt)).slice(0, 3);
      body.append(head, await cardList(list));
    }
    if (ap.length) {
      body.append(el('div', { class: 'sec-h' }, 'Latest in the cookbook'),
        await cardList([...ap].sort((a, b) => (b.approvedAt || 0) - (a.approvedAt || 0)).slice(0, 4)));
    }
  }

  // a backup nudge, but only once there is something worth losing
  const last = lastBackupAt();
  const newest = state.recipes.reduce((m, r) => Math.max(m, r.updatedAt || 0), 0);
  if (state.recipes.length && (!last || new Date(last).getTime() < newest)) {
    body.append(el('a', { href: '#/backup', class: 'banner', style: 'margin-top:26px' },
      last ? `Changes since your last backup — back up now` : 'Nothing is backed up yet. Keep a copy safe.'));
  }
  body.append(el('p', { class: 'foot' },
    'Saved on this device · ', el('a', { href: '#/backup', style: 'color:var(--accent);font-weight:700' }, 'Backup')));
  wrap.append(hero, searchBox, body);
  mount(wrap, 'home');
}

// ---------- Cookbook ----------
async function viewCookbook(catId) {
  const ap = approved();
  const active = catId && CATEGORIES.some(c => c.id === catId) ? catId : null;
  const list = active ? ap.filter(r => r.category === active) : ap;

  const body = el('div', { class: 'wrap' });
  const chips = el('div', { class: 'chips' },
    el('a', { href: '#/cookbook', class: 'chip' + (active ? '' : ' active') }, 'All'),
    CATEGORIES.map(c => el('a', { href: `#/cookbook/${c.id}`, class: 'chip' + (active === c.id ? ' active' : '') }, c.name)),
  );
  body.append(el('div', { style: 'height:14px' }), chips);
  body.append(el('div', { class: 'sec-h' }, active ? catById(active).name : 'Approved recipes',
    el('span', { class: 'count' }, `${list.length}`)));

  if (!list.length) {
    body.append(ap.length
      ? emptyState('Nothing in here yet', 'No approved recipes in this section. Cook something, log it, then approve it.', 'See the testing kitchen', '#/testing')
      : emptyState('The cookbook is empty', 'Recipes land here once they have been tested and approved.', 'Add a recipe', '#/new'));
  } else {
    body.append(await cardList(list));
  }

  mount(el('div', {}, topbar('Cookbook'), body), 'cookbook');
}

// ---------- Testing kitchen ----------
async function viewTesting() {
  const te = [...testing()].sort((a, b) => (lastCooked(b) || b.updatedAt) - (lastCooked(a) || a.updatedAt));
  const body = el('div', { class: 'wrap' });

  body.append(el('div', { class: 'sec-h' }, 'On trial', el('span', { class: 'count' }, `${te.length}`)));
  if (!te.length) {
    body.append(emptyState('Testing kitchen is clear',
      'Nothing waiting to be tried. Add a recipe and it starts here — log each cook, then approve the keepers.',
      'Add a recipe', '#/new'));
  } else {
    body.append(el('p', { class: 'foot', style: 'text-align:left;margin:0 0 14px' },
      'Log each cook as you go. When you are happy, approve it into the cookbook.'));
    body.append(await cardList(te));
  }

  mount(el('div', {}, topbar('Testing kitchen', { action: { label: 'ADD', onclick: () => go('/new') } }), body), 'testing');
}

// ---------- Search ----------
const searchState = { q: '', scope: 'all', tags: new Set() };
async function viewSearch() {
  const body = el('div', { class: 'wrap' });

  const input = el('input', { placeholder: 'Search title, ingredient, note…', value: searchState.q });
  input.addEventListener('input', () => { searchState.q = input.value; draw(); });
  body.append(el('div', { style: 'height:14px' }),
    el('div', { class: 'searchbar', style: 'padding:0;margin:0' },
      el('div', { class: 'box' }, icon('search', 'ic'), input)));

  const seg = el('div', { class: 'seg' });
  [['all', 'Everything'], ['approved', 'Cookbook'], ['testing', 'Testing']].forEach(([v, label]) => {
    const b = el('button', { class: searchState.scope === v ? 'active' : '' }, label);
    b.addEventListener('click', () => {
      searchState.scope = v;
      seg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      draw();
    });
    seg.append(b);
  });
  body.append(el('div', { class: 'sec-h' }, 'Where to look'), seg);

  const tags = allTags(state.recipes);
  if (tags.length) {
    const chips = el('div', { class: 'chips wrap-chips' });
    tags.forEach(t => {
      const c = el('button', { class: 'chip' + (searchState.tags.has(t) ? ' active' : '') }, t);
      c.addEventListener('click', () => {
        searchState.tags.has(t) ? searchState.tags.delete(t) : searchState.tags.add(t);
        c.classList.toggle('active'); draw();
      });
      chips.append(c);
    });
    body.append(el('div', { class: 'sec-h' }, 'Ingredients'), chips);
  }

  const head = el('div', { class: 'sec-h' }, 'Results');
  const box = el('div');
  body.append(head, box);
  mount(el('div', {}, topbar('Search'), body), 'search');
  draw();
  input.focus();

  async function draw() {
    const q = searchState.q.trim().toLowerCase();
    const matches = state.recipes.filter(r => {
      if (searchState.scope === 'approved' && r.status !== 'approved') return false;
      if (searchState.scope === 'testing' && r.status === 'approved') return false;
      if (searchState.tags.size) {
        const rt = new Set(r.tags || []);
        for (const t of searchState.tags) if (!rt.has(t)) return false;
      }
      if (!q) return true;
      const hay = [r.title, r.story, (r.ingredients || []).join(' '), (r.method || []).join(' '),
        (r.tags || []).join(' '), catById(r.category).name,
        attempts(r).map(a => a.notes).join(' ')].join(' ').toLowerCase();
      return hay.includes(q);
    });
    head.textContent = '';
    head.append('Results', el('span', { class: 'count' }, `${matches.length}`));
    box.innerHTML = '';
    box.append(matches.length
      ? await cardList(matches)
      : emptyState('No matches', 'Try a shorter search, or clear some ingredient filters.'));
  }
}

// ---------- Recipe detail ----------
async function viewRecipe(id) {
  const r = getRecipe(id);
  if (!r) { mount(el('div', {}, topbar('Not found', { back: true }), el('div', { class: 'wrap' }, emptyState('Gone', 'That recipe no longer exists.', 'Back home', '#/'))), ''); return; }

  const isT = r.status !== 'approved';
  const wrap = el('div', { class: 'detail' });
  wrap.append(topbar(r.title, { back: true, action: { label: 'EDIT', onclick: () => go('/edit/' + r.id) } }));

  // a recipe on trial has no chosen photo yet — show its latest cook instead, so the
  // page matches the card and approval is a confirmation rather than a first look
  const photos = await resolvePhotos(r);
  const coverSrc = photos[0]?.url || await coverURL(r);
  if (coverSrc) wrap.append(el('img', { class: 'cover', src: coverSrc, alt: r.title }));

  const body = el('div', { class: 'detail-body' });
  body.append(
    el('div', { class: 'kicker' },
      el('span', { class: 'pill ' + (isT ? 'testing' : 'approved') }, isT ? 'In testing' : 'In the cookbook'),
      el('span', { class: 'pill' }, catById(r.category).name),
      r.sharedFrom ? el('span', { class: 'pill' }, 'From ' + r.sharedFrom) : ''),
    el('h2', {}, r.title),
  );
  if (r.story) body.append(el('p', { class: 'story' }, r.story));

  // facts
  const facts = el('div', { class: 'factbar' });
  facts.append(el('div', {}, el('span', { class: 'n' }, fmtTime(r.time) || '—'), el('span', { class: 'l' }, 'Total time')));
  facts.append(el('div', {}, el('span', { class: 'n' }, r.servings ? String(r.servings) : '—'), el('span', { class: 'l' }, 'Serves')));
  const avg = avgRating(r);
  facts.append(el('div', {}, el('span', { class: 'n' }, avg ? avg.toFixed(1) : '—'), el('span', { class: 'l' }, 'Rating')));
  body.append(facts);

  // status banner
  const n = attempts(r).length;
  body.append(isT
    ? el('div', { class: 'banner' }, n ? `Cooked ${n} time${n > 1 ? 's' : ''} — approve it when you are happy.` : 'Not cooked yet. Log the first attempt below.')
    : el('div', { class: 'banner done' }, r.approvedAt ? `Approved ${fmtDate(r.approvedAt)}` : 'Approved'));

  // ingredients + method
  if ((r.ingredients || []).length) {
    const ul = el('ul', { class: 'ing-list' });
    r.ingredients.forEach(i => ul.append(el('li', {}, el('span', {}, i))));
    body.append(el('div', { class: 'block' }, el('h4', {}, 'Ingredients'), ul));
  }
  if ((r.method || []).length) {
    const ol = el('ul', { class: 'steps' });
    r.method.forEach(m => ol.append(el('li', {}, m)));
    body.append(el('div', { class: 'block' }, el('h4', {}, 'Method'), ol));
  }

  // test log
  const log = el('div', { class: 'block' }, el('h4', {}, isT ? 'Test log' : 'How it went'));
  if (!n) log.append(el('p', { class: 'foot', style: 'text-align:left;margin:0' }, 'No cooks logged yet.'));
  else {
    const list = el('div', {});
    [...attempts(r)].reverse().forEach(a => list.append(attemptRow(r, a)));
    log.append(list);
  }
  log.append(el('div', { class: 'btn-row' },
    el('button', { class: 'btn ghost block', onclick: () => logCookSheet(r) }, 'Log a cook')));
  body.append(log);

  // gallery
  if (photos.length > 1) {
    const g = el('div', { class: 'gallery' });
    photos.slice(1).forEach(p => g.append(el('img', { src: p.url, alt: r.title, loading: 'lazy' })));
    body.append(el('div', { class: 'block' }, el('h4', {}, 'Photos'), g));
  }

  // actions
  const acts = el('div', { class: 'btn-row stack' });
  if (isT) acts.append(el('button', { class: 'btn block', onclick: () => approveSheet(r) }, 'Approve → move to cookbook'));
  else acts.append(el('button', { class: 'btn ghost block', onclick: () => sendBackToTesting(r) }, 'Send back to testing'));
  acts.append(el('button', { class: 'btn ghost block', onclick: () => shareSheet(r) }, 'Send this recipe to someone'));
  acts.append(el('button', { class: 'btn danger block', onclick: () => deleteSheet(r) }, 'Delete recipe'));
  body.append(acts);

  wrap.append(body);
  mount(wrap, '');
}

function attemptRow(r, a) {
  const row = el('div', { class: 'attempt' });
  const bd = el('div', { class: 'bd' });
  const who = el('div', { class: 'who' },
    a.rating ? el('span', { class: 'rating' }, el('span', { class: 'st' }, starStr(a.rating))) : '',
    el('span', { class: 'dt' }, fmtDate(a.date)),
    el('button', { class: 'del', 'aria-label': 'Delete entry', onclick: () => removeAttempt(r, a.id) }, '×'),
  );
  bd.append(who);
  if (a.notes) bd.append(el('p', { class: 'nt' }, a.notes));
  if (a.photo) {
    const img = el('img', { alt: '' });
    photoURL(a.photo).then(u => { if (u) img.src = u; });
    bd.append(img);
  }
  row.append(el('div', { class: 'av' }, 'COOK'), bd);
  return row;
}

// ---------- Actions ----------
function logCookSheet(r) {
  openSheet((box, close) => {
    const stars = starPicker(0);
    const notesEl = el('textarea', { placeholder: 'Too salty? Halve the stock. Worked brilliantly with rice…', style: 'min-height:96px' });
    const dateEl = el('input', { type: 'date', value: new Date().toISOString().slice(0, 10) });
    let photoBlob = null;

    const fileInput = el('input', { type: 'file', accept: 'image/*' });
    const dropText = el('span', {}, 'Add a photo of this cook');
    const drop = el('label', { class: 'photo-drop' }, dropText, fileInput);
    const prev = el('div', { class: 'photo-previews' });
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      dropText.textContent = 'Preparing photo…';
      save.disabled = true;                  // don't let the log save before the photo is ready
      photoBlob = await downscale(f);
      dropText.textContent = 'Add a photo of this cook';
      save.disabled = false;
      prev.innerHTML = '';
      const pp = el('div', { class: 'pp' }, el('img', { src: URL.createObjectURL(photoBlob), alt: '' }));
      pp.append(el('button', { onclick: () => { photoBlob = null; prev.innerHTML = ''; }, 'aria-label': 'Remove' }, '×'));
      prev.append(pp);
    });

    const save = el('button', { class: 'btn block' }, 'Save to test log');
    save.addEventListener('click', async () => {
      save.disabled = true;
      const a = {
        id: uid('a_'),
        date: dateEl.value ? new Date(dateEl.value).toISOString() : new Date().toISOString(),
        rating: stars.value(),
        notes: notesEl.value.trim(),
        photo: photoBlob ? await storePhoto(photoBlob) : null,
      };
      r.attempts = attempts(r).concat(a);
      await saveRecipe(r);
      close();
      toast('Cook logged');
      render();
    });

    box.append(
      sheetHead('Log a cook', r.title),
      el('div', { class: 'field' }, el('label', {}, 'How was it?'), stars),
      el('div', { class: 'field' }, el('label', {}, 'Notes for next time'), notesEl),
      el('div', { class: 'field' }, el('label', {}, 'Date cooked'), dateEl),
      el('div', { class: 'field' }, el('label', {}, 'Photo'), drop, prev),
      el('div', { class: 'btn-row' }, save),
    );
  });
}

function approveSheet(r) {
  const avg = avgRating(r), n = attempts(r).length;
  // photos taken while testing, newest first — the approval step is where one of them
  // is promoted to the cookbook photo
  const candidates = [...new Set([
    ...attempts(r).filter(a => a.photo).map(a => a.photo).reverse(),
    ...(r.photos || []).map(p => p.src),
  ])];

  openSheet((box, close) => {
    let chosen = candidates[0] || null;
    let newBlob = null;

    const btn = el('button', { class: 'btn block' }, 'Approve → cookbook');
    const picker = el('div', { class: 'photo-previews' });
    const fileInput = el('input', { type: 'file', accept: 'image/*' });
    const dropText = el('span', {}, candidates.length ? 'Or add a different photo' : 'Add a cookbook photo');
    const drop = el('label', { class: 'photo-drop' }, dropText, fileInput);

    function drawPicker() {
      picker.innerHTML = '';
      candidates.forEach(src => {
        const img = el('img', { alt: '' });
        photoURL(src).then(u => { if (u) img.src = u; });
        const pp = el('div', { class: 'pp' + (chosen === src && !newBlob ? ' sel' : '') }, img);
        pp.addEventListener('click', () => {
          chosen = (chosen === src && !newBlob) ? null : src;
          newBlob = null;
          drawPicker();
        });
        picker.append(pp);
      });
      if (newBlob) {
        picker.append(el('div', { class: 'pp sel' }, el('img', { src: URL.createObjectURL(newBlob), alt: '' }),
          el('button', { 'aria-label': 'Remove', onclick: e => { e.stopPropagation(); newBlob = null; chosen = candidates[0] || null; drawPicker(); } }, '×')));
      }
    }
    fileInput.addEventListener('change', async () => {
      const f = fileInput.files[0];
      fileInput.value = '';
      if (!f) return;
      dropText.textContent = 'Preparing photo…';
      btn.disabled = true;
      newBlob = await downscale(f);
      chosen = null;
      dropText.textContent = candidates.length ? 'Or add a different photo' : 'Add a cookbook photo';
      btn.disabled = false;
      drawPicker();
    });
    drawPicker();

    btn.addEventListener('click', async () => {
      btn.disabled = true;
      const cover = newBlob ? await storePhoto(newBlob) : chosen;
      if (cover) r.photos = [{ src: cover, caption: '' }, ...(r.photos || []).filter(p => p.src !== cover)];
      r.status = 'approved';
      r.approvedAt = new Date().toISOString();
      await saveRecipe(r);
      close();
      toast('Added to the cookbook');
      render();
    });

    box.append(
      sheetHead('Into the cookbook?', r.title),
      el('div', { class: 'factbar', style: 'margin-top:18px' },
        el('div', {}, el('span', { class: 'n' }, String(n)), el('span', { class: 'l' }, 'Cooks logged')),
        el('div', {}, el('span', { class: 'n' }, avg ? avg.toFixed(1) : '—'), el('span', { class: 'l' }, 'Avg rating')),
        el('div', {}, el('span', { class: 'n' }, fmtTime(r.time) || '—'), el('span', { class: 'l' }, 'Total time')),
      ),
      el('div', { class: 'field' },
        el('label', {}, candidates.length ? 'Cookbook photo' : 'Cookbook photo (optional)'),
        candidates.length ? el('div', { class: 'hint', style: 'margin:0 0 8px' }, 'Tap to pick the one that goes on the recipe.') : '',
        picker, drop),
      el('p', { class: 'sub', style: 'margin-top:14px' }, 'It keeps its test log — you can always send it back.'),
      el('div', { class: 'btn-row stack' }, btn, el('button', { class: 'btn ghost block', onclick: () => close() }, 'Not yet')),
    );
  });
}

function sendBackToTesting(r) {
  openSheet((box, close) => {
    const btn = el('button', { class: 'btn warm block' }, 'Send back to testing');
    btn.addEventListener('click', async () => {
      r.status = 'testing';
      r.approvedAt = null;
      await saveRecipe(r);
      close(); toast('Back in testing'); render();
    });
    box.append(
      sheetHead('Back to testing?', r.title),
      el('p', { class: 'sub', style: 'margin-top:10px' }, 'It leaves the cookbook and returns to the testing kitchen. Nothing is lost.'),
      el('div', { class: 'btn-row stack' }, btn, el('button', { class: 'btn ghost block', onclick: () => close() }, 'Cancel')),
    );
  });
}

function deleteSheet(r) {
  openSheet((box, close) => {
    const btn = el('button', { class: 'btn danger block' }, 'Delete for good');
    btn.addEventListener('click', async () => {
      await DB.del('recipes', r.id);
      state.recipes = state.recipes.filter(x => x.id !== r.id);
      close(); toast('Deleted'); go('/');
      render();
    });
    box.append(
      sheetHead('Delete this recipe?', r.title),
      el('p', { class: 'sub', style: 'margin-top:10px' }, 'The recipe, its photos and its whole test log go with it. This cannot be undone.'),
      el('div', { class: 'btn-row stack' }, btn, el('button', { class: 'btn ghost block', onclick: () => close() }, 'Keep it')),
    );
  });
}

async function removeAttempt(r, aid) {
  r.attempts = attempts(r).filter(a => a.id !== aid);
  await saveRecipe(r);
  toast('Entry removed');
  render();
}

// ---------- Add / edit form ----------
async function viewForm(id) {
  const editing = !!id;
  const ex = editing ? getRecipe(id) : null;
  if (editing && !ex) { go('/'); return; }

  const body = el('div', { class: 'wrap' });
  const wrap = el('div', {}, topbar(editing ? 'Edit recipe' : 'New recipe', { back: true }), body);

  const titleEl = el('input', { value: ex?.title || '', placeholder: 'Miso salmon traybake' });
  const catEl = el('select', {});
  CATEGORIES.forEach(c => catEl.append(el('option', { value: c.id, ...(c.id === (ex?.category || 'weeknight') ? { selected: 'selected' } : {}) }, c.name)));
  const timeEl = el('input', { type: 'number', min: '0', inputmode: 'numeric', value: ex?.time ?? '', placeholder: '25' });
  const servEl = el('input', { type: 'number', min: '1', inputmode: 'numeric', value: ex?.servings ?? '', placeholder: '2' });
  const storyEl = el('textarea', { placeholder: 'Where it came from, why it is worth a go…', style: 'min-height:80px' }, ex?.story || '');
  const ingEl = el('textarea', { placeholder: '2 salmon fillets\n1 tbsp white miso\n…' }, (ex?.ingredients || []).join('\n'));
  const methEl = el('textarea', { placeholder: 'Heat the oven to 200C.\nWhisk the miso with the honey.\n…' }, (ex?.method || []).join('\n'));
  const tagsEl = el('input', { value: (ex?.tags || []).join(', '), placeholder: 'salmon, miso, rice' });

  // status (new recipes only)
  let status = ex?.status || 'testing';
  const statusField = el('div', { class: 'field' }, el('label', {}, 'Where does it start?'));
  if (!editing) {
    const seg = el('div', { class: 'seg' });
    [['testing', 'Testing kitchen'], ['approved', 'Straight to cookbook']].forEach(([v, label]) => {
      const b = el('button', { type: 'button', class: status === v ? 'active' : '' }, label);
      b.addEventListener('click', () => {
        status = v;
        seg.querySelectorAll('button').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        syncPhotoField();
      });
      seg.append(b);
    });
    statusField.append(seg, el('div', { class: 'hint' }, 'Default is the testing kitchen — cook it, log it, then approve.'));
  }

  // photos
  const existingPhotos = (ex?.photos || []).slice();
  const newPhotos = [];
  const previews = el('div', { class: 'photo-previews' });
  const photoHint = el('div', { class: 'hint soft-warn' });
  const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: 'multiple' });
  const dropText = el('span', {}, 'Tap to add photos');
  const drop = el('label', { class: 'photo-drop' }, dropText, fileInput);
  let pending = 0;
  fileInput.addEventListener('change', async () => {
    const files = [...fileInput.files];      // snapshot: the live FileList is cleared below
    fileInput.value = '';                    // also lets the same file be picked again
    pending += files.length; syncPending();
    for (const f of files) {
      const blob = await downscale(f);
      const d = await imgDims(blob);
      newPhotos.push({ blob, url: URL.createObjectURL(blob), w: d.w, h: d.h });
      pending--; drawPreviews(); syncPending();
    }
  });
  // a 12MP photo takes a moment to shrink — hold the save button until it is done,
  // otherwise a quick tap saves the recipe without the photo
  function syncPending() {
    save.disabled = pending > 0;
    dropText.textContent = pending ? `Preparing ${pending} photo${pending > 1 ? 's' : ''}…` : 'Tap to add photos';
    // downscale only ever shrinks — a small original stays small and the cover has to
    // upscale it, which reads as "out of focus". Say so rather than letting it look broken.
    const soft = newPhotos.filter(p => p.w && p.w < COVER_PX);
    if (!soft.length || pending) { photoHint.textContent = ''; return; }
    const smallest = Math.min(...soft.map(p => p.w));
    photoHint.textContent = soft.length === 1
      ? `That photo is only ${smallest}px wide. The recipe page shows it at about ${COVER_PX}px, so it will look a little soft — a shot straight off the camera roll is sharper than one saved from a message or a website.`
      : `${soft.length} of those photos are under ${COVER_PX}px wide (smallest ${smallest}px), so they will look a little soft on the recipe page.`;
  }
  function drawPreviews() {
    previews.innerHTML = '';
    existingPhotos.forEach((p, i) => {
      const img = el('img', { alt: '' });
      photoURL(p.src).then(u => { if (u) img.src = u; });
      previews.append(el('div', { class: 'pp' }, img,
        el('button', { 'aria-label': 'Remove', onclick: () => { existingPhotos.splice(i, 1); drawPreviews(); } }, '×')));
    });
    newPhotos.forEach((p, i) => previews.append(el('div', { class: 'pp' }, el('img', { src: p.url, alt: '' }),
      el('button', { 'aria-label': 'Remove', onclick: () => { newPhotos.splice(i, 1); drawPreviews(); } }, '×'))));
  }
  drawPreviews();

  // Photos belong to the cooking, not to typing the recipe in: while a recipe is on trial
  // its pictures come from the test log (and the approval step). Only cookbook recipes get
  // a photo field here.
  const photoField = el('div', { class: 'field' }, el('label', {}, 'Photos'), drop, photoHint, previews);
  const photoNote = el('div', { class: 'field' }, el('label', {}, 'Photos'),
    el('div', { class: 'hint' }, 'Not yet — you add photos when you log a cook, and pick the cookbook one when you approve it.'));
  function syncPhotoField() {
    const isApproved = editing ? ex.status === 'approved' : status === 'approved';
    photoField.style.display = isApproved ? '' : 'none';
    photoNote.style.display = isApproved ? 'none' : '';
  }

  const save = el('button', { class: 'btn block' }, editing ? 'Save changes' : 'Add recipe');
  save.addEventListener('click', async () => {
    const title = titleEl.value.trim();
    if (!title) { toast('Give it a title first'); titleEl.focus(); return; }
    save.disabled = true;

    const photos = existingPhotos.slice();
    for (const np of newPhotos) photos.push({ src: await storePhoto(np.blob), caption: '' });

    const manualTags = tagsEl.value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const r = {
      ...(ex || {}),
      id: ex?.id || slugify(title) + '-' + Math.random().toString(36).slice(2, 6),
      title,
      status: editing ? ex.status : status,
      category: catEl.value,
      time: timeEl.value ? Number(timeEl.value) : null,
      servings: servEl.value ? Number(servEl.value) : null,
      story: storyEl.value.trim(),
      ingredients: linesOf(ingEl.value),
      method: linesOf(methEl.value),
      tags: manualTags.length ? manualTags : deriveTags(ingEl.value + ' ' + title),
      photos,
      attempts: ex?.attempts || [],
      createdAt: ex?.createdAt || new Date().toISOString(),
      approvedAt: ex?.approvedAt || (!editing && status === 'approved' ? new Date().toISOString() : null),
    };
    await saveRecipe(r);
    toast(editing ? 'Saved' : (r.status === 'approved' ? 'Added to the cookbook' : 'Added to the testing kitchen'));
    go('/recipe/' + r.id);
  });

  const field = (label, control, hint) => {
    const f = el('div', { class: 'field' }, el('label', {}, label), control);
    if (hint) f.append(el('div', { class: 'hint' }, hint));
    return f;
  };

  body.append(
    field('Title', titleEl),
    editing ? '' : statusField,
    field('Section', catEl),
    el('div', { class: 'row2' },
      field('Total time (min)', timeEl),
      field('Serves', servEl)),
    field('Note', storyEl),
    field('Ingredients', ingEl, 'One per line.'),
    field('Method', methEl, 'One step per line.'),
    field('Tags', tagsEl, 'Comma separated. Leave blank and they are picked out of the ingredients.'),
    photoField, photoNote,
    el('div', { class: 'btn-row' }, save),
  );

  syncPhotoField();
  mount(wrap, editing ? '' : 'add');
  if (!editing) titleEl.focus();
}

// ---------- Share a recipe as a link ----------
/* A suggestion travels as a link: the recipe is squeezed into the URL hash, so it never
   touches a server and needs no account. Photos are left out on purpose — they keep the
   link short, and in this app photos come from cooking rather than from writing a recipe
   down. The id travels too, so re-sharing updates the same recipe instead of duplicating it. */
const SHARE_NAME_KEY = 'fcc_shareName';

function b64urlFromBytes(bytes) {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function bytesFromB64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
// 'z' = deflated, 'u' = plain — so an older browser without CompressionStream still works
async function packShare(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream === 'undefined') return 'u' + b64urlFromBytes(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = await new Response(stream).arrayBuffer();
  return 'z' + b64urlFromBytes(new Uint8Array(buf));
}
async function unpackShare(s) {
  const tag = s[0], bytes = bytesFromB64url(s.slice(1));
  if (tag === 'u') return JSON.parse(new TextDecoder().decode(bytes));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(stream).text());
}

async function shareLinkFor(r, from) {
  const payload = await packShare({
    v: 1, id: r.id, t: r.title, c: r.category, m: r.time, s: r.servings,
    y: r.story, i: r.ingredients || [], d: r.method || [], g: r.tags || [],
    f: (from || '').trim() || undefined,
  });
  return location.origin + location.pathname + '#/shared/' + payload;
}

function shareSheet(r) {
  openSheet((box, close) => {
    const fromEl = el('input', { value: localStorage.getItem(SHARE_NAME_KEY) || '', placeholder: 'Your name (optional)' });
    const linkEl = el('input', { readonly: 'readonly', value: 'Building link…' });
    const note = el('div', { class: 'hint' });
    let url = '';

    async function build() {
      url = await shareLinkFor(r, fromEl.value);
      linkEl.value = url;
      note.textContent = `${url.length} characters — short enough for any message.`;
    }
    fromEl.addEventListener('input', () => {
      localStorage.setItem(SHARE_NAME_KEY, fromEl.value.trim());
      build();
    });
    build();

    const copy = el('button', { class: 'btn block' }, 'Copy link');
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(url);
        toast('Link copied');
      } catch {
        linkEl.select(); linkEl.setSelectionRange(0, 99999);
        note.textContent = 'Press Ctrl+C (or long-press) to copy the selected link.';
      }
    });

    const row = el('div', { class: 'btn-row stack' }, copy);
    if (navigator.share) {
      const nat = el('button', { class: 'btn ghost block' }, 'Send with…');
      nat.addEventListener('click', () => navigator.share({ title: r.title, text: `Try this one: ${r.title}`, url }).catch(() => {}));
      row.append(nat);
    }
    row.append(el('button', { class: 'btn ghost block', onclick: () => close() }, 'Done'));

    box.append(
      sheetHead('Send this recipe', r.title),
      el('p', { class: 'sub', style: 'margin-top:10px' },
        'Whoever opens the link gets it in their testing kitchen. Photos are not included — those come from cooking it.'),
      el('div', { class: 'field' }, el('label', {}, 'From'), fromEl),
      el('div', { class: 'field' }, el('label', {}, 'Link'), linkEl, note),
      row,
    );
  });
}

async function viewShared(payload) {
  const body = el('div', { class: 'wrap' });
  const wrap = el('div', {}, topbar('A suggested recipe', { back: true }), body);

  let d;
  try {
    d = await unpackShare(payload);
    if (!d || !d.t) throw new Error('empty');
  } catch {
    body.append(emptyState('Link did not work',
      'That link looks incomplete — messaging apps sometimes cut long links in half. Ask for it again, or paste the whole thing into the address bar.',
      'Back home', '#/'));
    mount(wrap, '');
    return;
  }

  const existing = getRecipe(d.id);
  body.append(el('div', { class: 'sec-h' }, d.f ? `Suggested by ${d.f}` : 'Suggested recipe'));
  body.append(el('h2', { style: 'margin:0;font-size:26px;font-weight:800;letter-spacing:-.03em' }, d.t));

  const meta = el('div', { class: 'rcard', style: 'border:0;padding:12px 0' },
    el('div', { class: 'meta' },
      fmtTime(d.m) ? el('span', { class: 'time' }, fmtTime(d.m)) : '',
      el('span', { class: 'pill' }, catById(d.c).name),
      d.s ? el('span', { class: 'pill' }, `Serves ${d.s}`) : ''));
  body.append(meta);
  if (d.y) body.append(el('p', { class: 'story' }, d.y));

  if ((d.i || []).length) {
    const ul = el('ul', { class: 'ing-list' });
    d.i.forEach(i => ul.append(el('li', {}, el('span', {}, i))));
    body.append(el('div', { class: 'block' }, el('h4', {}, 'Ingredients'), ul));
  }
  if ((d.d || []).length) {
    const ol = el('ul', { class: 'steps' });
    d.d.forEach(m => ol.append(el('li', {}, m)));
    body.append(el('div', { class: 'block' }, el('h4', {}, 'Method'), ol));
  }

  async function save(asCopy) {
    const id = asCopy ? slugify(d.t) + '-' + Math.random().toString(36).slice(2, 6) : d.id;
    const now = new Date().toISOString();
    const r = {
      ...(asCopy ? {} : existing || {}),
      id, title: d.t, status: existing && !asCopy ? existing.status : 'testing',
      category: d.c || 'weeknight', time: d.m || null, servings: d.s || null,
      story: d.y || '', ingredients: d.i || [], method: d.d || [], tags: d.g || [],
      photos: (!asCopy && existing?.photos) || [],
      attempts: (!asCopy && existing?.attempts) || [],
      sharedFrom: d.f || null,
      createdAt: (!asCopy && existing?.createdAt) || now,
      approvedAt: (!asCopy && existing?.approvedAt) || null,
    };
    await saveRecipe(r);
    toast(existing && !asCopy ? 'Your copy is updated' : 'Added to the testing kitchen');
    go('/recipe/' + id);
  }

  const acts = el('div', { class: 'btn-row stack' });
  if (existing) {
    acts.append(
      el('div', { class: 'banner' }, `You already have "${existing.title}". Updating keeps its test log.`),
      el('button', { class: 'btn block', onclick: () => save(false) }, 'Update my copy'),
      el('button', { class: 'btn ghost block', onclick: () => save(true) }, 'Add as a separate copy'),
    );
  } else {
    acts.append(el('button', { class: 'btn block', onclick: () => save(false) }, 'Add to my testing kitchen'));
  }
  acts.append(el('a', { class: 'btn ghost block', href: '#/' }, 'Not now'));
  body.append(acts);

  mount(wrap, '');
}

// ---------- Backup & restore ----------
/* Everything lives in this browser's IndexedDB, which a "clear site data" wipes without
   warning. The backup is one self-contained JSON file: recipes plus every photo embedded
   as base64. It doubles as the way to move a cookbook between devices, since browser
   storage never crosses an origin or a device. */
const LAST_BACKUP_KEY = 'fcc_lastBackup';
const lastBackupAt = () => localStorage.getItem(LAST_BACKUP_KEY);

function fmtBytes(b) {
  if (b < 1024) return b + ' B';
  if (b < 1048576) return Math.round(b / 1024) + ' KB';
  return (b / 1048576).toFixed(1) + ' MB';
}
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}
const base64ToBlob = (data, type) =>
  fetch('data:' + (type || 'image/jpeg') + ';base64,' + data).then(r => r.blob());

// Assembled as an array of chunks so the whole file never exists as one huge string —
// a 60MB backup would otherwise be rough on a phone.
async function buildBackupBlob(onProgress) {
  const [recipes, photos] = await Promise.all([DB.getAll('recipes'), DB.getAll('photos')]);
  const parts = ['{"app":"fiona-can-cook","version":1,"exportedAt":' +
    JSON.stringify(new Date().toISOString()) +
    ',"recipes":' + JSON.stringify(recipes) + ',"photos":['];
  for (let i = 0; i < photos.length; i++) {
    const data = await blobToBase64(photos[i].blob);
    parts.push((i ? ',' : '') + JSON.stringify({ id: photos[i].id, type: photos[i].blob.type || 'image/jpeg', data }));
    if (onProgress) onProgress(i + 1, photos.length);
  }
  parts.push(']}');
  return { blob: new Blob(parts, { type: 'application/json' }), recipes: recipes.length, photos: photos.length };
}

async function viewBackup() {
  const photos = await DB.getAll('photos').catch(() => []);
  const photoBytes = photos.reduce((s, p) => s + p.blob.size, 0);
  const est = Math.round(photoBytes * 1.37 + JSON.stringify(state.recipes).length);
  const last = lastBackupAt();
  const newest = state.recipes.reduce((m, r) => Math.max(m, r.updatedAt || 0), 0);
  const stale = state.recipes.length && (!last || new Date(last).getTime() < newest);

  const body = el('div', { class: 'wrap' });

  body.append(el('div', { class: 'sec-h' }, 'On this device'),
    el('div', { class: 'factbar' },
      el('div', {}, el('span', { class: 'n' }, String(state.recipes.length)), el('span', { class: 'l' }, 'Recipes')),
      el('div', {}, el('span', { class: 'n' }, String(photos.length)), el('span', { class: 'l' }, 'Photos')),
      el('div', {}, el('span', { class: 'n' }, fmtBytes(est)), el('span', { class: 'l' }, 'Backup size')),
    ));

  body.append(el('div', { class: 'banner' + (stale ? '' : ' done') },
    !state.recipes.length ? 'Nothing to back up yet.'
      : !last ? 'Never backed up. One tap and it is safe.'
      : stale ? `Last backup ${fmtDate(last)} — there are changes since.`
      : `Backed up ${fmtDate(last)}. Nothing has changed since.`));

  // export
  const dlNote = el('div', { class: 'hint' });
  const dl = el('button', { class: 'btn block' }, 'Download backup');
  dl.addEventListener('click', async () => {
    if (!state.recipes.length) { toast('No recipes to back up yet'); return; }
    dl.disabled = true;
    dlNote.textContent = 'Packing up…';
    try {
      const { blob, recipes, photos: np } = await buildBackupBlob((i, n) => {
        dlNote.textContent = n ? `Packing photo ${i} of ${n}…` : 'Packing up…';
      });
      const name = `fiona-can-cook-backup-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      localStorage.setItem(LAST_BACKUP_KEY, new Date().toISOString());
      dlNote.textContent = `Saved ${name} — ${recipes} recipes, ${np} photos, ${fmtBytes(blob.size)}.`;
      toast('Backup downloaded');
    } catch (err) {
      dlNote.textContent = 'Could not build the backup: ' + (err.message || err);
    }
    dl.disabled = false;
  });
  body.append(el('div', { class: 'sec-h' }, 'Back up'),
    el('p', { class: 'foot', style: 'text-align:left;margin:0 0 12px' },
      'Saves one file holding every recipe and photo. Keep it in iCloud, Drive or anywhere safe.'),
    dl, dlNote);

  // restore
  const fileInput = el('input', { type: 'file', accept: 'application/json,.json' });
  const dropText = el('span', {}, 'Choose a backup file');
  const drop = el('label', { class: 'photo-drop' }, dropText, fileInput);
  const rNote = el('div', { class: 'hint' });
  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    fileInput.value = '';
    if (!f) return;
    dropText.textContent = 'Reading…';
    rNote.textContent = '';
    try {
      let data;
      try { data = JSON.parse(await f.text()); }
      catch { throw new Error('That file could not be read. Pick the .json backup file this app made.'); }
      if (data.app !== 'fiona-can-cook' || !Array.isArray(data.recipes)) {
        throw new Error('That is a different kind of file — it is not a Fiona CAN cook backup.');
      }
      restoreSheet(data, f);
    } catch (err) {
      rNote.textContent = err.message || 'Could not read that file.';
    }
    dropText.textContent = 'Choose a backup file';
  });
  body.append(el('div', { class: 'sec-h' }, 'Restore'),
    el('p', { class: 'foot', style: 'text-align:left;margin:0 0 12px' },
      'Open a backup file to bring a cookbook back, or to copy it onto another device.'),
    drop, rNote);

  body.append(el('p', { class: 'foot' },
    'Recipes live only in this browser, on this device. They are not on the internet and nobody else can see them — which is also why a backup matters.'));

  mount(el('div', {}, topbar('Backup', { back: true }), body), '');
}

function restoreSheet(data, file) {
  const local = new Map(state.recipes.map(r => [r.id, r]));
  let add = 0, upd = 0, keep = 0;
  data.recipes.forEach(r => {
    const l = local.get(r.id);
    if (!l) add++;
    else if ((r.updatedAt || 0) > (l.updatedAt || 0)) upd++;
    else keep++;
  });

  openSheet((box, close) => {
    const note = el('div', { class: 'hint' });
    const merge = el('button', { class: 'btn block' }, 'Merge into this device');
    const replace = el('button', { class: 'btn danger block' }, 'Replace everything');

    async function run(mode) {
      merge.disabled = replace.disabled = true;
      try {
        if (mode === 'replace') {
          note.textContent = 'Clearing…';
          for (const r of state.recipes) await DB.del('recipes', r.id);
          for (const p of await DB.getAll('photos')) await DB.del('photos', p.id);
          state.recipes = [];
          state.photoURLs = {};
          local.clear();
        }
        const photos = data.photos || [];
        for (let i = 0; i < photos.length; i++) {
          note.textContent = `Restoring photo ${i + 1} of ${photos.length}…`;
          const existing = mode === 'replace' ? null : await DB.get('photos', photos[i].id);
          if (!existing) await DB.put('photos', { id: photos[i].id, blob: await base64ToBlob(photos[i].data, photos[i].type) });
        }
        note.textContent = 'Restoring recipes…';
        for (const r of data.recipes) {
          const l = local.get(r.id);
          if (mode === 'merge' && l && (l.updatedAt || 0) >= (r.updatedAt || 0)) continue;
          await DB.put('recipes', r);
        }
        await loadData();
        close();
        toast(mode === 'replace' ? 'Everything restored' : `Merged — ${add} added, ${upd} updated`);
        go('/');
        render();
      } catch (err) {
        note.textContent = 'Restore failed: ' + (err.message || err);
        merge.disabled = replace.disabled = false;
      }
    }
    merge.addEventListener('click', () => run('merge'));
    replace.addEventListener('click', () => run('replace'));

    box.append(
      sheetHead('Restore this backup?', file.name),
      el('div', { class: 'factbar', style: 'margin-top:18px' },
        el('div', {}, el('span', { class: 'n' }, String(data.recipes.length)), el('span', { class: 'l' }, 'Recipes')),
        el('div', {}, el('span', { class: 'n' }, String((data.photos || []).length)), el('span', { class: 'l' }, 'Photos')),
        el('div', {}, el('span', { class: 'n' }, fmtBytes(file.size)), el('span', { class: 'l' }, 'File')),
      ),
      el('p', { class: 'sub', style: 'margin-top:16px' }, data.exportedAt ? 'Taken ' + fmtDate(data.exportedAt) : ''),
      el('div', { class: 'field' },
        el('label', {}, 'Merge'),
        el('div', { class: 'hint', style: 'margin:0 0 10px' },
          `Adds ${add} new, updates ${upd} with a newer version, leaves ${keep} alone. Nothing is lost.`),
        merge),
      el('div', { class: 'field' },
        el('label', {}, 'Or replace'),
        el('div', { class: 'hint', style: 'margin:0 0 10px' },
          state.recipes.length
            ? `Wipes the ${state.recipes.length} recipe${state.recipes.length > 1 ? 's' : ''} already here and restores the backup exactly.`
            : 'Nothing here yet, so this is the same as merging.'),
        replace),
      note,
      el('div', { class: 'btn-row' }, el('button', { class: 'btn ghost block', onclick: () => close() }, 'Cancel')),
    );
  });
}

// ---------- Boot ----------
loadData().then(render).catch(err => {
  app.innerHTML = '<div class="wrap"><div class="empty"><div class="big">Could not start</div><p>' + (err && err.message ? err.message : 'Unknown error') + '</p></div></div>';
});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
})();
