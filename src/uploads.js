const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');

/**
 * المرفقات بتتخزّن في data/uploads (جوه نفس فولدر الداتابيز)
 * عشان النسخ الاحتياطي بنسخ فولدر data/ يبقى كامل.
 */
const UPLOAD_DIR = path.join(__dirname, '..', 'data', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 ميجا

/**
 * قائمة الامتدادات المسموحة.
 * مقصودة إنها "مستندات ووسائط" بس — مفيش exe / js / html / svg،
 * لأن الدوال دي ممكن تتنفّذ أو تعمل XSS لو اتعرضت من السيرفر.
 */
const ALLOWED_EXTENSIONS = new Set([
  '.pdf',
  '.doc', '.docx', '.rtf', '.odt',
  '.ppt', '.pptx', '.odp',
  '.xls', '.xlsx', '.ods', '.csv',
  '.txt', '.md',
  '.zip', '.rar', '.7z',
  '.png', '.jpg', '.jpeg', '.gif', '.webp',
  '.mp3', '.wav', '.m4a', '.ogg',
  '.mp4', '.webm', '.mov', '.mkv',
]);

/**
 * أسماء الملفات العربية بتوصل من المتصفح كـ latin1، فبتبان رموز غريبة.
 * بنجرّب نحوّلها UTF-8، ولو النتيجة فيها حرف تالف (�) بنسيب الاسم زي ما هو.
 */
function safeOriginalName(name) {
  const raw = String(name || '').trim() || 'ملف';

  let decoded = raw;
  if (/[\u0080-\u00ff]/.test(raw)) {
    const attempt = Buffer.from(raw, 'latin1').toString('utf8');
    if (!attempt.includes('\uFFFD')) decoded = attempt;
  }

  // بنشيل أي مسارات وأحرف تحكم، وبنحدّد الطول
  return decoded
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/]/g, '-')
    .trim()
    .slice(0, 180) || 'ملف';
}

function extensionOf(name) {
  return path.extname(String(name || '')).toLowerCase();
}

function isAllowedFile(name) {
  return ALLOWED_EXTENSIONS.has(extensionOf(name));
}

const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, UPLOAD_DIR),

  // اسم عشوائي على القرص — الاسم الأصلي بنحفظه في الداتابيز للعرض والتحميل
  filename: (req, file, callback) => {
    const ext = extensionOf(safeOriginalName(file.originalname));
    const unique = `${Date.now()}-${crypto.randomBytes(12).toString('hex')}${ext}`;
    callback(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, callback) => {
    const original = safeOriginalName(file.originalname);

    if (!isAllowedFile(original)) {
      const error = new Error(
        'نوع الملف ده مش مسموح. المسموح: PDF، Word، PowerPoint، Excel، صور، فيديو، صوت، وأرشيف مضغوط.'
      );
      error.status = 400;
      return callback(error);
    }

    callback(null, true);
  },
});

/** بيحذف الملف الفيزيائي. متزامن عشان يخلص قبل ما الطلب يرد */
function removeStoredFile(storedName) {
  if (!storedName) return;

  // حماية إضافية: مينفعش نخرج بره فولدر الرفع
  const fullPath = path.join(UPLOAD_DIR, path.basename(String(storedName)));

  try {
    fs.unlinkSync(fullPath);
  } catch {
    /* الملف مش موجود أو مش قابل للحذف — مش مشكلة */
  }
}

function filePath(storedName) {
  return path.join(UPLOAD_DIR, path.basename(String(storedName)));
}

module.exports = {
  UPLOAD_DIR,
  MAX_FILE_SIZE,
  ALLOWED_EXTENSIONS,
  safeOriginalName,
  isAllowedFile,
  upload,
  removeStoredFile,
  filePath,
};
