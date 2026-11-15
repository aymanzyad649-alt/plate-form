/**
 * أداة صغيرة لتغيير باسورد أي حساب من التيرمنال.
 * الاستخدام:
 *   npm run passwd -- admin باسورد_جديد
 *
 * مفيدة لو نسيت باسورد المدير، أو عايز تعمل حساب مدير تاني بسرعة.
 */
const { db } = require('../src/db');
const { hashPassword } = require('../src/password');
const { normalizeUsername, passwordProblem } = require('../src/validators');

const username = normalizeUsername(process.argv[2]);
const password = String(process.argv[3] ?? '');

if (!username || !password) {
  console.error('الاستخدام: npm run passwd -- <اسم المستخدم> <الباسورد الجديد>');
  process.exit(1);
}

const problem = passwordProblem(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}

const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
if (!user) {
  console.error(`مفيش حساب بالاسم: ${username}`);
  process.exit(1);
}

db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?")
  .run(hashPassword(password), user.id);

// أي جلسة قديمة للحساب ده تتقفل
db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);

console.log(`✅ تم تغيير باسورد الحساب: ${user.username}`);
