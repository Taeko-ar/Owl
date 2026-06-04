export function escapeHtml(s: string) {
  return s.replace(
    /[&<>"]/g,
    (c) =>
      (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }) as Record<string, string>)[c]
  );
}

declare const DOMPurify: { sanitize: (html: string, config?: object) => string } | undefined;

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  const purify =
    typeof DOMPurify !== 'undefined'
      ? DOMPurify
      : {
          sanitize: (h: string) => {
            const doc = new DOMParser().parseFromString(h, 'text/html');
            doc.querySelectorAll('script').forEach((n) => n.remove());
            doc.querySelectorAll('*').forEach((node) => {
              Array.from(node.attributes).forEach((attr) => {
                if (attr.name.startsWith('on')) node.removeAttribute(attr.name);
              });
            });
            return doc.body.innerHTML;
          },
        };
  return purify.sanitize(html, {
    ALLOWED_TAGS: [
      'p',
      'br',
      'b',
      'strong',
      'em',
      'i',
      'u',
      's',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'ul',
      'ol',
      'li',
      'code',
      'pre',
      'blockquote',
      'a',
      'img',
      'hr',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
      'span',
    ],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'class', 'title', 'target', 'rel', 'width', 'height'],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'base', 'link', 'meta', 'form'],
    FORBID_ATTR: ['onerror', 'onload', 'onclick'],
  });
}

export function formatWithColorCodes(s: string) {
  if (!s) return '';
  let out = '';
  let i = 0;
  const len = s.length;
  const stack: string[] = [];

  while (i < len) {
    if (s[i] === '|' && (s[i + 1] === 'c' || s[i + 1] === 'C')) {
      const rest = s.substring(i + 2);
      const m = rest.match(/^([0-9A-Fa-f]{6,8})/);
      if (m) {
        const col = m[1];
        const hex = col.length === 8 ? col.slice(-6) : col;
        out += `<span style="color:#${hex}">`;
        stack.push('</span>');
        i += 2 + m[1].length;
        continue;
      }
    }
    if (s[i] === '|' && (s[i + 1] === 'r' || s[i + 1] === 'R')) {
      if (stack.length) out += stack.pop();
      i += 2;
      continue;
    }
    out += escapeHtml(s[i]);
    i += 1;
  }

  while (stack.length) out += stack.pop();
  return out;
}

