(() => {
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT',
    'CODE', 'PRE', 'KBD', 'SAMP', 'VAR'
  ]);

  let compiled = [];
  let applying = false;

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  const compile = (rules) => {
    const out = [];
    for (const r of rules || []) {
      if (!r?.enabled) continue;
      const find = r.find ?? '';
      if (!find) continue;
      try {
        let pattern;
        if (r.isRegex) {
          pattern = r.wholeWord ? `(?:\\b(?:${find})\\b)` : find;
        } else {
          const escaped = escapeRegex(find);
          pattern = r.wholeWord ? `\\b${escaped}\\b` : escaped;
        }
        const re = new RegExp(pattern, 'g');
        out.push({ re, replace: r.replace ?? '' });
      } catch {
        // invalid regex — skip silently; the options page surfaces parse errors
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
    for (const { re, replace } of compiled) {
      re.lastIndex = 0;
      next = next.replace(re, replace);
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
