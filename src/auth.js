const crypto = require('node:crypto');
const { db } = require('./db');

const COOKIE_NAME = 'sp_sid';
const SESSION_DAYS = 7;

function parseCookies(header = '') {
  const cookies = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  }
  return cookies;
}

// بنخزّن hash التوكن مش التوكن نفسه، عشان لو الداتابيز اتسرّبت محدش يستخدم الجلسات
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAtMs = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;

  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)')
    .run(hashToken(token), userId, expiresAtMs);

  return { token, expiresAtMs };
}

function destroySession(token) {
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashToken(token));
}

function destroyOtherSessions(userId, keepToken) {
  if (keepToken) {
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND id <> ?')
      .run(userId, hashToken(keepToken));
  } else {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  }
}

function cleanExpiredSessions() {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
}

function setSessionCookie(res, token, expiresAtMs) {
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${new Date(expiresAtMs).toUTCString()}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
  );
}

/**
 * بيتنفّذ على كل request: لو فيه كوكي جلسة صالح، بيحط بيانات المستخدم في req.user
 */
function attachUser(req, res, next) {
  req.user = null;
  req.sessionToken = null;

  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  if (!token) return next();

  const row = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.level_id
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > ? AND u.is_active = 1
  `).get(hashToken(token), Date.now());

  if (row) {
    req.user = {
      id: row.id,
      username: row.username,
      display_name: row.display_name,
      role: row.role,
      level_id: row.level_id,
    };
    req.sessionToken = token;
  }

  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'لازم تسجّل الدخول الأول' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'لازم تسجّل الدخول الأول' });
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'الصفحة دي لمدير المنصة بس' });
  }
  next();
}

module.exports = {
  COOKIE_NAME,
  hashToken,
  createSession,
  destroySession,
  destroyOtherSessions,
  cleanExpiredSessions,
  setSessionCookie,
  clearSessionCookie,
  attachUser,
  requireAuth,
  requireAdmin,
};
