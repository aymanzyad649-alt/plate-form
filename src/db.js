const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { hashPassword } = require('./password');

const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const dbFile = path.join(DATA_DIR, 'app.db');
const db = new DatabaseSync(dbFile);

// WAL بيخلي القراءة والكتابة ميعملوش زحمة على بعض، وforeign_keys عشان الحذف يتسلسل صح
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS levels (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      sort_order  INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      username      TEXT NOT NULL UNIQUE,
      display_name  TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('admin', 'student')),
      level_id      INTEGER REFERENCES levels(id) ON DELETE SET NULL,
      is_active     INTEGER NOT NULL DEFAULT 1,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS lessons (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      level_id   INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      content    TEXT NOT NULL DEFAULT '',
      video_url  TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- سجل إنجاز كل طالب لكل درس (صف واحد لكل طالب/درس)
    CREATE TABLE IF NOT EXISTS lesson_progress (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      lesson_id    INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (user_id, lesson_id)
    );

    -- مرفقات الدروس (محاضرات/ملفات PDF/صور/فيديو)
    CREATE TABLE IF NOT EXISTS lesson_files (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      lesson_id     INTEGER NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      stored_name   TEXT NOT NULL UNIQUE,
      mime_type     TEXT NOT NULL DEFAULT '',
      size          INTEGER NOT NULL DEFAULT 0,
      uploaded_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- التقييمات/الامتحانات التابعة لكل مستوى
    CREATE TABLE IF NOT EXISTS assessments (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      level_id   INTEGER NOT NULL REFERENCES levels(id) ON DELETE CASCADE,
      title      TEXT NOT NULL,
      max_score  REAL NOT NULL DEFAULT 100,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- درجة كل طالب في كل تقييم
    CREATE TABLE IF NOT EXISTS grades (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      assessment_id INTEGER NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      score         REAL NOT NULL,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (assessment_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id         TEXT PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_users_level   ON users(level_id);
    CREATE INDEX IF NOT EXISTS idx_lessons_level ON lessons(level_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_progress_user ON lesson_progress(user_id);
    CREATE INDEX IF NOT EXISTS idx_progress_lesson ON lesson_progress(lesson_id);
    CREATE INDEX IF NOT EXISTS idx_files_lesson ON lesson_files(lesson_id);
    CREATE INDEX IF NOT EXISTS idx_assessments_level ON assessments(level_id);
    CREATE INDEX IF NOT EXISTS idx_grades_user ON grades(user_id);
    CREATE INDEX IF NOT EXISTS idx_grades_assessment ON grades(assessment_id);
  `);

  db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('data_version', 1)").run();
}

/**
 * أول تشغيل بس: بنعمل حساب مدير + مستويين تجريبيين + طالب تجريبي
 * عشان تقدر تدخل وتشوف المنصة شغالة من أول ثانية.
 */
function seed() {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get();
  if (count > 0) return;

  const admin = db.prepare(
    "INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, 'admin')"
  );
  admin.run('admin', 'مدير المنصة', hashPassword('admin123'));

  const insertLevel = db.prepare(
    'INSERT INTO levels (name, description, sort_order) VALUES (?, ?, ?)'
  );
  const level1 = insertLevel.run('المستوى الأول', 'أساسيات المادة وأول خطوة في الرحلة.', 1);
  const level2 = insertLevel.run('المستوى الثاني', 'بناء على الأساسيات مع تمارين وتطبيقات.', 2);

  const insertLesson = db.prepare(
    'INSERT INTO lessons (level_id, title, content, video_url, sort_order) VALUES (?, ?, ?, ?, ?)'
  );
  const l1 = Number(level1.lastInsertRowid);
  const l2 = Number(level2.lastInsertRowid);

  insertLesson.run(l1, 'الدرس الأول: مقدمة', 'شرح مبسط لمحتوى الدرس الأول. تقدر تعدّل النص ده من لوحة المدير.', '', 1);
  insertLesson.run(l1, 'الدرس الثاني: تطبيق عملي', 'تمارين على الدرس الأول مع أمثلة محلولة.', '', 2);
  insertLesson.run(l2, 'الدرس الأول: مراجعة سريعة', 'مراجعة لما سبق قبل الدخول في الجديد.', '', 1);

  db.prepare(
    "INSERT INTO users (username, display_name, password_hash, role, level_id) VALUES (?, ?, ?, 'student', ?)"
  ).run('student1', 'طالب تجريبي', hashPassword('123456'), l1);

  bumpVersion();
}

function getVersion() {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'data_version'").get();
  return row ? Number(row.value) : 1;
}

/**
 * بنزوّد الرقم ده مع أي تعديل، والفرونت إند بيقارنه عشان يمسح الكاش القديم.
 */
function bumpVersion() {
  db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'data_version'").run();
  return getVersion();
}

migrate();
seed();

module.exports = { db, getVersion, bumpVersion };
