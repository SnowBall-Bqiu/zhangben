const MAX_AMOUNT = 999999999.99;

function createValidationError(message) {
  const err = new Error(message);
  err.status = 400;
  err.code = 'VALIDATION_ERROR';
  return err;
}

function normalizeString(value) {
  if (value == null) return '';
  return String(value).trim();
}

function ensure(condition, message) {
  if (!condition) {
    throw createValidationError(message);
  }
}

function validateType(value, allowed, field = 'type') {
  const normalized = normalizeString(value);
  ensure(allowed.includes(normalized), `${field} 参数非法`);
  return normalized;
}

function validateName(value, field, maxLength) {
  const normalized = normalizeString(value);
  ensure(normalized.length > 0, `${field}不能为空`);
  ensure(normalized.length <= maxLength, `${field}长度不能超过${maxLength}个字符`);
  ensure(!/[\u0000-\u001F\u007F]/.test(normalized), `${field}不能包含控制字符`);
  return normalized;
}

function validateOptionalText(value, field, maxLength) {
  if (value == null || value === '') {
    return null;
  }

  const normalized = String(value).trim();
  if (!normalized) return null;
  ensure(normalized.length <= maxLength, `${field}长度不能超过${maxLength}个字符`);
  ensure(!/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(normalized), `${field}不能包含控制字符`);
  return normalized;
}

function parsePositiveInteger(value, field) {
  const normalized = normalizeString(value);
  ensure(/^[1-9]\d*$/.test(normalized), `${field}必须是正整数`);
  const parsed = Number(normalized);
  ensure(Number.isSafeInteger(parsed), `${field}必须是正整数`);
  return parsed;
}

function parseOptionalPositiveInteger(value, field) {
  if (value == null || value === '') {
    return null;
  }
  return parsePositiveInteger(value, field);
}

function parsePageLimit(page, limit) {
  const pageNum = page == null || page === '' ? 1 : parsePositiveInteger(page, 'page');
  const limitNum = limit == null || limit === '' ? 20 : parsePositiveInteger(limit, 'limit');
  ensure(pageNum >= 1, 'page 必须大于等于 1');
  ensure(limitNum >= 1 && limitNum <= 100, 'limit 必须在 1 到 100 之间');
  return {
    pageNum,
    limitNum,
    offset: (pageNum - 1) * limitNum,
  };
}

function parseAmount(value, field) {
  const normalized = normalizeString(value);
  ensure(/^(?:\d+)(?:\.\d{1,2})?$/.test(normalized), `${field}必须是最多两位小数的正数`);
  const parsed = Number(normalized);
  ensure(Number.isFinite(parsed), `${field}必须是最多两位小数的正数`);
  ensure(parsed > 0, `${field}必须大于 0`);
  ensure(parsed <= MAX_AMOUNT, `${field}不能超过 ${MAX_AMOUNT}`);
  return parsed;
}

function validateDate(value) {
  const normalized = normalizeString(value);
  ensure(/^\d{4}-\d{2}-\d{2}$/.test(normalized), '日期格式必须为 YYYY-MM-DD');
  const date = new Date(`${normalized}T00:00:00.000Z`);
  ensure(!Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === normalized, '日期格式不正确');
  return normalized;
}

function escapeLike(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/[%_]/g, '\\$&');
}

module.exports = {
  createValidationError,
  validateType,
  validateName,
  validateOptionalText,
  parsePositiveInteger,
  parseOptionalPositiveInteger,
  parsePageLimit,
  parseAmount,
  validateDate,
  escapeLike,
};
