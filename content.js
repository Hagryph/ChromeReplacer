(() => {
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT',
    'CODE', 'PRE', 'KBD', 'SAMP', 'VAR'
  ]);

  let compiled = [];
  const justWritten = new WeakSet();

  // Only apply replacements while this tab is the foreground (visible) tab.
  // Keeps background tabs from churning DOM mid-edit elsewhere. When the tab
  // becomes visible again, we run a full catch-up walk so anything that
  // appeared while hidden still gets processed.
  const isActive = () => document.visibilityState === 'visible';
  let missedWhileHidden = false;

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const splitWordPunct = (s) => {
    const out = [];
    let i = 0;
    while (i < s.length) {
      const isWord = /\w/.test(s[i]);
      let j = i;
      while (j < s.length && /\w/.test(s[j]) === isWord) j++;
      out.push({ type: isWord ? 'word' : 'punct', text: s.slice(i, j) });
      i = j;
    }
    return out;
  };

  // For loose-punct literal rules: build a regex that captures every
  // punctuation run as its own group, plus a replacement template that
  // re-injects those captures so the original separators are preserved.
  const buildLoosePair = (find, replace) => {
    const fSegs = splitWordPunct(find);
    let pattern = '';
    let groups = 0;
    for (const seg of fSegs) {
      if (seg.type === 'word') {
        pattern += seg.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      } else {
        pattern += '(\\W*)';
        groups++;
      }
    }
    const rSegs = splitWordPunct(replace);
    let template = '';
    let punctIdx = 0;
    for (const seg of rSegs) {
      if (seg.type === 'word') {
        template += seg.text.replace(/\$/g, '$$$$');
      } else {
        punctIdx++;
        template += punctIdx <= groups
          ? '$' + punctIdx
          : seg.text.replace(/\$/g, '$$$$');
      }
    }
    return { pattern, template };
  };

  const parseMap = (text) => {
    const map = Object.create(null);
    let fallback;
    for (const raw of (text || '').split('\n')) {
      const line = raw.replace(/^\s+|\s+$/g, '');
      if (!line || line[0] === '#') continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const k = line.slice(0, eq).trim();
      const v = line.slice(eq + 1);
      if (k === '*') fallback = v;
      else map[k] = v;
    }
    return { map, fallback };
  };

  const applyBackrefs = (tmpl, args) =>
    tmpl.replace(/\$(\d|&)/g, (_, n) => (n === '&' ? args[0] : (args[+n] ?? '')));

  const compile = (rules) => {
    const out = [];
    for (const r of rules || []) {
      if (!r?.enabled) continue;
      const find = r.find ?? '';
      if (!find) continue;
      try {
        const asRegex = r.isRegex || r.isMap;
        let pattern;
        let template;
        if (asRegex) {
          pattern = r.wholeWord ? `(?:\\b(?:${find})\\b)` : find;
          template = r.replace ?? '';
        } else if (r.loosePunct) {
          // Loose mode + $N backrefs is a footgun: $1 followed by user's
          // literal "1" becomes $11 which V8 misreads. Refuse to compile
          // and let validation surface the red-accent tooltip.
          if (/\$\d/.test(r.replace ?? '')) continue;
          const built = buildLoosePair(find, r.replace ?? '');
          pattern = r.wholeWord ? `\\b(?:${built.pattern})\\b` : built.pattern;
          template = built.template;
        } else {
          const escaped = escapeRegex(find);
          pattern = r.wholeWord ? `\\b${escaped}\\b` : escaped;
          template = r.replace ?? '';
        }
        const re = new RegExp(pattern, r.caseInsensitive ? 'gi' : 'g');
        if (r.isMap) {
          const { map, fallback } = parseMap(r.replace);
          out.push({ re, isMap: true, map, fallback });
        } else {
          out.push({ re, isMap: false, replace: template });
        }
      } catch {
        // invalid regex — skip silently; options page surfaces parse errors
      }
    }
    return out;
  };

  const shouldSkip = (node) => {
    let el = node.parentElement;
    while (el) {
      if (SKIP_TAGS.has(el.tagName)) return true;
      if (el.isContentEditable) return true;
      el = el.parentElement;
    }
    return false;
  };

  const applyToTextNode = (node) => {
    const original = node.nodeValue;
    if (!original) return;
    let next = original;
    for (const rule of compiled) {
      rule.re.lastIndex = 0;
      if (rule.isMap) {
        next = next.replace(rule.re, (...args) => {
          const key = args[1];
          if (key !== undefined && Object.prototype.hasOwnProperty.call(rule.map, key)) {
            return applyBackrefs(rule.map[key], args);
          }
          if (rule.fallback !== undefined) return applyBackrefs(rule.fallback, args);
          return args[0];
        });
      } else {
        next = next.replace(rule.re, rule.replace);
      }
    }
    if (next !== original) {
      justWritten.add(node);
      node.nodeValue = next;
    }
  };

  const walk = (root) => {
    if (!compiled.length) return;
    if (!isActive()) { missedWhileHidden = true; return; }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (shouldSkip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const batch = [];
    let cur;
    while ((cur = walker.nextNode())) batch.push(cur);
    for (const n of batch) applyToTextNode(n);
  };

  const observer = new MutationObserver((records) => {
    if (!compiled.length) return;
    if (!isActive()) { missedWhileHidden = true; return; }
    for (const rec of records) {
      if (rec.type === 'characterData') {
        const t = rec.target;
        if (justWritten.has(t)) { justWritten.delete(t); continue; }
        if (t.nodeType === Node.TEXT_NODE && !shouldSkip(t)) applyToTextNode(t);
        continue;
      }
      for (const node of rec.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          if (!shouldSkip(node)) applyToTextNode(node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          walk(node);
        }
      }
    }
  });

  const start = async () => {
    const { rules = [] } = await chrome.storage.local.get('rules');
    compiled = compile(rules);
    if (compiled.length) walk(document.body || document.documentElement);
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };

  // Catch up when the tab returns to the foreground.
  document.addEventListener('visibilitychange', () => {
    if (!isActive() || !missedWhileHidden || !compiled.length) return;
    missedWhileHidden = false;
    walk(document.body || document.documentElement);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.rules) return;
    compiled = compile(changes.rules.newValue || []);
    if (compiled.length) walk(document.body || document.documentElement);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
