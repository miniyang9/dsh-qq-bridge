/**
 * 在场判定（单维：系统空闲时长）
 *
 * 语义只有一句：**这台机器前面现在有没有人在操作。**
 * 不判断 DSH 是否在前台——那是"可见性"，不是"在场"（用户已确认不需要）。
 *
 * 光源链（优先级）：
 *   1) Electron powerMonitor.getSystemIdleTime()（DSH 自带，零依赖）
 *   2) 拿不到 → unknown（调用方按"离开"处理，宁可多推）
 *
 * 防抖：变吵（在场→离开）立即生效；变安静（离开→在场）需连续 2 次一致。
 */

export const PRESENCE = Object.freeze({ PRESENT: 'present', AWAY: 'away', UNKNOWN: 'unknown' })

export class Presence {
  #probe
  #now
  #idleThresholdMs
  #confirmSamples
  #state = PRESENCE.UNKNOWN
  #pending = 0
  #lastIdleMs = null

  /**
   * @param {object} opts
   * @param {() => number|null} opts.probe 返回空闲毫秒；拿不到返回 null
   * @param {() => number} [opts.now]
   * @param {number} [opts.idleThresholdMs] 默认 5 分钟
   * @param {number} [opts.confirmSamples] 从离开回到在场需要的连续采样数，默认 2
   */
  constructor({ probe, now = Date.now, idleThresholdMs = 5 * 60_000, confirmSamples = 2 } = {}) {
    this.#probe = probe
    this.#now = now
    this.#idleThresholdMs = idleThresholdMs
    this.#confirmSamples = confirmSamples
  }

  get state() { return this.#state }
  get idleMs() { return this.#lastIdleMs }

  /** 判定原始意图（未防抖）：idle < 阈值 → 在场；否则离开；拿不到 → 离开 */
  #verdict() {
    let idle = null
    try { idle = this.#probe?.() ?? null } catch { idle = null }
    this.#lastIdleMs = typeof idle === 'number' && Number.isFinite(idle) ? idle : null
    if (this.#lastIdleMs === null) return PRESENCE.AWAY   // 失败安全：宁可多推
    return this.#lastIdleMs < this.#idleThresholdMs ? PRESENCE.PRESENT : PRESENCE.AWAY
  }

  /** 采样一次；返回是否发生了"在场/离开"的状态切换以及方向。 */
  sample() {
    const next = this.#verdict()
    const prev = this.#state
    if (next === prev) { this.#pending = 0; return { changed: false, prev, next } }

    // 变吵（→离开）立即生效；变安静（→在场）需要连续确认
    if (next === PRESENCE.AWAY) {
      this.#state = PRESENCE.AWAY
      this.#pending = 0
      return { changed: prev !== next, prev, next, direction: 'away' }
    }
    this.#pending += 1
    if (this.#pending >= this.#confirmSamples) {
      this.#state = PRESENCE.PRESENT
      this.#pending = 0
      return { changed: true, prev, next, direction: 'present' }
    }
    return { changed: false, prev, next, pending: this.#pending }
  }

  /** 供 /mode 展示 */
  describe() {
    const idle = this.#lastIdleMs
    const idleText = idle === null ? '拿不到空闲时间' : `${Math.floor(idle / 60000)} 分钟`
    return { state: this.#state, idleText }
  }
}

/** Electron 环境下的默认探针；普通 Node（测试）下返回 null。 */
export function electronIdleProbe() {
  try {
    // 只在 Electron 主进程可用；这里用动态 require，避免测试环境报错
    const { powerMonitor } = require('electron')
    if (!powerMonitor || typeof powerMonitor.getSystemIdleTime !== 'function') return null
    return () => powerMonitor.getSystemIdleTime() * 1000
  } catch {
    return null
  }
}
