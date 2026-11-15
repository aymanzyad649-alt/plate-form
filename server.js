const path = require('node:path');
const express = require('express');

const { getVersion } = require('./src/db');
const { attachUser, cleanExpiredSessions } = require('./src/auth');
const authRoutes = require('./src/routes/auth');
const studentRoutes = require('./src/routes/student');
const adminRoutes = require('./src/routes/admin');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

/**
 * أي طلب بيغيّر بيانات لازم يكون جاي من نفس الموقع
 * (طبقة بسيطة ضد CSRF مع الـ SameSite cookie).
 */
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();

  const origin = req.headers.origin;
  if (!origin) return next();

  try {
    if (new URL(origin).host !== req.headers.host) {
      return res.status(403).json({ error: 'الطلب ده غير مسموح' });
    }
  } catch {
    return res.status(403).json({ error: 'الطلب ده غير مسموح' });
  }

  next();
});

app.use(attachUser);

app.get('/health', (req, res) => res.json({ ok: true, version: getVersion() }));

app.use('/api', authRoutes);
app.use('/api', studentRoutes);
app.use('/api/admin', adminRoutes);

app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

// أي مسار API مش معرّف يرجع JSON مش صفحة HTML
app.use('/api', (req, res) => res.status(404).json({ error: 'المسار ده مش موجود' }));

app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(err.status || 500).json({ error: 'حصل خطأ في السيرفر، جرّب تاني' });
});

// تنظيف الجلسات المنتهية كل ساعة
setInterval(cleanExpiredSessions, 60 * 60 * 1000).unref();
cleanExpiredSessions();

const server = app.listen(PORT, () => {
  console.log(`✅ المنصة شغالة على: http://localhost:${PORT}`);
});

module.exports = server;
