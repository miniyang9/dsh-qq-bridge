/**
 * 审计（A26）· 不可抵赖的决定记录
 *
 * 每条一行 JSON，追加写（不改旧行）。五个字段：
 *   requestId / openid / at / card（卡片事实快照）/ evidenceViewed
 *
 * 为什么要存"卡片快照"而不是只存结果：出了事要能复原**你当时看到了什么**，
 * 否则"我批准了"这句话没有意义（ADR-23 同源）。
 */
import fsp from 'node:fs/promises'
import path from 'node:path'

export const RETENTION_DAYS = 180

export class Audit {
  constructor(file) {
    this.file = file
  }

  async append({ requestId, wpId = null, openid, at = Date.now(), card, evidenceViewed = false, evidenceMissing = false, outcome = null }) {
    const entry = {
      requestId: requestId ?? null,
      wpId: wpId ?? null,
      openid: openid ?? null,
      at,
      card: card ?? null,
      evidenceViewed,
      evidenceMissing,
      outcome,
    }
    await fsp.mkdir(path.dirname(this.file), { recursive: true })
    await fsp.appendFile(this.file, JSON.stringify(entry) + '\n', 'utf8')
    return entry
  }

  async readAll() {
    try {
      const raw = await fsp.readFile(this.file, 'utf8')
      return raw.split('\n').filter(Boolean).map((l) => JSON.parse(l))
    } catch (err) {
      if (err?.code === 'ENOENT') return []
      throw err
    }
  }

  /** 保留 180 天；不自动跑，由 doctor 或升级时调用。 */
  prune(now = Date.now()) {
    return this.readAll().then(async (all) => {
      const cut = now - RETENTION_DAYS * 86400_000
      const kept = all.filter((e) => (e.at ?? 0) >= cut)
      if (kept.length === all.length) return 0
      await fsp.writeFile(this.file, kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''), 'utf8')
      return all.length - kept.length
    })
  }
}
