const express = require('express');
const { db } = require('../db');
const { requireAuth } = require('../auth');
const { toId } = require('../validators');
const { filePath } = require('../uploads');

const router = express.Router();

/**
 * بنحسب التقدم من قاعدة البيانات نفسها:
 * عدد دروس المستوى، وعدد اللي الطالب خلّصهم.
 */
function progressFor(userId, levelId) {
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
           COALESCE(SUM(CASE WHEN p.id IS NULL THEN 0 ELSE 1 END), 0) AS completed
    FROM lessons l
    LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = ?
    WHERE l.level_id = ?
  `).get(userId, levelId);

  const total = Number(row?.total || 0);
  const completed = Number(row?.completed || 0);

  return {
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0,
  };
}

/**
 * الطالب بيشوف مستواه هو بس + دروسه + حالة كل درس (اتعمل ولا لأ).
 */
router.get('/my-level', requireAuth, (req, res) => {
  const user = db.prepare('SELECT level_id FROM users WHERE id = ?').get(req.user.id);

  if (!user || !user.level_id) {
    return res.json({ level: null });
  }

  const level = db.prepare(`
    SELECT id, name, description, sort_order
    FROM levels
    WHERE id = ?
  `).get(user.level_id);

  if (!level) return res.json({ level: null });

  const lessons = db.prepare(`
    SELECT l.id, l.title, l.content, l.video_url, l.sort_order,
           CASE WHEN p.id IS NULL THEN 0 ELSE 1 END AS completed
    FROM lessons l
    LEFT JOIN lesson_progress p ON p.lesson_id = l.id AND p.user_id = ?
    WHERE l.level_id = ?
    ORDER BY l.sort_order, l.id
  `).all(req.user.id, user.level_id)
    .map((lesson) => ({ ...lesson, completed: Boolean(lesson.completed) }));

  const files = db.prepare(`
    SELECT f.id, f.lesson_id, f.original_name, f.mime_type, f.size, f.uploaded_at
    FROM lesson_files f
    JOIN lessons l ON l.id = f.lesson_id
    WHERE l.level_id = ?
    ORDER BY f.uploaded_at, f.id
  `).all(user.level_id);

  const filesByLesson = new Map();
  for (const file of files) {
    if (!filesByLesson.has(file.lesson_id)) filesByLesson.set(file.lesson_id, []);
    filesByLesson.get(file.lesson_id).push(file);
  }

  res.json({
    level: {
      ...level,
      lessons: lessons.map((lesson) => ({
        ...lesson,
        files: filesByLesson.get(lesson.id) || [],
      })),
      progress: progressFor(req.user.id, user.level_id),
    },
  });
});

/**
 * تعليم درس كـ "تم" أو إلغاء الإنجاز.
 * بنتحقق إن الدرس فعلاً ضمن مستوى الطالب — عشان محدش يعدّل درس مستوى تاني.
 */
router.post('/lessons/:id/progress', requireAuth, (req, res) => {
  const lessonId = toId(req.params.id);
  if (!lessonId) {
    return res.status(400).json({ error: 'رقم الدرس مش صحيح' });
  }

  const completed = req.body?.completed;
  if (typeof completed !== 'boolean') {
    return res.status(400).json({ error: 'قيمة completed لازم تكون true أو false' });
  }

  const user = db.prepare('SELECT level_id FROM users WHERE id = ?').get(req.user.id);
  if (!user || !user.level_id) {
    return res.status(400).json({ error: 'مفيش مستوى متحدد لحسابك' });
  }

  const lesson = db.prepare('SELECT id, level_id FROM lessons WHERE id = ?').get(lessonId);
  if (!lesson) return res.status(404).json({ error: 'الدرس مش موجود' });
  if (lesson.level_id !== user.level_id) {
    return res.status(403).json({ error: 'الدرس ده مش ضمن مستواك' });
  }

  if (completed) {
    db.prepare('INSERT OR IGNORE INTO lesson_progress (user_id, lesson_id) VALUES (?, ?)')
      .run(req.user.id, lessonId);
  } else {
    db.prepare('DELETE FROM lesson_progress WHERE user_id = ? AND lesson_id = ?')
      .run(req.user.id, lessonId);
  }

  res.json({
    lesson_id: lessonId,
    completed,
    progress: progressFor(req.user.id, user.level_id),
  });
});

/**
 * درجات الطالب في تقييمات مستواه + المتوسط.
 * المتوسط محسوب بأوزان الدرجات النهائية للتقييمات اللي اترصدت بس.
 */
router.get('/my-grades', requireAuth, (req, res) => {
  const user = db.prepare('SELECT level_id FROM users WHERE id = ?').get(req.user.id);

  if (!user || !user.level_id) {
    return res.json({
      assessments: [],
      summary: { graded: 0, total: 0, score: 0, max_score: 0, percent: null },
    });
  }

  const assessments = db.prepare(`
    SELECT a.id, a.title, a.max_score, a.sort_order, g.score, g.updated_at
    FROM assessments a
    LEFT JOIN grades g ON g.assessment_id = a.id AND g.user_id = ?
    WHERE a.level_id = ?
    ORDER BY a.sort_order, a.id
  `).all(req.user.id, user.level_id).map((assessment) => {
    const score = assessment.score === null ? null : Number(assessment.score);
    const maxScore = Number(assessment.max_score);

    return {
      ...assessment,
      score,
      max_score: maxScore,
      percent: score === null ? null : Math.round((score / maxScore) * 1000) / 10,
    };
  });

  const graded = assessments.filter((assessment) => assessment.score !== null);
  const score = graded.reduce((sum, assessment) => sum + assessment.score, 0);
  const maxScore = graded.reduce((sum, assessment) => sum + assessment.max_score, 0);

  res.json({
    assessments,
    summary: {
      graded: graded.length,
      total: assessments.length,
      score: Math.round(score * 100) / 100,
      max_score: Math.round(maxScore * 100) / 100,
      percent: maxScore > 0 ? Math.round((score / maxScore) * 1000) / 10 : null,
    },
  });
});

/**
 * تحميل مرفق. محمي:
 * - المدير يقدر يحمّل أي ملف.
 * - الطالب بس ملفات الدروس اللي في مستواه.
 */
router.get('/files/:id', requireAuth, (req, res) => {
  const id = toId(req.params.id);
  const file = id ? db.prepare('SELECT * FROM lesson_files WHERE id = ?').get(id) : null;
  if (!file) return res.status(404).json({ error: 'الملف مش موجود' });

  if (req.user.role !== 'admin') {
    const row = db.prepare(`
      SELECT 1 AS ok
      FROM lessons l
      JOIN users u ON u.id = ?
      WHERE l.id = ? AND u.level_id = l.level_id
    `).get(req.user.id, file.lesson_id);

    if (!row) return res.status(403).json({ error: 'الملف ده مش ضمن مستواك' });
  }

  res.download(filePath(file.stored_name), file.original_name, (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({ error: 'الملف مش موجود على السيرفر' });
    }
  });
});

module.exports = router;
