/**
 * 会话标识解析（纯函数，便于单测）
 *
 * 歧义点：`/use 123456` 既可能是"列表第 123456 项"，也可能是"短 id 恰好是 6 位纯数字"。
 * 规则：先按短 id 精确匹配（保留前导零）→ 再按前缀（仅长度 ≥6）→ 最后才当序号。
 */
export function resolveStoredTarget(stored, idArg, shortOf) {
  if (idArg === null || idArg === undefined) return null
  const raw = String(idArg)
  if (/^\d+$/.test(raw)) {
    const byShort = stored.find((x) => shortOf(x.id).toLowerCase() === raw.toLowerCase())
    if (byShort) return { id: byShort.id, cwd: byShort.cwd, title: byShort.title }
    if (raw.length >= 6) {
      const byPrefix = stored.find((x) => shortOf(x.id).toLowerCase().startsWith(raw.toLowerCase()))
      if (byPrefix) return { id: byPrefix.id, cwd: byPrefix.cwd, title: byPrefix.title }
    }
    const picked = stored[Number(raw) - 1]
    return picked ? { id: picked.id, cwd: picked.cwd, title: picked.title } : null
  }
  const key = raw.replace(/^session-/, '').toLowerCase()
  const found = stored.find((x) => {
    const full = String(x.id).toLowerCase()
    return full === key || full.replace(/^session-/, '').startsWith(key)
  })
  if (found) return { id: found.id, cwd: found.cwd, title: found.title }
  if (/^wp-\d+$/i.test(raw)) return null      // 待答点 id 不能当会话 id
  return { id: raw, cwd: null, title: null }  // 可能是刚建、还没进库的会话
}
