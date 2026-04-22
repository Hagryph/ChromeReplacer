(() => {
  const ROW_H = 62;
  const ROW_GAP = 2;
  const BUFFER = 6;
  const STEP = ROW_H + ROW_GAP;

  const $ = (id) => document.getElementById(id);
  const viewport   = $('viewport');
  const spacer     = $('spacer');
  const rowsLayer  = $('rows');
  const emptyState = $('empty-state');
  const emptyTitle = $('empty-title');
  const emptyBody  = $('empty-body');
  const countPill  = $('count-pill');
  const toolbarDefault = $('toolbar-default');
  const toolbarBulk    = $('toolbar-bulk');
  const bulkCountN = $('bulk-count-n');
  const searchInp  = $('search');
  const toastStack = $('toast-stack');
  const confirmDlg = $('confirm-dialog');
  const confirmTitle = $('confirm-title');
  const confirmBody  = $('confirm-body');
  const confirmOk    = $('confirm-ok');
  const template   = $('row-template');
  const importFile = $('import-file');

  const hasStorage = typeof chrome !== 'undefined' && chrome.storage?.local;

  // State
  const state = {
    rules: [],
    filter: { query: '', status: 'all', regexOnly: false },
    selected: new Set(),
    indexed: [],
    invalid: new Map(),
  };

  // Row recycling pool — keyed by rule id so focus survives
  const rowPool = new Map();

  // Storage
  const loadRules = async () => {
    if (!hasStorage) return [];
    const { rules = [] } = await chrome.storage.local.get('rules');
    return Array.isArray(rules) ? rules : [];
  };
  let saveTimer = 0;
  const saveRules = () => {
    if (!hasStorage) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ rules: state.rules });
    }, 120);
  };

  // Helpers
  const uid = () => 'r_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const validateRule = (r) => {
    if (!r.isRegex) return null;
    if (!r.find) return null;
    try {
      const pat = r.wholeWord ? `\\b(?:${r.find})\\b` : r.find;
      new RegExp(pat, 'g');
      return null;
    } catch (e) { return String(e.message || e); }
  };

  const refreshInvalid = () => {
    state.invalid.clear();
    for (const r of state.rules) {
      const err = validateRule(r);
      if (err) state.invalid.set(r.id, err);
    }
  };

  const reindex = () => {
    const { query, status, regexOnly } = state.filter;
    const q = query.trim().toLowerCase();
    state.indexed = state.rules
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => {
        if (status === 'enabled' && !r.enabled) return false;
        if (status === 'disabled' && r.enabled) return false;
        if (regexOnly && !r.isRegex) return false;
        if (q) {
          const hay = `${r.find}\n${r.replace}`.toLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      });
  };

  // Update count pill
  const updateCount = () => {
    const total = state.rules.length;
    const shown = state.indexed.length;
    const word = total === 1 ? 'rule' : 'rules';
    countPill.textContent = shown === total ? `${total} ${word}` : `${shown} of ${total} ${word}`;
  };

  // Selection / bulk toolbar
  const visibleSelected = () => {
    const ids = new Set(state.indexed.map(({ r }) => r.id));
    let n = 0;
    for (const id of state.selected) if (ids.has(id)) n++;
    return n;
  };
  const updateBulkBar = () => {
    const n = state.selected.size;
    if (n === 0) {
      toolbarBulk.hidden = true;
      toolbarDefault.hidden = false;
    } else {
      toolbarDefault.hidden = true;
      toolbarBulk.hidden = false;
      bulkCountN.textContent = String(n);
    }
  };

  // Virtualized rendering
  const render = () => {
    const shown = state.indexed;
    const totalH = shown.length * STEP;
    spacer.style.height = `${totalH}px`;

    if (shown.length === 0) {
      emptyState.hidden = false;
      if (state.rules.length === 0) {
        emptyTitle.textContent = 'No rules yet';
        emptyBody.innerHTML = 'Click <strong>Add rule</strong> to create your first find-and-replace rule.';
      } else {
        emptyTitle.textContent = 'No rules match';
        emptyBody.textContent = 'Adjust your search or filters, or clear them to see everything.';
      }
      for (const el of rowPool.values()) el.style.display = 'none';
      return;
    }
    emptyState.hidden = true;

    const scrollTop = viewport.scrollTop;
    const vh = viewport.clientHeight;
    const start = Math.max(0, Math.floor(scrollTop / STEP) - BUFFER);
    const end = Math.min(shown.length, Math.ceil((scrollTop + vh) / STEP) + BUFFER);

    const live = new Set();
    for (let i = start; i < end; i++) {
      const { r } = shown[i];
      live.add(r.id);
      let el = rowPool.get(r.id);
      if (!el) {
        el = template.content.firstElementChild.cloneNode(true);
        rowPool.set(r.id, el);
        wireRow(el, r.id);
        rowsLayer.appendChild(el);
      }
      el.style.display = '';
      el.style.transform = `translateY(${i * STEP}px)`;
      paintRow(el, r);
    }

    for (const [id, el] of rowPool) {
      if (!live.has(id)) el.style.display = 'none';
    }
  };

  // Paint (without clobbering focused input)
  const paintRow = (el, r) => {
    el.dataset.ruleId = r.id;
    el.classList.toggle('is-disabled', !r.enabled);
    el.classList.toggle('is-selected', state.selected.has(r.id));
    el.classList.toggle('is-invalid', state.invalid.has(r.id));

    const check = el.querySelector('.row-check');
    if (check.checked !== state.selected.has(r.id)) check.checked = state.selected.has(r.id);

    const en = el.querySelector('.row-enabled');
    if (en.checked !== !!r.enabled) en.checked = !!r.enabled;

    const find = el.querySelector('.inp-find');
    if (document.activeElement !== find && find.value !== (r.find ?? '')) find.value = r.find ?? '';

    const rep = el.querySelector('.inp-replace');
    if (document.activeElement !== rep && rep.value !== (r.replace ?? '')) rep.value = r.replace ?? '';

    const tglRegex = el.querySelector('.tgl-regex');
    tglRegex.setAttribute('aria-pressed', r.isRegex ? 'true' : 'false');

    const tglWhole = el.querySelector('.tgl-whole');
    tglWhole.setAttribute('aria-pressed', r.wholeWord ? 'true' : 'false');

    const err = state.invalid.get(r.id);
    find.title = err ? `Regex error: ${err}` : '';
  };

  const getRuleById = (id) => state.rules.find((x) => x.id === id);

  const wireRow = (el, id) => {
    const check = el.querySelector('.row-check');
    check.addEventListener('change', () => {
      if (check.checked) state.selected.add(id); else state.selected.delete(id);
      el.classList.toggle('is-selected', check.checked);
      updateBulkBar();
    });

    const en = el.querySelector('.row-enabled');
    en.addEventListener('change', () => {
      const r = getRuleById(id);
      if (!r) return;
      r.enabled = en.checked;
      el.classList.toggle('is-disabled', !r.enabled);
      saveRules();
    });

    const find = el.querySelector('.inp-find');
    find.addEventListener('input', () => {
      const r = getRuleById(id);
      if (!r) return;
      r.find = find.value;
      refreshInvalid();
      el.classList.toggle('is-invalid', state.invalid.has(id));
      find.title = state.invalid.get(id) ? `Regex error: ${state.invalid.get(id)}` : '';
      saveRules();
    });

    const rep = el.querySelector('.inp-replace');
    rep.addEventListener('input', () => {
      const r = getRuleById(id);
      if (!r) return;
      r.replace = rep.value;
      saveRules();
    });

    const tglRegex = el.querySelector('.tgl-regex');
    tglRegex.addEventListener('click', () => {
      const r = getRuleById(id);
      if (!r) return;
      r.isRegex = !r.isRegex;
      tglRegex.setAttribute('aria-pressed', r.isRegex ? 'true' : 'false');
      refreshInvalid();
      el.classList.toggle('is-invalid', state.invalid.has(id));
      saveRules();
      reindex(); render();
    });

    const tglWhole = el.querySelector('.tgl-whole');
    tglWhole.addEventListener('click', () => {
      const r = getRuleById(id);
      if (!r) return;
      r.wholeWord = !r.wholeWord;
      tglWhole.setAttribute('aria-pressed', r.wholeWord ? 'true' : 'false');
      refreshInvalid();
      el.classList.toggle('is-invalid', state.invalid.has(id));
      saveRules();
    });

    const del = el.querySelector('.row-delete');
    del.addEventListener('click', () => deleteRules([id], 'rule'));
  };

  // Mutations
  const addRule = () => {
    const r = {
      id: uid(),
      enabled: true,
      find: '',
      replace: '',
      isRegex: false,
      wholeWord: false,
    };
    state.rules.unshift(r);
    refreshInvalid();
    reindex();
    render();
    updateCount();
    saveRules();
    viewport.scrollTop = 0;
    requestAnimationFrame(() => {
      const el = rowPool.get(r.id);
      el?.querySelector('.inp-find')?.focus();
    });
  };

  const deleteRules = (ids, kind) => {
    const n = ids.length;
    if (n === 0) return;
    const label = n === 1 ? (kind || 'rule') : `${n} rules`;
    confirmTitle.textContent = `Delete ${label}?`;
    confirmBody.textContent = n === 1
      ? 'This rule will be removed. You can undo for 8 seconds.'
      : `${n} rules will be removed. You can undo for 8 seconds.`;
    confirmOk.textContent = `Delete ${n === 1 ? 'rule' : n + ' rules'}`;
    confirmDlg.returnValue = '';
    confirmDlg.showModal();
    confirmDlg.addEventListener('close', function onClose() {
      confirmDlg.removeEventListener('close', onClose);
      if (confirmDlg.returnValue !== 'ok') return;
      const removed = [];
      const keep = [];
      for (const r of state.rules) (ids.includes(r.id) ? removed : keep).push(r);
      state.rules = keep;
      for (const id of ids) {
        state.selected.delete(id);
        const el = rowPool.get(id);
        if (el) { el.remove(); rowPool.delete(id); }
      }
      refreshInvalid(); reindex(); render(); updateCount(); updateBulkBar();
      saveRules();
      showToast(`${removed.length === 1 ? '1 rule' : removed.length + ' rules'} deleted`, {
        action: 'Undo',
        timeout: 8000,
        onAction: () => {
          state.rules = [...removed, ...state.rules];
          refreshInvalid(); reindex(); render(); updateCount();
          saveRules();
        },
      });
    }, { once: true });
  };

  const setBulkEnabled = (value) => {
    const ids = new Set(state.selected);
    let changed = 0;
    for (const r of state.rules) {
      if (ids.has(r.id) && !!r.enabled !== value) {
        r.enabled = value;
        changed++;
      }
    }
    if (!changed) return;
    reindex(); render();
    saveRules();
    showToast(`${changed} ${changed === 1 ? 'rule' : 'rules'} ${value ? 'enabled' : 'disabled'}`);
  };

  const duplicateSelected = () => {
    const selectedIds = [...state.selected];
    if (!selectedIds.length) return;
    const copies = [];
    for (const id of selectedIds) {
      const r = getRuleById(id);
      if (r) copies.push({ ...r, id: uid() });
    }
    state.rules = [...copies, ...state.rules];
    state.selected.clear();
    refreshInvalid(); reindex(); render(); updateCount(); updateBulkBar();
    saveRules();
    showToast(`${copies.length} ${copies.length === 1 ? 'rule' : 'rules'} duplicated`);
  };

  // Toasts
  const showToast = (msg, opts = {}) => {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    if (opts.action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = opts.action;
      b.addEventListener('click', () => {
        opts.onAction?.();
        t.remove();
      });
      t.appendChild(b);
    }
    toastStack.appendChild(t);
    setTimeout(() => t.remove(), opts.timeout ?? 3200);
  };

  // Search / filters
  let searchTimer = 0;
  searchInp.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filter.query = searchInp.value;
      reindex();
      viewport.scrollTop = 0;
      render();
      updateCount();
    }, 110);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== searchInp && !e.target.matches('input, textarea')) {
      e.preventDefault();
      searchInp.focus();
      searchInp.select();
    } else if (e.key === 'Escape' && document.activeElement === searchInp) {
      searchInp.value = '';
      searchInp.dispatchEvent(new Event('input'));
    }
  });

  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach((x) => x.classList.toggle('is-active', x === b));
      state.filter.status = b.dataset.status;
      reindex(); render(); updateCount();
    });
  });
  const regexFilterBtn = $('filter-regex');
  regexFilterBtn.addEventListener('click', () => {
    state.filter.regexOnly = !state.filter.regexOnly;
    regexFilterBtn.setAttribute('aria-pressed', state.filter.regexOnly ? 'true' : 'false');
    reindex(); render(); updateCount();
  });

  // Top-level buttons
  $('btn-add').addEventListener('click', addRule);
  $('bulk-clear').addEventListener('click', () => {
    state.selected.clear();
    for (const el of rowPool.values()) {
      el.classList.remove('is-selected');
      const c = el.querySelector('.row-check');
      if (c) c.checked = false;
    }
    updateBulkBar();
  });
  $('bulk-enable').addEventListener('click', () => setBulkEnabled(true));
  $('bulk-disable').addEventListener('click', () => setBulkEnabled(false));
  $('bulk-duplicate').addEventListener('click', duplicateSelected);
  $('bulk-delete').addEventListener('click', () => deleteRules([...state.selected], 'rule'));

  // Import / Export
  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ version: 1, rules: state.rules }, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chrome-replacer-rules-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
  $('btn-import').addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    importFile.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const incoming = Array.isArray(data) ? data : data.rules;
      if (!Array.isArray(incoming)) throw new Error('Invalid format: expected an array of rules.');
      const norm = incoming.map((r) => ({
        id: uid(),
        enabled: r.enabled !== false,
        find: String(r.find ?? ''),
        replace: String(r.replace ?? ''),
        isRegex: !!r.isRegex,
        wholeWord: !!r.wholeWord,
      }));
      state.rules = [...norm, ...state.rules];
      refreshInvalid(); reindex(); render(); updateCount();
      saveRules();
      showToast(`${norm.length} ${norm.length === 1 ? 'rule' : 'rules'} imported`);
    } catch (e) {
      showToast(`Import failed: ${e.message || e}`);
    }
  });

  // Virtualized scroll
  let rafPending = false;
  viewport.addEventListener('scroll', () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; render(); });
  }, { passive: true });
  window.addEventListener('resize', render);

  // Cross-tab / content-script changes
  if (hasStorage) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !changes.rules) return;
      const incoming = changes.rules.newValue || [];
      if (JSON.stringify(incoming) === JSON.stringify(state.rules)) return;
      state.rules = incoming;
      refreshInvalid(); reindex(); render(); updateCount();
    });
  }

  // Boot
  (async () => {
    state.rules = await loadRules();
    refreshInvalid();
    reindex();
    render();
    updateCount();
    updateBulkBar();
  })();
})();