export function renderMarkdown(md: string, addonPath?: string) {
  if (!md) return '';

  const escape = escapeHtml;

  function resolveImageSrc(url: string, base?: string) {
    if (/^https?:\/\//i.test(url)) return url;
    if (/^(data:|file:|\/\/)/i.test(url)) return '#';
    if (!base) return url;
    let baseNorm = base.replace(/\\/g, '/');
    if (!baseNorm.endsWith('/')) baseNorm += '/';
    const rel = url.replace(/^\.\//, '');
    const joined = baseNorm + rel;
    return encodeURI('file:///' + joined);
  }

  let s = md.replace(/```([\s\S]*?)```/g, (_m, code) => `<pre><code>${escape(code)}</code></pre>`);
  s = s.replace(/`([^`]+)`/g, (_m, code) => `<code>${escape(code)}</code>`);
  s = s.replace(/^######\s*(.*)$/gm, (_m, t) => `<h6>${escape(t)}</h6>`);
  s = s.replace(/^#####\s*(.*)$/gm, (_m, t) => `<h5>${escape(t)}</h5>`);
  s = s.replace(/^####\s*(.*)$/gm, (_m, t) => `<h4>${escape(t)}</h4>`);
  s = s.replace(/^###\s*(.*)$/gm, (_m, t) => `<h3>${escape(t)}</h3>`);
  s = s.replace(/^##\s*(.*)$/gm, (_m, t) => `<h2>${escape(t)}</h2>`);
  s = s.replace(/^#\s*(.*)$/gm, (_m, t) => `<h1>${escape(t)}</h1>`);
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(.+?)__/g, '<strong>$1</strong>');
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
  s = s.replace(/_(.+?)_/g, '<em>$1</em>');
  s = s.replace(
    /!\[([^\]]*)\]\(([^)]+)\)/g,
    (_m, alt, url) =>
      `<img src="${resolveImageSrc(url, addonPath)}" alt="${escape(alt)}" class="max-w-full rounded my-2" />`
  );
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text, url) => {
    const safe = /^https?:\/\//i.test(url.trim()) ? url.trim() : '#';
    return `<a href="${safe}" target="_blank" rel="noreferrer noopener">${escape(text)}</a>`;
  });

  const parts = s.split(/\n{2,}/).map((p) => p.replace(/\n/g, '<br>'));
  const html = parts.map((p) => `<p>${p}</p>`).join('');

  return sanitizeHtml(html);
}

export function debounce<T extends (...args: never[]) => unknown>(fn: T, wait = 700) {
  let t: number | undefined;
  return (...args: Parameters<T>) => {
    if (t) window.clearTimeout(t);
    t = window.setTimeout(() => fn(...args), wait) as unknown as number;
  };
}

export function showToast(msg: string, timeout = 1800) {
  const id = `toast-${Date.now()}`;
  const d = document.createElement('div');
  d.id = id;
  d.className =
    'toast fixed top-4 left-4 z-50 rounded bg-slate-700 text-slate-100 px-3 py-2 shadow';
  d.textContent = msg;
  document.body.appendChild(d);
  setTimeout(() => {
    d.style.opacity = '0';
    setTimeout(() => d.remove(), 300);
  }, timeout);
}

export function setLoadingState(
  label: string,
  progress: number,
  statusFooter?: HTMLElement | null,
  activityProgress?: HTMLElement | null
) {
  if (statusFooter) statusFooter.textContent = label;
  if (activityProgress) activityProgress.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

export function clearLoadingState(
  statusFooter?: HTMLElement | null,
  activityProgress?: HTMLElement | null
) {
  if (statusFooter) statusFooter.textContent = 'Ready';
  if (activityProgress) activityProgress.style.width = '0%';
}

export function showTextInputModal(options: {
  title: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  submitText?: string;
  cancelText?: string;
}) {
  return new Promise<string | null>((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4';
    overlay.innerHTML = `
      <div class="w-full max-w-md rounded-lg bg-slate-900 border border-slate-700 p-6 shadow-lg">
        <div class="flex items-center justify-between mb-4">
          <div>
            <h3 class="text-lg font-semibold text-slate-100">${escapeHtml(options.title)}</h3>
          </div>
          <button type="button" id="modalCloseBtn" class="text-slate-400 hover:text-slate-200">✕</button>
        </div>
        <label class="text-sm text-slate-300 mb-2 block">${escapeHtml(options.label)}</label>
        <input id="modalInput" type="text" value="${escapeHtml(options.initialValue || '')}" placeholder="${escapeHtml(options.placeholder || '')}" class="w-full rounded bg-slate-800 border border-slate-700 px-3 py-2 text-sm text-slate-100 outline-none focus:border-slate-500" />
        <div class="mt-4 flex justify-end gap-2">
          <button type="button" id="modalCancelBtn2" class="rounded bg-slate-800 px-4 py-2 text-sm text-slate-200 hover:bg-slate-700">${escapeHtml(options.cancelText || 'Cancel')}</button>
          <button type="button" id="modalSubmitBtn" class="rounded bg-slate-700 px-4 py-2 text-sm text-white hover:bg-slate-600">${escapeHtml(options.submitText || 'Submit')}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    const input = overlay.querySelector('#modalInput') as HTMLInputElement;
    const submitBtn = overlay.querySelector('#modalSubmitBtn') as HTMLButtonElement;
    const cancelBtns = overlay.querySelectorAll('#modalCloseBtn, #modalCancelBtn2');

    const close = () => {
      overlay.remove();
      resolve(null);
    };

    cancelBtns.forEach((btn) => btn.addEventListener('click', close));
    submitBtn.addEventListener('click', () => {
      const value = input.value.trim();
      if (!value) return;
      overlay.remove();
      resolve(value);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitBtn.click();
      }
    });
    input.focus();
  });
}
export function parsePatchFilename(patch: string) {
  const lastDot = patch.lastIndexOf('.');
  const stem = lastDot !== -1 ? patch.substring(0, lastDot) : patch;
  const ext = lastDot !== -1 ? patch.substring(lastDot) : '';
  const enabled = !stem.endsWith('-disabled');
  const baseStem = stem.endsWith('-disabled') ? stem.slice(0, -9) : stem;
  const displayName = ext ? `${baseStem}${ext}` : baseStem;
  return { enabled, displayName };
}
