const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/**
 * بيعمل عنصر DOM بأمان: النصوص بتتحط بـ textContent
 * عشان أي بيانات من المستخدمين متتحوّلش لـ HTML (حماية من XSS).
 */
function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;

    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else {
      node.setAttribute(key, value === true ? '' : value);
    }
  }

  for (const child of [].concat(children)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

function toast(message, type = 'success') {
  const box = $('#toasts');
  if (!box) return;

  const item = el('div', { class: `toast toast-${type}`, text: message });
  box.append(item);
  setTimeout(() => item.remove(), 4000);
}

function setBusy(button, busy, label) {
  if (!button) return;

  if (busy) {
    button.dataset.label = button.textContent;
    button.disabled = true;
    button.textContent = label || '…';
  } else {
    button.disabled = false;
    button.textContent = label || button.dataset.label || button.textContent;
  }
}

function formatDate(value) {
  if (!value) return '—';

  const text = String(value);
  const normalized = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return text;

  try {
    return date.toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return date.toLocaleDateString();
  }
}

function initials(name) {
  const first = String(name || '?').trim().charAt(0);
  return first || '؟';
}

/** بيحوّل حجم الملف لبشري: 1536 → "1.5 كيلوبايت" */
function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return `${size} بايت`;

  const units = ['كيلوبايت', 'ميجابايت', 'جيجابايت'];
  let value = size / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}

/** أي زر فيه data-close بيقفل الحوار اللي جواه */
function wireDialogs() {
  $$('dialog [data-close]').forEach((button) => {
    button.addEventListener('click', () => button.closest('dialog')?.close());
  });

  // الضغط على الخلفية الغامقة يقفل الحوار
  $$('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}
