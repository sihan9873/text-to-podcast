export const USERNAME_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{2,31}$/
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

export function validateUsername(username: string): string | null {
  if (!USERNAME_PATTERN.test(username.trim())) {
    return "用户名须为 3 至 32 位，只能包含字母、数字、点、短横线和下划线"
  }
  return null
}

export function validatePassword(password: string): string | null {
  if (
    password.length < PASSWORD_MIN_LENGTH ||
    password.length > PASSWORD_MAX_LENGTH
  ) {
    return `密码长度须为 ${PASSWORD_MIN_LENGTH} 至 ${PASSWORD_MAX_LENGTH} 个字符`
  }
  if (!password.trim()) return "密码不能全部为空白字符"
  return null
}

export function validateDisplayName(displayName: string): string | null {
  const length = Array.from(displayName.trim()).length
  if (length === 0) return "显示名称不能为空"
  if (length > 80) return "显示名称不能超过 80 个字符"
  return null
}
