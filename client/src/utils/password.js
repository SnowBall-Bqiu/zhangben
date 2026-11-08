export const MIN_PASSWORD_CHARACTERS = 15;
export const MAX_PASSWORD_BYTES = 72;
export const PASSWORD_REQUIREMENTS = `至少${MIN_PASSWORD_CHARACTERS}个字符，最多${MAX_PASSWORD_BYTES}个 UTF-8 字节`;

export function passwordByteLength(password) {
  return new TextEncoder().encode(password).length;
}

export function validateNewPassword(newPassword, currentPassword) {
  if (!newPassword.trim()) return '新密码不能全为空白字符';
  if (Array.from(newPassword).length < MIN_PASSWORD_CHARACTERS) {
    return `新密码长度不能少于${MIN_PASSWORD_CHARACTERS}个字符`;
  }
  if (passwordByteLength(newPassword) > MAX_PASSWORD_BYTES) {
    return `新密码不能超过${MAX_PASSWORD_BYTES}个 UTF-8 字节`;
  }
  if (newPassword === currentPassword) return '新密码不能与当前密码相同';
  return '';
}
