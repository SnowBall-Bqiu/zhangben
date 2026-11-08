const MIN_PASSWORD_LENGTH = 15;
const MAX_PASSWORD_BYTES = 72;

function passwordInputError(value) {
  if (typeof value !== 'string' || !value.trim()) {
    return '密码不能为空或仅包含空白字符';
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_PASSWORD_BYTES) {
    return `密码不能超过 ${MAX_PASSWORD_BYTES} 个 UTF-8 字节`;
  }
  return null;
}

function newPasswordError(value) {
  const inputError = passwordInputError(value);
  if (inputError) return inputError;
  if (Array.from(value).length < MIN_PASSWORD_LENGTH) {
    return `密码不能少于 ${MIN_PASSWORD_LENGTH} 个字符`;
  }
  return null;
}

module.exports = { MIN_PASSWORD_LENGTH, MAX_PASSWORD_BYTES, passwordInputError, newPasswordError };
