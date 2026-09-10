'use strict';

    const SITE_META = JSON.parse(document.getElementById('site-meta').textContent);
    const DATA = JSON.parse(document.getElementById('resource-data').textContent);
    const $ = (selector, root = document) => root.querySelector(selector);
    const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
    const collator = new Intl.Collator(['ko-KR', 'en-US'], { numeric: true, sensitivity: 'base' });

    const STORAGE = {
      favorites: 'ora3_favorites', notes: 'ora3_notes', status: 'ora3_status', selected: 'ora3_selected',
      theme: 'ora3_theme', state: 'ora3_filter_state'
    };
    const LEGACY = { favorites: 'ora_favorites_v2', notes: 'ora_notes_v2', status: 'ora_status_v2', selected: 'ora_selected_v2', theme: 'ora_theme_v2', state: 'ora_filter_state_v2' };
    const memoryStore = new Map();
    let storageDegraded = false;
    function storageWarning() {
      storageDegraded = true;
      const banner = $('#storageWarning');
      if (banner) banner.hidden = false;
    }
    const storage = {
      get(key) { if (memoryStore.has(key)) return memoryStore.get(key); try { return localStorage.getItem(key); } catch { return null; } },
      set(key, value) {
        try { localStorage.setItem(key, value); memoryStore.delete(key); return true; }
        catch { memoryStore.set(key, value); storageWarning(); return false; }
      },
      remove(key) {
        try { localStorage.removeItem(key); memoryStore.delete(key); }
        catch { memoryStore.set(key, null); storageWarning(); }
      }
    };

    const parseJSON = (raw, fallback) => { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } };
    const getJSON = (key, fallback) => parseJSON(storage.get(key), fallback);
    const setJSON = (key, value) => storage.set(key, JSON.stringify(value));
    const debounce = (fn, wait = 120) => { let timer; return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), wait); }; };
    const escapeHTML = (value = '') => String(value).replace(/[&<>'"]/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
    const escapeAttr = escapeHTML;
    const normalize = value => String(value ?? '').toLocaleLowerCase('en-US').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim();
    const yearNumber = value => Number.isInteger(value) ? value : 0;
    const categoryLabel = category => SITE_META.categoryLabels[category] || category;
    const categoryIcon = category => SITE_META.categoryIcons[category] || '•';
    const validURL = value => { try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } };
    const uid = value => normalize(value).replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'resource';

    const DEFAULT_STATE = Object.freeze({
      q: '', category: 'all', tag: 'all', access: 'all', level: 'all', priority: 'all', status: 'all',
      sort: 'relevance', favOnly: false, openOnly: false, view: 'cards', activePath: ''
    });
    const allowed = {
      access: new Set(['all','Open','Publisher','Mixed']),
      level: new Set(['all','Intro','Intermediate','Advanced','Research']),
      priority: new Set(['all','Core','Recommended','Frontier','Practical']),
      status: new Set(['all','planned','reading','done','none']),
      sort: new Set(['relevance','year_desc','year_asc','title','category','priority']),
      view: new Set(['cards','table'])
    };
    const PATHS = SITE_META.paths;

    let ALL = [];
    let state = { ...DEFAULT_STATE };
    let favorites = new Set();
    let selected = new Set();
    let notes = {};
    let statuses = {};
    let currentItem = null;
    let renderLimit = 24;
    let filteredItems = [];
    let lastFocused = null;
    let returnFocus = null;
    let activeModal = null;
    let tagsExpanded = false;

    function migrateLegacy() {
      for (const [key, oldKey] of Object.entries(LEGACY)) {
        if (storage.get(STORAGE[key]) == null && storage.get(oldKey) != null) storage.set(STORAGE[key], storage.get(oldKey));
      }
    }

    function prepareData() {
      ALL = [];
      for (const category of SITE_META.categoryOrder) {
        for (const raw of DATA[category] || []) {
          const item = { ...raw, category, tags: Array.isArray(raw.tags) ? raw.tags : [], links: Array.isArray(raw.links) ? raw.links : [] };
          const fields = {
            title: normalize(item.title), author: normalize(item.authors), tag: normalize(item.tags.join(' ')),
            year: normalize(item.year ?? ''), notes: normalize(item.notes), category: normalize(categoryLabel(category)), id: normalize(item.id)
          };
          item._fields = fields;
          item._blob = normalize(Object.values(fields).join(' ') + ' ' + item.links.map(link => `${link.label} ${link.url}`).join(' '));
          ALL.push(item);
        }
      }
    }

    function sanitizeState(raw) {
      const next = { ...DEFAULT_STATE };
      for (const key of Object.keys(DEFAULT_STATE)) if (raw && Object.hasOwn(raw, key)) next[key] = raw[key];
      next.q = typeof next.q === 'string' ? next.q.slice(0, 300) : '';
      next.category = next.category === 'all' || SITE_META.categoryOrder.includes(next.category) ? next.category : 'all';
      next.tag = typeof next.tag === 'string' ? next.tag.slice(0, 80) : 'all';
      for (const key of ['access','level','priority','status','sort','view']) if (!allowed[key].has(next[key])) next[key] = DEFAULT_STATE[key];
      next.favOnly = next.favOnly === true;
      next.openOnly = next.openOnly === true;
      next.activePath = Object.hasOwn(PATHS, next.activePath) ? next.activePath : '';
      return next;
    }

    function sanitizePersonal(raw = {}) {
      const ids = new Set(ALL.map(item => item.id));
      const list = value => [...new Set(Array.isArray(value) ? value.filter(id => ids.has(id)) : [])];
      const record = (value, valid) => Object.fromEntries(value && typeof value === 'object' && !Array.isArray(value)
        ? Object.entries(value).filter(([id, v]) => ids.has(id) && valid(v)) : []);
      return {
        favorites: list(raw.favorites), selected: list(raw.selected).slice(0, 4),
        notes: record(raw.notes, v => typeof v === 'string'),
        statuses: record(raw.statuses, v => ['planned', 'reading', 'done'].includes(v)),
        state: sanitizeState(raw.state)
      };
    }
    function loadState() {
      migrateLegacy();
      const saved = sanitizePersonal({ favorites:getJSON(STORAGE.favorites, []), selected:getJSON(STORAGE.selected, []),
        notes:getJSON(STORAGE.notes, {}), statuses:getJSON(STORAGE.status, {}), state:getJSON(STORAGE.state, {}) });
      state = parseHashState() ? sanitizeState(parseHashState()) : saved.state;
      favorites = new Set(saved.favorites); selected = new Set(saved.selected);
      notes = saved.notes; statuses = saved.statuses;
    }

    function persistState() { setJSON(STORAGE.state, state); syncHash(); }
    function persistFavorites() { setJSON(STORAGE.favorites, [...favorites]); }
    function persistSelected() { setJSON(STORAGE.selected, [...selected]); }
    function persistNotes() { return setJSON(STORAGE.notes, notes); }
    function persistStatuses() { setJSON(STORAGE.status, statuses); }

    function parseHashState() {
      if (!location.hash.startsWith('#?')) return null;
      const params = new URLSearchParams(location.hash.slice(2));
      const output = {};
      const map = { q:'q', c:'category', tag:'tag', a:'access', l:'level', p:'priority', s:'status', o:'sort', v:'view', path:'activePath' };
      for (const [short, key] of Object.entries(map)) if (params.has(short)) output[key] = params.get(short);
      output.favOnly = params.get('fav') === '1';
      output.openOnly = params.get('open') === '1';
      return output;
    }

    function syncHash() {
      const params = new URLSearchParams();
      const pairs = { q:state.q, c:state.category, tag:state.tag, a:state.access, l:state.level, p:state.priority, s:state.status, o:state.sort, v:state.view, path:state.activePath };
      for (const [key, value] of Object.entries(pairs)) {
        const defaultKey = ({ c:'category', a:'access', l:'level', p:'priority', s:'status', o:'sort', v:'view', path:'activePath' })[key] || key;
        if (value && value !== DEFAULT_STATE[defaultKey]) params.set(key, value);
      }
      if (state.favOnly) params.set('fav','1');
      if (state.openOnly) params.set('open','1');
      const next = `#?${params}`;
      try { history.replaceState(null, '', next); } catch { /* local file URLs may reject some history operations */ }
    }

    // A single pass keeps quoted spaces, field phrases, exclusions and literal pipes intact.
    let cachedQuery = null, cachedGroups = [];
    function parseQuery(query) {
      query = String(query || '');
      if (query === cachedQuery) return cachedGroups;
      const groups = [[]]; let raw = '', quoted = false;
      function push() {
        if (!raw) return;
        let value = raw, negative = false, field = 'all';
        if (value[0] === '-' && value.length > 1) { negative = true; value = value.slice(1); }
        const m = value.match(/^(title|author|tag|year|notes|category|cat|id):(.*)$/is);
        if (m) { field = m[1].toLowerCase() === 'cat' ? 'category' : m[1].toLowerCase(); value = m[2]; }
        const phrase = value.includes('"');
        value = normalize(value.replace(/"/g, ''));
        if (value) groups.at(-1).push({value,negative,field,phrase});
        raw = '';
      }
      for (let i = 0; i < query.length; i++) {
        const ch = query[i];
        if (ch === '"') { quoted = !quoted; raw += ch; }
        else if (ch === '|' && !quoted) { push(); groups.push([]); }
        else if (/\s/.test(ch) && !quoted) push();
        else raw += ch;
      }
      push(); cachedQuery = query; cachedGroups = groups.filter(group => group.length);
      return cachedGroups;
    }
    function tokenizeGroup(group) { return parseQuery(group)[0] || []; }

    function tokenHaystack(item, field) {
      if (field === 'all') return item._blob;
      return item._fields[field] ?? '';
    }

    function groupMatches(item, tokens) {
      for (const token of tokens) {
        const hit = tokenHaystack(item, token.field).includes(token.value);
        if (token.negative ? hit : !hit) return false;
      }
      return true;
    }

    function queryMatches(item, query) {
      const groups = parseQuery(query);
      return groups.length === 0 || groups.some(group => groupMatches(item, group));
    }

    function queryScore(item, query) {
      const groups = parseQuery(query);
      if (!groups.length) return 0;
      let best = 0;
      for (const group of groups) {
        if (!groupMatches(item, group)) continue;
        let score = 0;
        for (const token of group.filter(token => !token.negative)) {
          if (item._fields.title.includes(token.value)) score += token.phrase ? 18 : 12;
          if (item._fields.tag.includes(token.value)) score += 8;
          if (item._fields.author.includes(token.value)) score += 6;
          if (item._fields.notes.includes(token.value)) score += 3;
          if (item._fields.year.includes(token.value)) score += 4;
          if (token.field !== 'all') score += 4;
        }
        best = Math.max(best, score);
      }
      return best;
    }

    function pathTermHits(item, path) {
      return path.terms.reduce((count, term) => count + (item._blob.includes(normalize(term)) ? 1 : 0), 0);
    }

    function pathMatches(item, key) {
      const path = PATHS[key];
      if (!path) return true;
      const hits = pathTermHits(item, path);
      if (key === 'spectral') return path.categories.includes(item.category) && hits > 0;
      if (key === 'dlopt') return item.category === 'optimizer';
      if (key === 'tools') return path.categories.includes(item.category);
      if (key === 'math') return item.category === 'mathematics' || (path.categories.includes(item.category) && hits > 0);
      return path.categories.includes(item.category) && hits > 0;
    }

    function pathScore(item, key) {
      const path = PATHS[key];
      if (!path || !pathMatches(item, key)) return 0;
      let score = path.categories.includes(item.category) ? 5 : 0;
      score += pathTermHits(item, path) * 3;
      if (path.priorityBoost.includes(item.priority)) score += 4;
      return score;
    }

    function matchesBaseFilters(item, exclude = '') {
      if (exclude !== 'category' && state.category !== 'all' && item.category !== state.category) return false;
      if (exclude !== 'tag' && state.tag !== 'all' && !item.tags.includes(state.tag)) return false;
      if (exclude !== 'access' && state.access !== 'all' && item.access !== state.access) return false;
      if (exclude !== 'level' && state.level !== 'all' && item.level !== state.level) return false;
      if (exclude !== 'priority' && state.priority !== 'all' && item.priority !== state.priority) return false;
      if (state.favOnly && !favorites.has(item.id)) return false;
      if (state.openOnly && item.access !== 'Open') return false;
      const status = statuses[item.id] || '';
      if (exclude !== 'status' && state.status !== 'all') {
        if (state.status === 'none' ? Boolean(status) : status !== state.status) return false;
      }
      if (state.activePath && !pathMatches(item, state.activePath)) return false;
      if (!queryMatches(item, state.q)) return false;
      return true;
    }

    function sortItems(items) {
      const priorityRank = { Core:0, Frontier:1, Practical:2, Recommended:3 };
      const ranked = [...items];
      const compareTitle = (a,b) => collator.compare(a.title, b.title);
      if (state.sort === 'relevance') ranked.sort((a,b) => (queryScore(b,state.q) - queryScore(a,state.q)) || (pathScore(b,state.activePath) - pathScore(a,state.activePath)) || ((priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)) || (yearNumber(b.year)-yearNumber(a.year)) || compareTitle(a,b));
      else if (state.sort === 'year_desc') ranked.sort((a,b) => yearNumber(b.year)-yearNumber(a.year) || compareTitle(a,b));
      else if (state.sort === 'year_asc') ranked.sort((a,b) => (yearNumber(a.year) || 9999)-(yearNumber(b.year) || 9999) || compareTitle(a,b));
      else if (state.sort === 'title') ranked.sort(compareTitle);
      else if (state.sort === 'category') ranked.sort((a,b) => collator.compare(categoryLabel(a.category), categoryLabel(b.category)) || compareTitle(a,b));
      else if (state.sort === 'priority') ranked.sort((a,b) => (priorityRank[a.priority] ?? 9)-(priorityRank[b.priority] ?? 9) || compareTitle(a,b));
      return ranked;
    }

    function highlight(value) {
      const text = String(value ?? '');
      const terms = [...new Set(parseQuery(state.q).flat().filter(t => !t.negative && ['all','title'].includes(t.field))
        .map(t => t.value).filter(v => v.length > 1))].sort((a,b) => b.length-a.length).slice(0, 12);
      if (!terms.length) return escapeHTML(text);
      // Match original text before HTML escaping, so entities and generated tags cannot be matched again.
      const regex = new RegExp(terms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'giu');
      let result = '', offset = 0;
      for (const match of text.matchAll(regex)) {
        result += escapeHTML(text.slice(offset, match.index)) + '<mark>' + escapeHTML(match[0]) + '</mark>';
        offset = match.index + match[0].length;
      }
      return result + escapeHTML(text.slice(offset));
    }

    function badgeClass(value) { return value === 'Core' ? 'core' : value === 'Frontier' ? 'frontier' : value === 'Open' ? 'open' : ''; }
    function yearLabel(value) { return Number.isInteger(value) ? String(value) : 'n.d.'; }
    function byId(id) { return ALL.find(item => item.id === id) || null; }

    function buildCategoryControls() {
      const faceted = ALL.filter(item => matchesBaseFilters(item, 'category'));
      const counts = new Map(SITE_META.categoryOrder.map(category => [category, faceted.filter(item => item.category === category).length]));
      const allCount = faceted.length;
      $('#categoryNav').innerHTML = ['all', ...SITE_META.categoryOrder].map(category => {
        const count = category === 'all' ? allCount : counts.get(category);
        const label = category === 'all' ? '전체 자료' : categoryLabel(category);
        const icon = category === 'all' ? '⌘' : categoryIcon(category);
        return `<button class="nav-item ${state.category === category ? 'active' : ''}" type="button" data-category="${escapeAttr(category)}" aria-pressed="${state.category === category}"><span class="nav-name"><span aria-hidden="true">${icon}</span><span>${escapeHTML(label)}</span></span><span class="nav-count">${count}</span></button>`;
      }).join('');

      const select = $('#categorySelect');
      select.innerHTML = `<option value="all">모든 카테고리</option>` + SITE_META.categoryOrder.map(category => `<option value="${escapeAttr(category)}">${categoryIcon(category)} ${escapeHTML(categoryLabel(category))}</option>`).join('');
      select.value = state.category;
    }

    function buildPaths() {
      const markup = Object.entries(PATHS).map(([key,path]) => `<button class="path-btn ${state.activePath === key ? 'active' : ''}" type="button" data-path="${key}" aria-pressed="${state.activePath === key}"><strong>${escapeHTML(path.title)}</strong><span>${escapeHTML(path.desc)}</span></button>`).join('');
      $('#pathList').innerHTML = markup;
      $('#heroPaths').innerHTML = Object.entries(PATHS).filter(([key]) => ['core','stochastic','spectral'].includes(key)).map(([key,path]) => `<button class="btn" type="button" data-path="${key}">${escapeHTML(path.short)}</button>`).join('');
    }

    function buildTagCloud() {
      const counts = new Map();
      for (const item of ALL.filter(item => matchesBaseFilters(item, 'tag'))) for (const tag of item.tags) counts.set(tag, (counts.get(tag) || 0) + 1);
      const sorted = [...counts.entries()].sort((a,b) => b[1]-a[1] || collator.compare(a[0],b[0]));
      const limit = tagsExpanded ? sorted.length : 12;
      const visible = sorted.slice(0,limit);
      const controls = [`<button class="tag-chip ${state.tag === 'all' ? 'active' : ''}" type="button" data-tag="all" aria-pressed="${state.tag === 'all'}">모든 태그</button>`]
        .concat(visible.map(([tag,count]) => `<button class="tag-chip ${state.tag === tag ? 'active' : ''}" type="button" data-tag="${escapeAttr(tag)}" aria-pressed="${state.tag === tag}">${escapeHTML(tag)} · ${count}</button>`));
      if (sorted.length > 12) controls.push(`<button class="tag-chip" type="button" data-action="toggle-tags">${tagsExpanded ? '태그 접기' : `전체 태그 ${sorted.length}개`}</button>`);
      const cloud = $('#tagCloud');
      cloud.classList.toggle('expanded', tagsExpanded);
      cloud.innerHTML = controls.join('');
    }

    function renderActiveFilters() {
      const chips = [];
      const add = (key,label) => chips.push(`<span class="filter-pill">${escapeHTML(label)}<button type="button" data-clear-filter="${key}" aria-label="${escapeAttr(label)} 필터 제거">×</button></span>`);
      if (state.q) add('q', `Search: ${state.q}`);
      if (state.category !== 'all') add('category', categoryLabel(state.category));
      if (state.tag !== 'all') add('tag', `#${state.tag}`);
      if (state.access !== 'all') add('access', state.access);
      if (state.level !== 'all') add('level', state.level);
      if (state.priority !== 'all') add('priority', state.priority);
      if (state.status !== 'all') add('status', `status:${state.status}`);
      if (state.favOnly) add('favOnly', 'Favorites');
      if (state.openOnly) add('openOnly', 'Open only');
      if (state.activePath) add('activePath', PATHS[state.activePath].title);
      $('#activeFilters').innerHTML = chips.length ? chips.join('') : '<span class="mini-pill">모든 자료를 표시합니다</span>';
    }

    function renderPathGuide() {
      const guide = $('#pathGuide'), path = PATHS[state.activePath];
      guide.hidden = !path;
      if (!path) { guide.innerHTML = ''; return; }
      guide.innerHTML = `<h3>권장 읽기 순서</h3><p>${escapeHTML(path.prerequisites)}</p><ol>${path.steps.map(([id,label,goal]) => {
        const item = byId(id);
        return item ? `<li><button type="button" data-open-item="${escapeAttr(id)}">${escapeHTML(label)} · ${escapeHTML(item.title)}</button><span>${escapeHTML(goal)}</span></li>` : '';
      }).join('')}</ol>`;
    }

    function renderHeading() {
      if (state.activePath) {
        $('#contentTitle').textContent = PATHS[state.activePath].title;
        $('#contentDesc').textContent = PATHS[state.activePath].desc;
      } else if (state.category !== 'all') {
        $('#contentTitle').textContent = `${categoryIcon(state.category)} ${categoryLabel(state.category)}`;
        $('#contentDesc').textContent = SITE_META.categoryDesc[state.category] || '';
      } else {
        $('#contentTitle').textContent = '전체 자료';
        $('#contentDesc').textContent = '전체 자료를 검색하고 필터링합니다.';
      }
    }

    function syncControls() {
      $('#globalSearch').value = state.q;
      $('#accessSelect').value = state.access;
      $('#levelSelect').value = state.level;
      $('#prioritySelect').value = state.priority;
      $('#statusFilter').value = state.status;
      $('#sortSelect').value = state.sort;
      $('#favOnlyBtn').classList.toggle('active', state.favOnly);
      $('#favOnlyBtn').setAttribute('aria-pressed', String(state.favOnly));
      $('#openOnlyBtn').classList.toggle('active', state.openOnly);
      $('#openOnlyBtn').setAttribute('aria-pressed', String(state.openOnly));
      for (const button of $$('[data-view]')) {
        const active = button.dataset.view === state.view;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      }
      $('#resourceGrid').style.display = state.view === 'cards' ? 'grid' : 'none';
      $('#tableWrap').style.display = state.view === 'table' ? 'block' : 'none';
    }

    function renderStats() {
      $('#lastUpdated').textContent = SITE_META.lastUpdated;
      $('#appVersion').textContent = SITE_META.appVersion;
      $('#footerCount').textContent = ALL.length;
      $('#statTotal').textContent = ALL.length;
      $('#statOpen').textContent = ALL.filter(item => item.access === 'Open').length;
      $('#statFrontier').textContent = ALL.filter(item => item.priority === 'Frontier').length;
      $('#statFav').textContent = favorites.size;
      $('#visibleMini').textContent = `${filteredItems.length}개`;
      const done = ALL.filter(item => statuses[item.id] === 'done').length;
      const progress = ALL.length ? Math.round(done / ALL.length * 100) : 0;
      $('#progressText').textContent = `${done} / ${ALL.length} · ${progress}%`;
      $('#progressFill').style.width = `${progress}%`;
      $('#selectedCount').textContent = `${selected.size}개 선택`;
      $('#compareTray').classList.toggle('active', selected.size > 0);
    }

    function cardLinks(item) {
      return item.links.slice(0,2).map(link => {
        const url = validURL(link.url);
        return url ? `<a class="resource-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(link.label || 'Link')} ↗</a>` : '';
      }).join('');
    }

    function renderCards(items) {
      $('#resourceGrid').innerHTML = items.map(item => {
        const status = statuses[item.id] || '';
        return `<article class="resource-card" data-id="${escapeAttr(item.id)}">
          <div class="card-top">
            <div><button class="title-button" type="button" data-open-item="${escapeAttr(item.id)}">${highlight(item.title)}</button><p class="card-authors">${escapeHTML(item.authors || 'Unknown author')}</p></div>
            <div class="quick-actions">
              <button class="quick-btn star ${favorites.has(item.id) ? 'active' : ''}" type="button" data-favorite="${escapeAttr(item.id)}" aria-pressed="${favorites.has(item.id)}" aria-label="즐겨찾기">★</button>
              <button class="quick-btn select ${selected.has(item.id) ? 'active' : ''}" type="button" data-select-item="${escapeAttr(item.id)}" aria-pressed="${selected.has(item.id)}" aria-label="비교 선택">✓</button>
            </div>
          </div>
          <div class="card-meta">
            <span class="badge">${categoryIcon(item.category)} ${escapeHTML(categoryLabel(item.category))}</span>
            <span class="badge">${escapeHTML(yearLabel(item.year))}</span>
            <span class="badge ${badgeClass(item.access)}">${escapeHTML(item.access)}</span>
            <span class="badge">${escapeHTML(item.level)}</span>
            <span class="badge ${badgeClass(item.priority)}">${escapeHTML(item.priority)}</span>
          </div>
          <p class="card-notes">${escapeHTML(item.notes || '')}</p>
          <div class="card-tags">${item.tags.slice(0,7).map(tag => `<button class="small-tag" type="button" data-tag="${escapeAttr(tag)}">${escapeHTML(tag)}</button>`).join('')}</div>
          <div class="card-footer"><div class="link-row">${cardLinks(item)}<button class="ghost-btn" type="button" data-open-item="${escapeAttr(item.id)}">상세·노트</button></div>
          <select class="status-select" data-status-item="${escapeAttr(item.id)}" aria-label="${escapeAttr(item.title)} 읽기 상태"><option value="">미지정</option><option value="planned" ${status === 'planned' ? 'selected' : ''}>읽을 예정</option><option value="reading" ${status === 'reading' ? 'selected' : ''}>읽는 중</option><option value="done" ${status === 'done' ? 'selected' : ''}>완료</option></select></div>
        </article>`;
      }).join('');
    }

    function renderTable(items) {
      $('#resourceTable').innerHTML = items.map(item => `<tr>
        <td><button class="table-title" type="button" data-open-item="${escapeAttr(item.id)}">${highlight(item.title)}</button></td>
        <td>${categoryIcon(item.category)} ${escapeHTML(categoryLabel(item.category))}</td>
        <td>${escapeHTML(item.authors || 'Unknown')}</td><td>${escapeHTML(yearLabel(item.year))}</td><td>${escapeHTML(item.priority)}</td>
        <td><select class="status-select" data-status-item="${escapeAttr(item.id)}" aria-label="${escapeAttr(item.title)} 읽기 상태"><option value="">—</option><option value="planned" ${statuses[item.id] === 'planned' ? 'selected' : ''}>읽을 예정</option><option value="reading" ${statuses[item.id] === 'reading' ? 'selected' : ''}>읽는 중</option><option value="done" ${statuses[item.id] === 'done' ? 'selected' : ''}>완료</option></select></td>
        <td><div class="quick-actions"><button class="quick-btn star ${favorites.has(item.id) ? 'active' : ''}" type="button" data-favorite="${escapeAttr(item.id)}" aria-label="${escapeAttr(item.title)} 즐겨찾기" aria-pressed="${favorites.has(item.id)}">★</button><button class="quick-btn select ${selected.has(item.id) ? 'active' : ''}" type="button" data-select-item="${escapeAttr(item.id)}" aria-label="${escapeAttr(item.title)} 비교 선택" aria-pressed="${selected.has(item.id)}">✓</button></div></td>
      </tr>`).join('');
    }

    function captureFocus(el) {
      if (!el) return null;
      const keys = ['favorite','selectItem','statusItem','category','path','tag','openItem','clearFilter','action'];
      const key = keys.find(k => el.dataset?.[k]);
      return {el, id:el.id, key, value:key ? el.dataset[key] : null,
        item:el.closest?.('[data-id]')?.dataset.id, inTable:Boolean(el.closest?.('#tableWrap'))};
    }
    function resolveFocus(ref) {
      if (!ref) return null;
      if (ref.el.isConnected) return ref.el;
      if (ref.id) return document.getElementById(ref.id);
      if (!ref.key) return null;
      return $$('button, select').find(el => el.dataset[ref.key] === ref.value &&
        (!ref.item || el.closest('[data-id]')?.dataset.id === ref.item) &&
        Boolean(el.closest('#tableWrap')) === ref.inTable && !el.closest('.backdrop:not(.active)')) || null;
    }
    function restoreRenderedFocus(ref) {
      if (!ref || ref.el.isConnected) return;
      (resolveFocus(ref) || $('#contentTitle')).focus({preventScroll:true});
    }

    function render() {
      const focus = captureFocus(document.activeElement);
      filteredItems = sortItems(ALL.filter(item => matchesBaseFilters(item)));
      const visible = filteredItems.slice(0, renderLimit);
      buildCategoryControls();
      buildPaths();
      buildTagCloud();
      renderActiveFilters();
      renderHeading();
      syncControls();
      renderCards(visible);
      renderTable(visible);
      renderStats();
      $('#resultCount').textContent = filteredItems.length > renderLimit ? `${filteredItems.length}개 중 ${visible.length}개 표시` : `${filteredItems.length}개 자료`;
      $('#emptyState').style.display = filteredItems.length ? 'none' : 'block';
      $('#loadMoreWrap').style.display = filteredItems.length > renderLimit ? 'flex' : 'none';
      renderPathGuide();
      restoreRenderedFocus(focus);
    }

    function resetRenderLimit() { renderLimit = 24; }
    function updateState(patch, { resetLimit = true } = {}) {
      state = sanitizeState({ ...state, ...patch });
      if (resetLimit) resetRenderLimit();
      persistState();
      render();
    }

    function resetFilters() {
      const view = state.view;
      state = { ...DEFAULT_STATE, view };
      tagsExpanded = false;
      resetRenderLimit();
      persistState();
      render();
      showToast('필터를 초기화했습니다.');
    }

    function applyPath(key) {
      if (!PATHS[key]) return;
      updateState({ ...DEFAULT_STATE, view: state.view, activePath: key });
      document.querySelector('.content')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      showToast(`${PATHS[key].title} 경로를 적용했습니다.`);
    }

    function toggleFavorite(id) {
      if (!byId(id)) return;
      favorites.has(id) ? favorites.delete(id) : favorites.add(id);
      persistFavorites();
      render();
      updateDetailActions();
    }

    function toggleSelected(id) {
      if (!byId(id)) return;
      if (selected.has(id)) selected.delete(id);
      else if (selected.size >= 4) { showToast('비교는 최대 4개까지 선택할 수 있습니다.'); return; }
      else selected.add(id);
      persistSelected();
      render();
      updateDetailActions();
    }

    function setStatus(id, value) {
      if (!byId(id)) return;
      if (value) statuses[id] = value; else delete statuses[id];
      persistStatuses();
      render();
      if (currentItem?.id === id) $('#detailStatus').value = value;
    }

    function showToast(message) {
      const toast = $('#toast');
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => toast.classList.remove('show'), 4200);
    }

    async function copyText(text, message = '복사했습니다.') {
      const returnTo = document.activeElement;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed'; textarea.style.opacity = '0';
        // Keep the fallback inside an active modal, whose background is inert.
        (activeModal || document.body).appendChild(textarea); textarea.select();
        let ok = false;
        try { ok = document.execCommand('copy'); } catch { /* clipboard unavailable */ }
        finally { textarea.remove(); returnTo?.focus?.(); }
        if (!ok) { showToast('복사하지 못했습니다.'); return; }
      }
      showToast(message);
    }

    function citationPlain(item) {
      const authors = item.authors || 'Unknown';
      const year = item.year ?? 'n.d.';
      const url = validURL(item.links[0]?.url || '');
      return `${authors} (${year}). ${item.title}.${url ? ` ${url}` : ''}`;
    }
    function citationMarkdown(item) {
      const authors = item.authors || 'Unknown';
      const year = item.year ?? 'n.d.';
      const url = validURL(item.links[0]?.url || '');
      return url ? `- **${item.title}** — ${authors} (${year}). [Link](${url})` : `- **${item.title}** — ${authors} (${year}).`;
    }
    function texEscape(value) {
      return String(value).replace(/[\\{}%&#_$~^]/g, ch => ({'\\':'\\textbackslash{}','{':'\\{','}':'\\}','%':'\\%','&':'\\&','#':'\\#','_':'\\_','$':'\\$','~':'\\textasciitilde{}','^':'\\textasciicircum{}'}[ch]));
    }
    function citationBibTeX(item) {
      const type = item.bibType || (item.category === 'textbook' ? 'book' : 'misc');
      const key = `atlas_${item.year || 'nd'}_${item.id}`;
      const url = validURL(item.links[0]?.url || '');
      const authors = item.authorList || (item.authors || 'Unknown').replace(/,?\s*et al\.?/i, ', others').split(/,\s*/).filter(Boolean);
      const authorText = item.corporateAuthor ? `{${texEscape(item.authors)}}` : authors.map(texEscape).join(' and ');
      const fields = [`  title = {{${texEscape(item.title)}}}`, `  author = {${authorText}}`];
      if (Number.isInteger(item.year)) fields.push(`  year = {${item.year}}`);
      if (item.doi) fields.push(`  doi = {${texEscape(item.doi)}}`);
      if (url) fields.push(`  url = {${url.replace(/[{}\\]/g, ch => encodeURIComponent(ch))}}`);
      if (!item.authorList && /et al\.?/i.test(item.authors)) fields.push('  note = {Partial author list; verify against the original source}');
      return `@${type}{${key},\n${fields.join(',\n')}\n}`;
    }

    function formatCitation(item, format = $('#citationFormat').value) {
      return format === 'bibtex' ? citationBibTeX(item) : format === 'markdown' ? citationMarkdown(item) : citationPlain(item);
    }
    function selectedItems() { return [...selected].map(byId).filter(Boolean); }
    function copySelectedCitations() {
      const items = selectedItems();
      if (!items.length) { showToast('선택한 자료가 없습니다.'); return; }
      copyText(items.map(item => formatCitation(item)).join('\n\n'), '선택 자료의 인용을 복사했습니다.');
    }

    function openItem(id) {
      if (activeModal?.id === 'detailModal') savePersonalNote();
      currentItem = byId(id);
      if (!currentItem) return;
      $('#detailTitle').textContent = currentItem.title;
      $('#detailSub').textContent = `${categoryIcon(currentItem.category)} ${categoryLabel(currentItem.category)} · ${currentItem.authors || 'Unknown author'}`;
      $('#detailNotes').textContent = currentItem.notes || '';
      $('#detailVerification').textContent = currentItem.verifiedAt ? `서지정보 대조: ${currentItem.verifiedAt} · 외부 자료 접근 조건은 바뀔 수 있습니다.` : '원본 목록의 서지정보 · 이번 개정에서 개별 대조하지 않은 항목입니다.';
      $('#detailMeta').textContent = `Year: ${yearLabel(currentItem.year)}\nLevel: ${currentItem.level}\nAccess: ${currentItem.access}\nPriority: ${currentItem.priority}\nCategory: ${categoryLabel(currentItem.category)}\nID: ${currentItem.id}`;
      $('#detailLinks').innerHTML = currentItem.links.map(link => { const url = validURL(link.url); return url ? `<a class="resource-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(link.label || 'Link')} ↗</a>` : ''; }).join('') || '<span class="mini-pill">No valid link</span>';
      $('#detailTags').innerHTML = currentItem.tags.map(tag => `<button class="small-tag" type="button" data-tag="${escapeAttr(tag)}">${escapeHTML(tag)}</button>`).join('');
      $('#detailStatus').value = statuses[currentItem.id] || '';
      $('#personalNotes').value = notes[currentItem.id] || '';
      $('#noteSaveState').textContent = storageDegraded ? '임시 보관 중 · JSON 백업을 내려받으세요' : '브라우저에 자동 저장';
      updateDetailActions();
      openModal('detailModal');
    }

    function updateDetailActions() {
      if (!currentItem) return;
      $('#detailFavBtn').setAttribute('aria-pressed',String(favorites.has(currentItem.id)));
      $('#detailSelectBtn').setAttribute('aria-pressed',String(selected.has(currentItem.id)));
      $('#detailFavBtn').textContent = favorites.has(currentItem.id) ? '★ 즐겨찾기 해제' : '☆ 즐겨찾기';
      $('#detailSelectBtn').textContent = selected.has(currentItem.id) ? '✓ 비교 선택 해제' : '비교에 추가';
    }

    function savePersonalNote() {
      if (!currentItem) return;
      const value = $('#personalNotes').value;
      if (value) notes[currentItem.id] = value; else delete notes[currentItem.id];
      const saved = persistNotes();
      $('#noteSaveState').textContent = saved ? '저장됨 · 이 브라우저' : '임시 보관 중 · JSON 백업을 내려받으세요';
    }

    function renderCompare() {
      const items = selectedItems();
      if (!items.length) { showToast('선택한 자료가 없습니다.'); return false; }
      const rows = [
        ['Title', ...items.map(item => `<strong class="compare-title">${escapeHTML(item.title)}</strong>`)],
        ['Authors', ...items.map(item => escapeHTML(item.authors || 'Unknown'))],
        ['Category', ...items.map(item => `${categoryIcon(item.category)} ${escapeHTML(categoryLabel(item.category))}`)],
        ['Year', ...items.map(item => escapeHTML(yearLabel(item.year)))],
        ['Level', ...items.map(item => escapeHTML(item.level))],
        ['Access', ...items.map(item => escapeHTML(item.access))],
        ['Priority', ...items.map(item => escapeHTML(item.priority))],
        ['Status', ...items.map(item => escapeHTML(statuses[item.id] || '—'))],
        ['Tags', ...items.map(item => item.tags.slice(0,9).map(tag => `<span class="mini-pill">${escapeHTML(tag)}</span>`).join(' '))],
        ['Notes', ...items.map(item => escapeHTML(item.notes || ''))],
        ['Link', ...items.map(item => { const url = validURL(item.links[0]?.url || ''); return url ? `<a class="resource-link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">Open ↗</a>` : '—'; })]
      ];
      $('#compareTable').innerHTML = `<tbody>${rows.map(row => `<tr>${row.map((cell,index) => index === 0 ? `<th scope="row">${cell}</th>` : `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody>`;
      return true;
    }

    function focusableElements(root) {
      return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root).filter(el => !el.hasAttribute('hidden') && !el.closest('[hidden]') && !el.closest('[inert]'));
    }
    function openModal(id) {
      const modal = document.getElementById(id);
      if (!modal) return;
      if (activeModal && activeModal !== modal) closeModal(activeModal.id, false);
      lastFocused = document.activeElement;
      returnFocus = captureFocus(lastFocused);
      activeModal = modal;
      modal.classList.add('active'); modal.setAttribute('aria-hidden','false');
      document.body.classList.add('modal-open');
      for (const el of $$('body > header, body > main, body > footer, .compare-tray, .skip-link')) el.inert = true;
      requestAnimationFrame(() => focusableElements(modal)[0]?.focus());
    }
    function closeModal(id, restoreFocus = true) {
      const modal = document.getElementById(id);
      if (!modal) return;
      modal.classList.remove('active'); modal.setAttribute('aria-hidden','true');
      if (activeModal === modal) activeModal = null;
      if (!activeModal) { document.body.classList.remove('modal-open'); for (const el of $$('[inert]')) el.inert = false; }
      if (id === 'detailModal') { savePersonalNote(); currentItem = null; }
      if (restoreFocus) { (resolveFocus(returnFocus) || $('#contentTitle')).focus(); }
    }
    function trapFocus(event) {
      if (!activeModal || event.key !== 'Tab') return;
      const focusables = focusableElements(activeModal);
      if (!focusables.length) return;
      const first = focusables[0], last = focusables.at(-1);
      if (event.shiftKey && (document.activeElement === first || !activeModal.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !activeModal.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    }

    function safeCSV(value) {
      let text = String(value ?? '');
      if (/^\s*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = `'${text}`;
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
    }
    function downloadFile(name, content, type) {
      const blob = new Blob([content], { type });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    function exportCSV() {
      const rows = [['id','category','title','authors','year','level','access','priority','status','tags','resource_notes','personal_notes','links']];
      for (const item of filteredItems) rows.push([item.id, categoryLabel(item.category), item.title, item.authors, item.year ?? '', item.level, item.access, item.priority, statuses[item.id] || '', item.tags.join('; '), item.notes, notes[item.id] || '', item.links.map(link => `${link.label}: ${link.url}`).join(' | ')]);
      const content = '\ufeff' + rows.map(row => row.map(safeCSV).join(',')).join('\n');
      downloadFile(`optimization_resources_${new Date().toISOString().slice(0,10)}.csv`, content, 'text/csv;charset=utf-8');
      showToast(`${filteredItems.length}개 결과를 CSV로 내보냈습니다.`);
    }
    function shareCurrentView() {
      syncHash();
      if (location.protocol === 'file:') { copyText(location.hash, '필터 코드를 복사했습니다. 받는 분은 도움말에서 붙여넣을 수 있습니다.'); }
      else copyText(location.href, '현재 필터 URL을 복사했습니다.');
    }
    function exportBackup() {
      const payload = { schema: 'optimization-resource-atlas-user-data', version: 1, appVersion: SITE_META.appVersion, exportedAt: new Date().toISOString(), userData: { favorites:[...favorites], selected:[...selected], notes, statuses, state } };
      downloadFile(`optimization_atlas_backup_${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(payload,null,2), 'application/json;charset=utf-8');
      showToast('개인 데이터 백업을 저장했습니다.');
    }
    function validateBackup(payload) {
      if (!payload || payload.schema !== 'optimization-resource-atlas-user-data' || payload.version !== 1 ||
          !payload.userData || typeof payload.userData !== 'object' || Array.isArray(payload.userData)) throw new Error('지원하지 않는 백업 형식 또는 버전입니다.');
      const u = payload.userData;
      for (const key of ['favorites','selected']) if (!Array.isArray(u[key])) throw new Error('백업 목록 형식이 올바르지 않습니다.');
      for (const key of ['notes','statuses','state']) if (!u[key] || typeof u[key] !== 'object' || Array.isArray(u[key])) throw new Error('백업 데이터 형식이 올바르지 않습니다.');
      if (Object.values(u.notes).some(v => typeof v !== 'string') || Object.values(u.statuses).some(v => !['planned','reading','done'].includes(v))) throw new Error('백업 노트 또는 상태가 올바르지 않습니다.');
      return sanitizePersonal(u);
    }
    async function importBackup(file) {
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error('10 MB 이하 JSON 파일을 선택하세요.');
        const incoming = validateBackup(JSON.parse(await file.text()));
        const merge = $('#restoreMode').value !== 'replace';
        if (!merge && !confirm('현재 개인 데이터를 이 백업으로 교체할까요? 먼저 JSON 백업을 권장합니다.')) return;
        if (merge) {
          favorites = new Set([...favorites, ...incoming.favorites]);
          selected = new Set([...new Set([...selected, ...incoming.selected])].slice(0, 4));
          // Keep current notes and statuses on conflict. Replacement is explicit.
          notes = {...incoming.notes, ...notes}; statuses = {...incoming.statuses, ...statuses};
        } else {
          favorites = new Set(incoming.favorites); selected = new Set(incoming.selected);
          notes = incoming.notes; statuses = incoming.statuses; state = incoming.state;
        }
        persistFavorites(); persistSelected(); persistNotes(); persistStatuses(); persistState();
        resetRenderLimit(); render(); closeModal('backupModal');
        showToast(storageDegraded ? '복원됨 · 영구 저장을 사용할 수 없어 JSON 백업이 필요합니다.' : '개인 데이터를 복원했습니다.');
      } catch(error) { showToast(error instanceof SyntaxError ? '올바른 JSON 파일이 아닙니다.' : error.message); }
      finally { $('#importFile').value = ''; }
    }

    function clearPersonalData() {
      if (!confirm('즐겨찾기, 읽기 상태, 노트, 선택 항목을 모두 삭제하시겠습니까?')) return;
      favorites.clear(); selected.clear(); notes = {}; statuses = {};
      for (const key of ['favorites','selected','notes','status']) { storage.remove(STORAGE[key]); storage.remove(LEGACY[key]); }
      persistFavorites(); persistSelected(); persistNotes(); persistStatuses();
      render(); closeModal('backupModal'); showToast('개인 데이터를 삭제했습니다.');
    }

    function initTheme() {
      const saved = storage.get(STORAGE.theme);
      const light = saved ? saved === 'light' : window.matchMedia?.('(prefers-color-scheme: light)')?.matches;
      document.body.classList.toggle('light', Boolean(light));
      syncThemeButton();
    }
    function syncThemeButton() {
      const light = document.body.classList.contains('light');
      $('#themeIcon').textContent = light ? '☾' : '☼';
      $('#themeLabel').textContent = light ? '다크' : '라이트';
      $('meta[name="theme-color"]').setAttribute('content', light ? '#f5f8fc' : '#07111f');
    }
    function toggleTheme() {
      const light = document.body.classList.toggle('light');
      storage.set(STORAGE.theme, light ? 'light' : 'dark');
      syncThemeButton();
    }

    function handleClick(event) {
      const target = event.target.closest('button, a');
      if (!target) return;
      if (target.id === 'brandHome') { event.preventDefault(); resetFilters(); window.scrollTo({ top:0, behavior:'smooth' }); return; }
      if (target.dataset.openItem) { openItem(target.dataset.openItem); return; }
      if (target.dataset.favorite) { toggleFavorite(target.dataset.favorite); return; }
      if (target.dataset.selectItem) { toggleSelected(target.dataset.selectItem); return; }
      if (target.dataset.tag) { if (activeModal) closeModal(activeModal.id); updateState({ tag: target.dataset.tag, activePath: '' }); return; }
      if (target.dataset.category) { updateState({ category: target.dataset.category, tag:'all', activePath:'' }); return; }
      if (target.dataset.path) { applyPath(target.dataset.path); return; }
      if (target.dataset.view) { updateState({ view: target.dataset.view }, { resetLimit:false }); return; }
      if (target.dataset.toggle) { updateState({ [target.dataset.toggle]: !state[target.dataset.toggle] }); return; }
      if (target.dataset.clearFilter) {
        const key = target.dataset.clearFilter;
        const value = ['favOnly','openOnly'].includes(key) ? false : key === 'activePath' ? '' : DEFAULT_STATE[key];
        updateState({ [key]: value }); return;
      }
      if (target.dataset.openModal) { openModal(target.dataset.openModal); return; }
      if (target.hasAttribute('data-close-modal')) { closeModal(target.closest('.backdrop').id); return; }
      if (target.dataset.action === 'reset' || target.id === 'resetBtn') { resetFilters(); return; }
      if (target.dataset.action === 'toggle-tags') { tagsExpanded = !tagsExpanded; buildTagCloud(); return; }
      if (target.id === 'applyViewCodeBtn') {
        const value = $('#viewCode').value.trim();
        const hash = value.includes('#?') ? value.slice(value.indexOf('#?')) : '';
        if (!hash) { showToast('올바른 필터 코드 또는 URL을 입력하세요.'); return; }
        location.hash = hash; state = sanitizeState(parseHashState()); persistState(); resetRenderLimit(); render(); closeModal('helpModal'); return;
      }
      if (target.id === 'themeBtn') { toggleTheme(); return; }
      if (target.id === 'loadMoreBtn') { renderLimit += 24; render(); return; }
      if (target.id === 'copySelectedBtn' || target.id === 'trayCopyBtn') { copySelectedCitations(); return; }
      if (target.id === 'clearSelectedBtn') { selected.clear(); persistSelected(); render(); return; }
      if (target.id === 'compareBtn') { if (renderCompare()) openModal('compareModal'); return; }
      if (target.id === 'detailFavBtn' && currentItem) { toggleFavorite(currentItem.id); return; }
      if (target.id === 'detailSelectBtn' && currentItem) { toggleSelected(currentItem.id); return; }
      if (target.id === 'detailCopyBtn' && currentItem) { copyText(formatCitation(currentItem), '인용을 복사했습니다.'); return; }
      if (target.id === 'shareViewBtn') { shareCurrentView(); return; }
      if (target.id === 'exportCsvBtn') { exportCSV(); return; }
      if (target.id === 'exportBackupBtn') { exportBackup(); return; }
      if (target.id === 'importBackupBtn') { $('#importFile').click(); return; }
      if (target.id === 'clearPersonalBtn') { clearPersonalData(); return; }
    }

    function handleChange(event) {
      const target = event.target;
      const map = { categorySelect:'category', accessSelect:'access', levelSelect:'level', prioritySelect:'priority', statusFilter:'status', sortSelect:'sort' };
      if (map[target.id]) {
        const patch = { [map[target.id]]: target.value };
        if (target.id === 'categorySelect') Object.assign(patch, { tag:'all', activePath:'' });
        updateState(patch); return;
      }
      if (target.matches('[data-status-item]')) { setStatus(target.dataset.statusItem, target.value); return; }
      if (target.id === 'detailStatus' && currentItem) { setStatus(currentItem.id, target.value); return; }
      if (target.id === 'importFile' && target.files?.[0]) { importBackup(target.files[0]); }
    }

    function handleBackdropClick(event) {
      if (event.target.classList.contains('backdrop')) closeModal(event.target.id);
    }

    function bindEvents() {
      document.addEventListener('click', handleClick);
      document.addEventListener('change', handleChange);
      $$('.backdrop').forEach(backdrop => backdrop.addEventListener('click', handleBackdropClick));
      $('#globalSearch').addEventListener('input', event => { if (!event.isComposing) updateState({ q:event.target.value, activePath:'' }); });
      $('#globalSearch').addEventListener('compositionend', event => updateState({ q:event.target.value, activePath:'' }));
      $('#personalNotes').addEventListener('input', () => { $('#noteSaveState').textContent = '저장 중…'; savePersonalNote(); });
      document.addEventListener('keydown', event => {
        trapFocus(event);
        const activeTag = document.activeElement?.tagName?.toLowerCase();
        const typing = ['input','textarea','select'].includes(activeTag) || document.activeElement?.isContentEditable;
        if (activeModal) { if (event.key === 'Escape') closeModal(activeModal.id); return; }
        if ((event.key === '/' && !typing) || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k')) { event.preventDefault(); $('#globalSearch').focus(); }
        else if (event.key === '?' && !typing) { event.preventDefault(); openModal('helpModal'); }
        else if (event.key.toLowerCase() === 't' && !typing) toggleTheme();
        else if (event.key === 'Escape' && activeModal) closeModal(activeModal.id);
      });
      window.addEventListener('hashchange', () => { if (location.hash && !location.hash.startsWith('#?')) return; state = sanitizeState(parseHashState()); resetRenderLimit(); render(); });
    }

    function init() {
      prepareData();
      loadState();
      storage.set('ora_storage_probe', '1'); storage.remove('ora_storage_probe');
      initTheme();
      bindEvents();
      if (window.matchMedia?.('(max-width: 960px)')?.matches) $$('.nav-disclosure').forEach(el => { el.open = false; });
      render();
    }
    document.addEventListener('DOMContentLoaded', init);
