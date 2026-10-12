const namedEntities: Record<string, string> = {
  amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " ",
  ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’", laquo: "«", raquo: "»",
  ndash: "–", mdash: "—", hellip: "…", middot: "·", bull: "•",
  copy: "©", reg: "®", trade: "™", deg: "°", euro: "€", pound: "£", yen: "¥", cent: "¢",
}

// DOM을 사용하지 않아 서버 렌더링과 브라우저에서 같은 평문을 반환한다.
// 알 수 없는 엔티티와 유효하지 않은 유니코드는 원문을 보존한다.
export function decodeHtmlEntities(text?: string | null): string {
  if (!text) return ""
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (entity, code: string) => {
    if (!code.startsWith("#")) {
      const key = code.toLowerCase()
      return Object.hasOwn(namedEntities, key) ? namedEntities[key] : entity
    }
    const value = code.toLowerCase().startsWith("#x") ? parseInt(code.slice(2), 16) : Number(code.slice(1))
    return value > 0 && value <= 0x10ffff && !(value >= 0xd800 && value <= 0xdfff)
      ? String.fromCodePoint(value) : entity
  })
}