(() => {
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT',
    'CODE', 'PRE', 'KBD', 'SAMP', 'VAR'
  ]);

  let compiled = [];
  let applying = false;

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
        if (asRegex) {
          pattern = r.wholeWord ? `(?:\\b(?:${find})\\b)` : find;
        } else {
          const escaped = escapeRegex(find);
          pattern = r.wholeWord ? `\\b${escaped}\\b` : escaped;
        }
        const re = new RegExp(pattern, r.caseInsensitive ? 'gi' : 'g');
        if (r.isMap) {
          const { map, fallback } = parseMap(r.replace);
          out.push({ re, isMap: true, map, fallback });
        } else {
          out.push({ re, isMap: false, replace: r.replace ?? '' });
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
    if (next !== original) node.nodeValue = next;
  };

  const walk = (root) => {
    if (!compiled.length) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (shouldSkip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
    });
    const batch = [];
    let cur;
    while ((cur = walker.nextNode())) batch.push(cur);
    applying = true;
    try { for (const n of batch) applyToTextNode(n); }
    finally { applying = false; }
  };

  const observer = new MutationObserver((records) => {
    if (applying || !compiled.length) return;
    applying = true;
    try {
      for (const rec of records) {
        for (const node of rec.addedNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            if (!shouldSkip(node)) applyToTextNode(node);
          } else if (node.nodeType === Node.ELEMENT_NODE) {
            walk(node);
          }
        }
      }
    } finally { applying = false; }
  });

  const start = async () => {
    const { rules = [] } = await chrome.storage.local.get('rules');
    compiled = compile(rules);
    if (compiled.length) walk(document.body || document.documentElement);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  };

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
