const express = require('express');
const crypto = require('node:crypto');
const { db, getVersion, bumpVersion } = require('../db');
const { hashPassword, verifyPassword } = require('../password');
const {
  createSession,
  destroySession,
  destroyOtherSessions,
  setSessionCookie,
  clearSessionCookie,
  requireAuth,
} = require('../auth');
const {
  normalizeUsername,
  isValidUsername,
  cleanText,
  passwordProblem,
} = require('../validators');

const router = express.Router();

// باسورد وهمي عشان لو اليوزر مش موجود نضيّع نفس الوقت في التحقق (يمنع معرفة الأسماء المسجلة)
const DUMMY_HASH = hashPassword(crypto.randomBytes(12).toString('hex'));

const loginAttempts = new Map();
const MAX_ATTEMPTS = 6;
const LOCK_MS = 10 * 60 * 1000;

function lockRemainingMs(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return 0;
  if (Date.now() > entry.until) {
    loginAttempts.delete(key);
    return 0;
  }
  return entry.until - Date.now();
}

function registerFailure(key) {
  const entry = loginAttempts.get(key) || { count: 0, until: 0 };
  entry.count += 1;
  if (entry.count >= MAX_ATTEMPTS) {
    entry.until = Date.now() + LOCK_MS;
    entry.count = 0;
  }
  loginAttempts.set(key, entry);

  // تنظيف بسيط عشان الـ Map ميكبرش بلا حدود
  if (loginAttempts.size > 5000) {
    const now = Date.now();
    for (const [k, v] of loginAttempts) {
      if (v.until && v.until < now) loginAttempts.delete(k);
    }
  }
}

function findUserWithLevel(id) {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.level_id, u.is_active,
           u.password_hash, l.name AS level_name
    FROM users u
    LEFT JOIN levels l ON l.id = u.level_id
    WHERE u.id = ?
  `).get(id);
}

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    role: row.role,
    level_id: row.level_id ?? null,
    level_name: row.level_name ?? null,
  };
}

router.get('/data-version', (req, res) => {
  res.json({ version: getVersion() });
});

router.post('/login', (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const password = String(req.body?.password ?? '');
  const lockKey = `${req.ip}:${username}`;

  if (lockRemainingMs(lockKey) > 0) {
    return res.status(429).json({ error: 'محاولات دخول كتير غلط، جرّب تاني بعد شوية' });
  }

  if (!username || !password) {
    return res.status(400).json({ error: 'اكتب اسم المستخدم والباسورد' });
  }

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  const passwordOk = verifyPassword(password, row?.password_hash || DUMMY_HASH);

  if (!row || !passwordOk || !row.is_active) {
    registerFailure(lockKey);
    return res.status(401).json({ error: 'اسم المستخدم أو الباسورد غلط' });
  }

  loginAttempts.delete(lockKey);

  const { token, expiresAtMs } = createSession(row.id);
  setSessionCookie(res, token, expiresAtMs);

  res.json({ user: publicUser(findUserWithLevel(row.id)) });
});

router.post('/logout', (req, res) => {
  destroySession(req.sessionToken);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const row = findUserWithLevel(req.user.id);
  if (!row) {
    clearSessionCookie(res);
    return res.status(401).json({ error: 'الحساب مش موجود' });
  }
  res.json({ user: publicUser(row) });
});

/**
 * تعديل بيانات الحساب: الاسم الظاهر دائمًا، واسم المستخدم لو اتبعت
 * (تغيير اسم المستخدم بيتطلب الباسورد الحالي عشان محدش يغيّره من جهاز مفتوح).
 */
router.patch('/me', requireAuth, (req, res) => {
  const current = findUserWithLevel(req.user.id);
  if (!current) return res.status(404).json({ error: 'الحساب مش موجود' });

  const displayName = cleanText(req.body?.display_name, 60);
  const rawUsername = req.body?.username;
  const wantsUsernameChange =
    rawUsername !== undefined && normalizeUsername(rawUsername) !== current.username;

  if (!displayName || displayName.length < 2) {
    return res.status(400).json({ error: 'الاسم لازم يكون حرفين على الأقل' });
  }

  let username = current.username;

  if (wantsUsernameChange) {
    username = normalizeUsername(rawUsername);
    if (!isValidUsername(username)) {
      return res.status(400).json({
        error: 'اسم المستخدم لازم من 3 لـ 32 حرف (حروف/أرقام/ . _ -) ومن غير مسافات',
      });
    }

    const currentPassword = String(req.body?.currentPassword ?? '');
    if (!verifyPassword(currentPassword, current.password_hash)) {
      return res.status(400).json({ error: 'الباسورد الحالي غلط' });
    }
  }

  try {
    db.prepare(`
      UPDATE users
      SET display_name = ?, username = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(displayName, username, current.id);
  } catch (error) {
    if (/UNIQUE constraint failed/i.test(String(error?.message))) {
      return res.status(409).json({ error: 'اسم المستخدم ده متاخد بالفعل' });
    }
    throw error;
  }

  bumpVersion();
  res.json({ user: publicUser(findUserWithLevel(current.id)) });
});

router.post('/me/password', requireAuth, (req, res) => {
  const currentPassword = String(req.body?.currentPassword ?? '');
  const newPassword = String(req.body?.newPassword ?? '');

  const problem = passwordProblem(newPassword);
  if (problem) return res.status(400).json({ error: problem });

  const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
  if (!row || !verifyPassword(currentPassword, row.password_hash)) {
    return res.status(400).json({ error: 'الباسورد الحالي غلط' });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ error: 'الباسورد الجديد لازم يختلف عن القديم' });
  }

  db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
    .run(hashPassword(newPassword), req.user.id);

  // بنقفل أي جلسة تانية على أجهزة تانية، ونسيب الجلسة الحالية
  destroyOtherSessions(req.user.id, req.sessionToken);
  bumpVersion();

  res.json({ ok: true });
});

module.exports = router;
