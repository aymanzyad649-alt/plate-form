const express = require('express');
const { db, bumpVersion } = require('../db');
const { hashPassword } = require('../password');
const { requireAdmin, destroyOtherSessions } = require('../auth');
const {
  normalizeUsername,
  isValidUsername,
  cleanText,
  passwordProblem,
  toId,
  isUniqueViolation,
} = require('../validators');
const { upload, safeOriginalName, removeStoredFile } = require('../uploads');

const router = express.Router();

// كل المسارات هنا للمدير بس
router.use(requireAdmin);

function levelExists(id) {
  return Boolean(db.prepare('SELECT 1 AS ok FROM levels WHERE id = ?').get(id));
}

function sortOrder(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(Math.max(Math.trunc(number), 0), 9999);
}

function getStudent(id) {
  return db.prepare(`
    SELECT u.id, u.username, u.display_name, u.role, u.level_id, u.is_active,
           u.created_at, l.name AS level_name
    FROM users u
    LEFT JOIN levels l ON l.id = u.level_id
    WHERE u.id = ? AND u.role = 'student'
  `).get(id);
}

/* ------------------------------- الطلاب ------------------------------- */

router.get('/students', (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.username, u.display_name, u.level_id, u.is_active, u.created_at,
           l.name AS level_name,
           (SELECT COUNT(*) FROM lessons WHERE level_id = u.level_id) AS lessons_count,
           (SELECT COUNT(*)
              FROM lesson_progress lp
              JOIN lessons l2 ON l2.id = lp.lesson_id
             WHERE lp.user_id = u.id AND l2.level_id = u.level_id) AS completed_count
    FROM users u
    LEFT JOIN levels l ON l.id = u.level_id
    WHERE u.role = 'student'
    ORDER BY u.created_at DESC, u.id DESC
  `).all();

  const students = rows.map((student) => {
    const lessonsCount = Number(student.lessons_count);
    const completedCount = Number(student.completed_count);

    return {
      ...student,
      lessons_count: lessonsCount,
      completed_count: completedCount,
      progress_percent: lessonsCount
        ? Math.round((completedCount / lessonsCount) * 100)
        : 0,
    };
  });

  res.json({ students });
});

router.post('/students', (req, res) => {
  const username = normalizeUsername(req.body?.username);
  const displayName = cleanText(req.body?.display_name, 60);
  const password = String(req.body?.password ?? '');
  const levelId = req.body?.level_id ? toId(req.body.level_id) : null;

  if (!isValidUsername(username)) {
    return res.status(400).json({
      error: 'اسم المستخدم لازم من 3 لـ 32 حرف (حروف/أرقام/ . _ -) ومن غير مسافات',
    });
  }
  if (!displayName || displayName.length < 2) {
    return res.status(400).json({ error: 'اكتب اسم الطالب (حرفين على الأقل)' });
  }
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ error: problem });
  if (req.body?.level_id && !levelId) {
    return res.status(400).json({ error: 'المستوى المختار مش صحيح' });
  }
  if (levelId && !levelExists(levelId)) {
    return res.status(400).json({ error: 'المستوى المختار مش موجود' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO users (username, display_name, password_hash, role, level_id)
      VALUES (?, ?, ?, 'student', ?)
    `).run(username, displayName, hashPassword(password), levelId);

    bumpVersion();
    res.status(201).json({ student: getStudent(Number(result.lastInsertRowid)) });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'اسم المستخدم ده متاخد بالفعل' });
    }
    throw error;
  }
});

