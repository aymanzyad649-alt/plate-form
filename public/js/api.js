/**
 * غلاف بسيط حوالين fetch:
 * - بيبعت JSON ويرجّع JSON.
 * - لو الطلب GET وفشل بسبب الشبكة، بيرجع آخر نسخة من الكاش.
 * - لو السيرفر رجّع 401، بيحوّل المستخدم لصفحة الدخول.
 */
async function api(path, options = {}) {
  const { method = 'GET', body, cacheKey, ttl } = options;

  const init = {
    method,
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
  };

  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(path, init);
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (response.status === 401 && !String(path).startsWith('/api/login')) {
        window.location.href = '/';
      }

      const error = new Error(data.error || 'حصل خطأ، جرّب تاني');
      error.status = response.status;
      throw error;
    }

    if (cacheKey) Cache.write(cacheKey, data);
    return data;
  } catch (error) {
    if (error.status) throw error; // خطأ جاي من السيرفر، مش الشبكة

    if (method === 'GET' && cacheKey) {
      const cached = Cache.read(cacheKey, ttl);
      if (cached) return cached;
    }

    throw new Error('مش قادر أوصل للسيرفر. اتأكد إن المنصة شغالة وجرب تاني.');
  }
}

/**
 * رفع ملف (multipart/form-data).
 * منستخدمش Content-Type يدويًا — المتصفح بيحط الـ boundary بنفسه.
 */
async function apiUpload(path, file) {
  const form = new FormData();
  form.append('file', file);

  const response = await fetch(path, {
    method: 'POST',
    body: form,
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) window.location.href = '/';

    const error = new Error(data.error || 'مش قادر أرفع الملف');
    error.status = response.status;
    throw error;
  }

  return data;
}
