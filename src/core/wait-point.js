/**
 * WaitPoint（契约 3）· 内存版
 *
 * S3 只做内存版：进程一停就没了。落盘在 S4 补（`state.json` 原子写）。
 * 状态封闭集：open / resolved / expired / dropped。
 */
let seq = 0

export class WaitPointStore {
  /** @param {() => number} [now] 注入时钟，默认 Date.now */
  #now
  constructor(now = Date.now) {
    this.#now = now
  }

  #items = new Map()

  create({ kind = 'approval', title = '', meta = {} } = {}) {
    const id = `wp-${++seq}`
    let resolve
    const promise = new Promise((r) => {
      resolve = r
    })
    const item = {
      id,
      kind,
      title,
      meta,
      status: 'open',
      createdAt: this.#now(),
      answer: null,
      resolve,
      promise,
    }
    this.#items.set(id, item)
    return item
  }

  /** 从磁盘恢复（只恢复终态：重启时 open 已被改成 dropped）。不重建 promise。 */
  restore(items = []) {
    for (const it of items) {
      this.#items.set(it.id, {
        id: it.id,
        kind: it.kind ?? 'approval',
        title: it.title ?? '',
        meta: it.meta ?? {},
        status: it.status ?? 'dropped',
        createdAt: it.createdAt ?? this.#now(),
        answer: it.answer ?? null,
        dropReason: it.dropReason ?? null,
        resolve: () => {},
        promise: Promise.resolve({ id: it.id, status: it.status }),
      })
    }
    // A10：重启后不能让新请求复用旧 id —— 把计数器推到已存在的最大序号之后
    let max = 0
    for (const it of items) {
      const n = Number(String(it.id ?? '').replace(/^wp-/, ''))
      if (Number.isFinite(n) && n > max) max = n
    }
    if (max > seq) seq = max
  }

  get(id) {
    return this.#items.get(id) ?? null
  }

  list() {
    return [...this.#items.values()]
  }

  /** 只有 open 接受答复；其余一律返回 rejected 说明，不改状态。payload 原样带回。 */
  answer(id, payload = {}) {
    const item = this.get(id)
    if (!item) return { ok: false, reason: 'unknown' }
    if (item.status !== 'open') return { ok: false, reason: item.status }
    item.status = 'resolved'
    item.answer = { ...payload, at: Date.now() }
    item.resolve({ id, status: 'resolved', ...payload })
    return { ok: true }
  }

  drop(id, reason) {
    const item = this.get(id)
    if (!item || item.status !== 'open') return false
    item.status = 'dropped'
    item.dropReason = reason
    item.resolve({ id, status: 'dropped', reason })
    return true
  }

  expire(id) {
    const item = this.get(id)
    if (!item || item.status !== 'open') return false
    item.status = 'expired'
    item.resolve({ id, status: 'expired' })
    return true
  }
}