router.patch('/students/:id', (req, res) => {
  const id = toId(req.params.id);
  const student = id ? getStudent(id) : null;
  if (!student) return res.status(404).json({ error: 'الطالب مش موجود' });

  const displayName = cleanText(req.body?.display_name, 60);
  if (!displayName || displayName.length < 2) {
    return res.status(400).json({ error: 'اكتب اسم الطالب (حرفين على الأقل)' });
  }

  let username = student.username;
  if (req.body?.username !== undefined) {
    username = normalizeUsername(req.body.username);
    if (!isValidUsername(username)) {
      return res.status(400).json({
        error: 'اسم المستخدم لازم من 3 لـ 32 حرف (حروف/أرقام/ . _ -) ومن غير مسافات',
      });
    }
  }

  // الباسورد اختياري في التعديل: لو فاضي يبقى مش هنغيّره
  let passwordHash = null;
  const rawPassword = String(req.body?.password ?? '');
  if (rawPassword.length > 0) {
    const problem = passwordProblem(rawPassword);
    if (problem) return res.status(400).json({ error: problem });
    passwordHash = hashPassword(rawPassword);
  }

  let levelId = student.level_id;
  if (req.body?.level_id !== undefined) {
    if (req.body.level_id === null || req.body.level_id === '') {
      levelId = null;
    } else {
      levelId = toId(req.body.level_id);
      if (!levelId || !levelExists(levelId)) {
        return res.status(400).json({ error: 'المستوى المختار مش موجود' });
      }
    }
  }

  let isActive = student.is_active;
  if (req.body?.is_active !== undefined) {
    isActive = req.body.is_active ? 1 : 0;
  }

  // لو مش هنغيّر الباسورد، بنحتفظ بالـ hash القديم
  const currentHash = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(id).password_hash;

  try {
    db.prepare(`
      UPDATE users
      SET username = ?, display_name = ?, password_hash = ?, level_id = ?, is_active = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(username, displayName, passwordHash ?? currentHash, levelId, isActive, id);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'اسم المستخدم ده متاخد بالفعل' });
    }
    throw error;
  }

  // لو المدير غيّر الباسورد أو وقّف الحساب، نقفل جلسات الطالب
  if (passwordHash || !isActive) destroyOtherSessions(id);

  bumpVersion();
  res.json({ student: getStudent(id) });
});

router.delete('/students/:id', (req, res) => {
  const id = toId(req.params.id);
  const student = id ? getStudent(id) : null;
  if (!student) return res.status(404).json({ error: 'الطالب مش موجود' });

  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  bumpVersion();
  res.json({ ok: true });
});

/* ------------------------------ المستويات ------------------------------ */

router.get('/levels', (req, res) => {
  const levels = db.prepare(`
    SELECT l.*, (SELECT COUNT(*) FROM users WHERE role = 'student' AND level_id = l.id) AS students_count
    FROM levels l
    ORDER BY l.sort_order, l.id
  `).all();

  const lessons = db.prepare(`
    SELECT id, level_id, title, content, video_url, sort_order
    FROM lessons
    ORDER BY level_id, sort_order, id
  `).all();

  const byLevel = new Map();
  for (const lesson of lessons) {
    if (!byLevel.has(lesson.level_id)) byLevel.set(lesson.level_id, []);
    byLevel.get(lesson.level_id).push(lesson);
  }

  const files = db.prepare(`
    SELECT id, lesson_id, original_name, mime_type, size, uploaded_at
    FROM lesson_files
    ORDER BY uploaded_at, id
  `).all();

  const filesByLesson = new Map();
  for (const file of files) {
    if (!filesByLesson.has(file.lesson_id)) filesByLesson.set(file.lesson_id, []);
    filesByLesson.get(file.lesson_id).push(file);
  }

  const assessments = db.prepare(`
    SELECT id, level_id, title, max_score, sort_order
    FROM assessments
    ORDER BY level_id, sort_order, id
  `).all();

  const assessmentsByLevel = new Map();
  for (const assessment of assessments) {
    if (!assessmentsByLevel.has(assessment.level_id)) {
      assessmentsByLevel.set(assessment.level_id, []);
    }
    assessmentsByLevel.get(assessment.level_id).push(assessment);
  }

  res.json({
    levels: levels.map((level) => ({
      ...level,
      lessons: (byLevel.get(level.id) || []).map((lesson) => ({
        ...lesson,
        files: filesByLesson.get(lesson.id) || [],
      })),
      assessments: assessmentsByLevel.get(level.id) || [],
    })),
  });
});

router.post('/levels', (req, res) => {
  const name = cleanText(req.body?.name, 80);
  const description = cleanText(req.body?.description, 500);

  if (!name) return res.status(400).json({ error: 'اكتب اسم المستوى' });

  try {
    const result = db.prepare(
      'INSERT INTO levels (name, description, sort_order) VALUES (?, ?, ?)'
    ).run(name, description, sortOrder(req.body?.sort_order));

    bumpVersion();
    res.status(201).json({
      level: db.prepare('SELECT * FROM levels WHERE id = ?').get(Number(result.lastInsertRowid)),
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'فيه مستوى بنفس الاسم بالفعل' });
    }
    throw error;
  }
});

router.patch('/levels/:id', (req, res) => {
  const id = toId(req.params.id);
  const level = id ? db.prepare('SELECT * FROM levels WHERE id = ?').get(id) : null;
  if (!level) return res.status(404).json({ error: 'المستوى مش موجود' });

  const name = req.body?.name !== undefined ? cleanText(req.body.name, 80) : level.name;
  const description =
    req.body?.description !== undefined ? cleanText(req.body.description, 500) : level.description;
  const order = req.body?.sort_order !== undefined ? sortOrder(req.body.sort_order) : level.sort_order;

  if (!name) return res.status(400).json({ error: 'اكتب اسم المستوى' });

  try {
    db.prepare(`
      UPDATE levels
      SET name = ?, description = ?, sort_order = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(name, description, order, id);
  } catch (error) {
    if (isUniqueViolation(error)) {
      return res.status(409).json({ error: 'فيه مستوى بنفس الاسم بالفعل' });
    }
    throw error;
  }

  bumpVersion();
  res.json({ level: db.prepare('SELECT * FROM levels WHERE id = ?').get(id) });
});

router.delete('/levels/:id', (req, res) => {
  const id = toId(req.params.id);
  const level = id ? db.prepare('SELECT * FROM levels WHERE id = ?').get(id) : null;
  if (!level) return res.status(404).json({ error: 'المستوى مش موجود' });

  // بنجمع أسماء ملفات الدروس قبل الحذف عشان نمسحها من القرص بعد حذف الصفوف
  const storedNames = db.prepare(`
    SELECT f.stored_name
    FROM lesson_files f
    JOIN lessons l ON l.id = f.lesson_id
    WHERE l.level_id = ?
  `).all(id);

  // الدروس بتتمسح معاه (CASCADE)، والطلاب بيرجعوا من غير مستوى (SET NULL)
  db.prepare('DELETE FROM levels WHERE id = ?').run(id);

  for (const row of storedNames) removeStoredFile(row.stored_name);

  bumpVersion();
  res.json({ ok: true });
});

/* -------------------------------- الدروس ------------------------------- */

router.post('/lessons', (req, res) => {
  const levelId = toId(req.body?.level_id);
  const title = cleanText(req.body?.title, 120);
  const content = cleanText(req.body?.content, 20000);
  const videoUrl = cleanText(req.body?.video_url, 500);

  if (!levelId || !levelExists(levelId)) {
    return res.status(400).json({ error: 'اختار مستوى صحيح' });
  }
  if (!title) return res.status(400).json({ error: 'اكتب عنوان الدرس' });

  const result = db.prepare(`
    INSERT INTO lessons (level_id, title, content, video_url, sort_order)
    VALUES (?, ?, ?, ?, ?)
  `).run(levelId, title, content, videoUrl, sortOrder(req.body?.sort_order));

  bumpVersion();
  res.status(201).json({
    lesson: db.prepare('SELECT * FROM lessons WHERE id = ?').get(Number(result.lastInsertRowid)),
  });
});

router.patch('/lessons/:id', (req, res) => {
  const id = toId(req.params.id);
  const lesson = id ? db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) : null;
  if (!lesson) return res.status(404).json({ error: 'الدرس مش موجود' });

  const title = req.body?.title !== undefined ? cleanText(req.body.title, 120) : lesson.title;
  if (!title) return res.status(400).json({ error: 'اكتب عنوان الدرس' });

  let levelId = lesson.level_id;
  if (req.body?.level_id !== undefined) {
    levelId = toId(req.body.level_id);
    if (!levelId || !levelExists(levelId)) {
      return res.status(400).json({ error: 'اختار مستوى صحيح' });
    }
  }

  db.prepare(`
    UPDATE lessons
    SET level_id = ?, title = ?, content = ?, video_url = ?, sort_order = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(
    levelId,
    title,
    req.body?.content !== undefined ? cleanText(req.body.content, 20000) : lesson.content,
    req.body?.video_url !== undefined ? cleanText(req.body.video_url, 500) : lesson.video_url,
    req.body?.sort_order !== undefined ? sortOrder(req.body.sort_order) : lesson.sort_order,
    id
  );

  bumpVersion();
  res.json({ lesson: db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) });
});

router.delete('/lessons/:id', (req, res) => {
  const id = toId(req.params.id);
  const lesson = id ? db.prepare('SELECT * FROM lessons WHERE id = ?').get(id) : null;
  if (!lesson) return res.status(404).json({ error: 'الدرس مش موجود' });

  const storedNames = db
    .prepare('SELECT stored_name FROM lesson_files WHERE lesson_id = ?')
    .all(id);

  db.prepare('DELETE FROM lessons WHERE id = ?').run(id);

  for (const row of storedNames) removeStoredFile(row.stored_name);

  bumpVersion();
  res.json({ ok: true });
});

/* ----------------------------- مرفقات الدروس ----------------------------- */

function getFile(id) {
  return db.prepare('SELECT * FROM lesson_files WHERE id = ?').get(id);
}

/**
 * رفع ملف واحد لدرس.
 * multer بيتعامل مع الـ multipart، والميدلوير بتاع الأخطاء تحت بيحوّل
 * أخطاء الحجم/النوع لرسائل عربية واضحة.
 */
router.post('/lessons/:id/files', (req, res, next) => {
  const lessonId = toId(req.params.id);
  const lesson = lessonId
    ? db.prepare('SELECT id FROM lessons WHERE id = ?').get(lessonId)
    : null;

  if (!lesson) {
    return res.status(404).json({ error: 'الدرس مش موجود' });
  }

  upload.single('file')(req, res, (error) => {
    if (error) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'حجم الملف أكبر من 50 ميجا' });
      }
      return res.status(error.status || 400).json({
        error: error.message || 'مش قادر أرفع الملف',
      });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'اختار ملف الأول' });
    }

    const originalName = safeOriginalName(req.file.originalname);

    try {
      const result = db.prepare(`
        INSERT INTO lesson_files (lesson_id, original_name, stored_name, mime_type, size)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        lessonId,
        originalName,
        req.file.filename,
        cleanText(req.file.mimetype, 120),
        Number(req.file.size) || 0
      );

      bumpVersion();
      res.status(201).json({
        file: db.prepare(`
          SELECT id, lesson_id, original_name, mime_type, size, uploaded_at
          FROM lesson_files WHERE id = ?
        `).get(Number(result.lastInsertRowid)),
      });
    } catch (dbError) {
      // لو الحفظ في الداتابيز فشل، منسيبش ملف يتيم على القرص
      removeStoredFile(req.file.filename);
      next(dbError);
    }
  });
});

