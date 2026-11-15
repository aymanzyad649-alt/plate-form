const USERNAME_RE = /^[\p{L}\p{N}._-]{3,32}$/u;

function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isValidUsername(value) {
  return USERNAME_RE.test(value);
}

function cleanText(value, max = 5000) {
  return String(value ?? '').trim().slice(0, max);
}

function passwordProblem(value) {
  const password = String(value ?? '');
  if (password.length < 6) return 'الباسورد لازم 6 حروف على الأقل';
  if (password.length > 100) return 'الباسورد طويل جدًا';
  return null;
}

function toId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function isUniqueViolation(error) {
  return /UNIQUE constraint failed/i.test(String(error?.message || ''));
}

module.exports = {
  normalizeUsername,
  isValidUsername,
  cleanText,
  passwordProblem,
  toId,
  isUniqueViolation,
};
