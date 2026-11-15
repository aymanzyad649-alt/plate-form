/**
 * طبقة الكاش في المتصفح (localStorage).
 * - كل الصفحات بتقرأ منها لو الشبكة وقعت.
 * - السيرفر بيبعت "رقم إصدار" للبيانات، ولو اتغيّر بنمسح الكاش القديم كله.
 */
const Cache = (() => {
  const PREFIX = 'sp:cache:v1:';
  const VERSION_KEY = `${PREFIX}version`;
  const DEFAULT_TTL = 5 * 60 * 1000; // 5 دقايق

  function read(key, ttl = DEFAULT_TTL) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      if (!raw) return null;

      const entry = JSON.parse(raw);
      if (!entry || typeof entry.at !== 'number') return null;

      if (Date.now() - entry.at > ttl) {
        localStorage.removeItem(PREFIX + key);
        return null;
      }

      return entry.data;
    } catch {
      return null;
    }
  }

  function write(key, data) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), data }));
    } catch {
      // ممكن يكون التخزين ممتلئ أو المتصفح مانع — مش مشكلة، هنكمل من السيرفر
    }
  }

  function remove(key) {
    try {
      localStorage.removeItem(PREFIX + key);
    } catch {
      /* تجاهل */
    }
  }

  function clear() {
    try {
      Object.keys(localStorage)
        .filter((key) => key.startsWith(PREFIX) && key !== VERSION_KEY)
        .forEach((key) => localStorage.removeItem(key));
    } catch {
      /* تجاهل */
    }
  }

  async function syncVersion() {
    try {
      const response = await fetch('/api/data-version', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) return false;

      const { version } = await response.json();
      const stored = Number(localStorage.getItem(VERSION_KEY) || 0);

      if (stored !== Number(version)) {
        clear();
        localStorage.setItem(VERSION_KEY, String(version));
        return true;
      }
      return false;
    } catch {
      // أوفلاين: نكمل بالكاش اللي عندنا
      return false;
    }
  }

  return { read, write, remove, clear, syncVersion };
})();