router.delete('/files/:id', (req, res) => {
  const id = toId(req.params.id);
  const file = id ? getFile(id) : null;
  if (!file) return res.status(404).json({ error: 'الملف مش موجود' });

  db.prepare('DELETE FROM lesson_files WHERE id = ?').run(id);
  removeStoredFile(file.stored_name);

  bumpVersion();
  res.json({ ok: true });
});

/* --------------------------- التقييمات والدرجات --------------------------- */

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function parseMaxScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > 10000) return null;
  return round2(number);
}

function getAssessment(id) {
  return db.prepare('SELECT * FROM assessments WHERE id = ?').get(id);
}

router.post('/assessments', (req, res) => {
  const levelId = toId(req.body?.level_id);
  const title = cleanText(req.body?.title, 120);
  const maxScore = parseMaxScore(req.body?.max_score);

  if (!levelId || !levelExists(levelId)) {
    return res.status(400).json({ error: 'اختار مستوى صحيح' });
  }
  if (!title) return res.status(400).json({ error: 'اكتب عنوان التقييم' });
  if (maxScore === null) {
    return res.status(400).json({ error: 'الدرجة النهائية لازم رقم أكبر من صفر (وأقصى 10000)' });
  }

  const result = db.prepare(`
    INSERT INTO assessments (level_id, title, max_score, sort_order)
    VALUES (?, ?, ?, ?)
  `).run(levelId, title, maxScore, sortOrder(req.body?.sort_order));

  bumpVersion();
  res.status(201).json({
    assessment: getAssessment(Number(result.lastInsertRowid)),
  });
});

