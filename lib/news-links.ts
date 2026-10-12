export function getSafeNewsUrl(value?: string | null): string | null {
  if (!value?.trim()) return null
  try {
    const url = new URL(value.trim())
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null
    return url.href
  } catch {
    return null
  }
}
