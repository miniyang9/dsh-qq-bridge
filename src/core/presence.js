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

import { createRequire } from 'node:module'

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
    // 本文件是 ESM，没有 require —— 必须用 createRequire 才能在 Electron 里拿到内置模块。
    // 早期写裸 require 导致探针恒为 null（判定永远"离开"，全部推送）。
    const req = createRequire(import.meta.url)
    const { powerMonitor } = req('electron')
    if (!powerMonitor || typeof powerMonitor.getSystemIdleTime !== 'function') return null
    return () => powerMonitor.getSystemIdleTime() * 1000
  } catch {
    return null
  }
}

/**
 * PowerShell 兜底：读 GetLastInputInfo 的空闲毫秒。
 * 只在 Electron 探针不可用时使用；每次调用约几百毫秒，桥接按 30 秒采样，可接受。
 */
export function powershellIdleProbe() {
  try {
    const req = createRequire(import.meta.url)
    const { spawnSync } = req('node:child_process')
    return () => {
      const script = [
        "$sig = '[DllImport(\"user32.dll\")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p); [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }'",
        'Add-Type -MemberDefinition $sig -Name Idle -Namespace Win32 -ErrorAction Stop',
        '$l = New-Object Win32.Idle+LASTINPUTINFO',
        '$l.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($l)',
        '[void][Win32.Idle]::GetLastInputInfo([ref]$l)',
        '[math]::Floor(([Environment]::TickCount - $l.dwTime))',
      ].join('; ')
      const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8', timeout: 3000, windowsHide: true,
      })
      const n = Number(String(r.stdout ?? '').trim())
      return Number.isFinite(n) && n >= 0 ? n : null
    }
  } catch {
    return null
  }
}

/** 生产用默认探针：仅 Electron 环境启用（测试/普通 Node 返回 null，避免每次采样起 PowerShell）。 */
export function defaultIdleProbe() {
  if (!process.versions?.electron) return null
  return electronIdleProbe() ?? powershellIdleProbe() ?? null
}
