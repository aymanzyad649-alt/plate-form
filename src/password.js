const crypto = require('node:crypto');

const KEY_LENGTH = 64;

/**
 * بنخزّن الباسورد على شكل: scrypt$salt$hash
 * الـ salt عشوائي لكل مستخدم، فالنتيجة مختلفة حتى لو الباسوردين واحد.
 */
function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, salt, expected] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !expected) return false;

  const actual = crypto.scryptSync(String(plain), salt, KEY_LENGTH);
  const expectedBuffer = Buffer.from(expected, 'hex');

  // لازم نفس الطول قبل المقارنة، وإلا timingSafeEqual بيرمي خطأ
  if (expectedBuffer.length !== actual.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actual);
}

module.exports = { hashPassword, verifyPassword };