router.patch('/assessments/:id', (req, res) => {
  const id = toId(req.params.id);
  const assessment = id ? getAssessment(id) : null;
  if (!assessment) return res.status(404).json({ error: 'التقييم مش موجود' });

  const title =
    req.body?.title !== undefined ? cleanText(req.body.title, 120) : assessment.title;
  if (!title) return res.status(400).json({ error: 'اكتب عنوان التقييم' });

  let maxScore = Number(assessment.max_score);
  if (req.body?.max_score !== undefined) {
    const parsed = parseMaxScore(req.body.max_score);
    if (parsed === null) {
      return res.status(400).json({ error: 'الدرجة النهائية لازم رقم أكبر من صفر' });
    }

    // مينفعش نخفّض النهاية تحت أعلى درجة اتسجلت فعلًا
    const highest = db.prepare('SELECT MAX(score) AS value FROM grades WHERE assessment_id = ?')
      .get(id).value;

    if (highest !== null && parsed < Number(highest)) {
      return res.status(400).json({
        error: `فيه درجة مسجلة ${Number(highest)}، فالنهاية مينفعش تقل عنها`,
      });
    }

    maxScore = parsed;
  }

  db.prepare(`
    UPDATE assessments
    SET title = ?, max_score = ?, sort_order = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    title,
    maxScore,
    req.body?.sort_order !== undefined ? sortOrder(req.body.sort_order) : assessment.sort_order,
    id
  );

  bumpVersion();
  res.json({ assessment: getAssessment(id) });
});

router.delete('/assessments/:id', (req, res) => {
  const id = toId(req.params.id);
  const assessment = id ? getAssessment(id) : null;
  if (!assessment) return res.status(404).json({ error: 'التقييم مش موجود' });

  db.prepare('DELETE FROM assessments WHERE id = ?').run(id);
  bumpVersion();
  res.json({ ok: true });
});

/**
 * درجات طالب واحد مع كل تقييمات مستواه (حتى اللي لسه مترصدش).
 */
router.get('/students/:id/grades', (req, res) => {
  const id = toId(req.params.id);
  const student = id ? getStudent(id) : null;
  if (!student) return res.status(404).json({ error: 'الطالب مش موجود' });

  const assessments = student.level_id
    ? db.prepare(`
        SELECT a.id, a.title, a.max_score, a.sort_order, g.score, g.updated_at
        FROM assessments a
        LEFT JOIN grades g ON g.assessment_id = a.id AND g.user_id = ?
        WHERE a.level_id = ?
        ORDER BY a.sort_order, a.id
      `).all(id, student.level_id)
    : [];

  res.json({ student, assessments });
});

/**
 * شيت الدرجات الكامل لمستوى: الطلاب × التقييمات.
 */
router.get('/levels/:id/sheet', (req, res) => {
  const levelId = toId(req.params.id);
  const level = levelId ? db.prepare('SELECT id, name FROM levels WHERE id = ?').get(levelId) : null;
  if (!level) return res.status(404).json({ error: 'المستوى مش موجود' });

  const students = db.prepare(`
    SELECT id, username, display_name
    FROM users
    WHERE role = 'student' AND level_id = ?
    ORDER BY display_name, id
  `).all(levelId);

  const assessments = db.prepare(`
    SELECT id, title, max_score, sort_order
    FROM assessments
    WHERE level_id = ?
    ORDER BY sort_order, id
  `).all(levelId);

  const grades = db.prepare(`
    SELECT g.user_id, g.assessment_id, g.score
    FROM grades g
    JOIN assessments a ON a.id = g.assessment_id
    WHERE a.level_id = ?
  `).all(levelId);

  const cells = new Map();
  for (const grade of grades) {
    cells.set(`${grade.user_id}:${grade.assessment_id}`, Number(grade.score));
  }

  res.json({
    level,
    assessments: assessments.map((assessment) => ({
      ...assessment,
      max_score: Number(assessment.max_score),
    })),
    students: students.map((student) => {
      const scores = {};
      for (const assessment of assessments) {
        const value = cells.get(`${student.id}:${assessment.id}`);
        if (value !== undefined) scores[assessment.id] = value;
      }
      return { ...student, scores };
    }),
  });
});

/**
 * حفظ شيت الدرجات مرة واحدة (كل الخلايا).
 * أي خلية بـ null أو فاضي معناها "امسح الدرجة".
 */
router.post('/levels/:id/grades', (req, res) => {
  const levelId = toId(req.params.id);
  const level = levelId ? db.prepare('SELECT id FROM levels WHERE id = ?').get(levelId) : null;
  if (!level) return res.status(404).json({ error: 'المستوى مش موجود' });

  const entries = req.body?.grades;
  if (!Array.isArray(entries)) {
    return res.status(400).json({ error: 'بيانات الدرجات مش صحيحة' });
  }

  const students = new Set(
    db.prepare("SELECT id FROM users WHERE role = 'student' AND level_id = ?")
      .all(levelId)
      .map((row) => row.id)
  );

  const assessmentRows = db
    .prepare('SELECT id, max_score FROM assessments WHERE level_id = ?')
    .all(levelId);

  const assessments = new Map(
    assessmentRows.map((row) => [row.id, Number(row.max_score)])
  );

  const cleaned = [];

  for (const entry of entries) {
    const studentId = toId(entry?.student_id);
    const assessmentId = toId(entry?.assessment_id);
    const raw = entry?.score;

    if (!studentId || !students.has(studentId)) {
      return res.status(400).json({ error: 'فيه طالب مش تابع للمستوى ده' });
    }
    if (!assessmentId || !assessments.has(assessmentId)) {
      return res.status(400).json({ error: 'فيه تقييم مش تابع للمستوى ده' });
    }

    if (raw === null || raw === undefined || raw === '') {
      cleaned.push({ studentId, assessmentId, score: null });
      continue;
    }

    const score = Number(raw);
    const maxScore = assessments.get(assessmentId);

    if (!Number.isFinite(score) || score < 0 || score > maxScore) {
      return res.status(400).json({
        error: `فيه درجة خارج المدى المسموح (0 لـ ${maxScore})`,
      });
    }

    cleaned.push({ studentId, assessmentId, score: round2(score) });
  }

  db.exec('BEGIN');
  try {
    const remove = db.prepare(
      'DELETE FROM grades WHERE assessment_id = ? AND user_id = ?'
    );
    const save = db.prepare(`
      INSERT INTO grades (assessment_id, user_id, score)
      VALUES (?, ?, ?)
      ON CONFLICT (assessment_id, user_id)
      DO UPDATE SET score = excluded.score, updated_at = datetime('now')
    `);

    for (const item of cleaned) {
      if (item.score === null) {
        remove.run(item.assessmentId, item.studentId);
      } else {
        save.run(item.assessmentId, item.studentId, item.score);
      }
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  res.json({ ok: true, saved: cleaned.length });
});

/**
 * رصد/تعديل/حذف درجة.
 * لو score = null أو فاضي → الدرجة بتتشال.
 */
router.post('/grades', (req, res) => {
  const studentId = toId(req.body?.student_id);
  const assessmentId = toId(req.body?.assessment_id);

  const student = studentId ? getStudent(studentId) : null;
  if (!student) return res.status(404).json({ error: 'الطالب مش موجود' });

  const assessment = assessmentId ? getAssessment(assessmentId) : null;
  if (!assessment) return res.status(404).json({ error: 'التقييم مش موجود' });

  if (!student.level_id || student.level_id !== assessment.level_id) {
    return res.status(400).json({ error: 'التقييم ده مش تابع لمستوى الطالب' });
  }

  const rawScore = req.body?.score;

  if (rawScore === null || rawScore === undefined || rawScore === '') {
    db.prepare('DELETE FROM grades WHERE assessment_id = ? AND user_id = ?')
      .run(assessmentId, studentId);

    return res.json({
      grade: { assessment_id: assessmentId, student_id: studentId, score: null },
    });
  }

  const score = Number(rawScore);
  const maxScore = Number(assessment.max_score);

  if (!Number.isFinite(score) || score < 0 || score > maxScore) {
    return res.status(400).json({
      error: `الدرجة لازم تكون من 0 لـ ${maxScore}`,
    });
  }

  db.prepare(`
    INSERT INTO grades (assessment_id, user_id, score)
    VALUES (?, ?, ?)
    ON CONFLICT (assessment_id, user_id)
    DO UPDATE SET score = excluded.score, updated_at = datetime('now')
  `).run(assessmentId, studentId, round2(score));

  const saved = db.prepare(
    'SELECT score FROM grades WHERE assessment_id = ? AND user_id = ?'
  ).get(assessmentId, studentId);

  res.json({
    grade: {
      assessment_id: assessmentId,
      student_id: studentId,
      score: Number(saved.score),
      max_score: maxScore,
    },
  });
});

module.exports = router;
