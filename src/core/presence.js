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
  #nullStreak = 0
  #nullHold = 2

  /**
   * @param {object} opts
   * @param {() => number|null} opts.probe 返回空闲毫秒；拿不到返回 null
   * @param {() => number} [opts.now]
   * @param {number} [opts.idleThresholdMs] 默认 5 分钟
   * @param {number} [opts.confirmSamples] 从离开回到在场需要的连续采样数，默认 2
   */
  constructor({ probe, now = Date.now, idleThresholdMs = 5 * 60_000, confirmSamples = 2, nullHold = 2 } = {}) {
    this.#probe = probe
    this.#now = now
    this.#idleThresholdMs = idleThresholdMs
    this.#confirmSamples = confirmSamples
    this.#nullHold = nullHold
  }

  get state() { return this.#state }
  get pending() { return this.#pending }
  get idleMs() { return this.#lastIdleMs }

  /** 判定原始意图（未防抖）：idle < 阈值 → 在场；否则离开；拿不到 → 离开 */
  #verdict() {
    let idle = null
    try { idle = this.#probe?.() ?? null } catch { idle = null }
    this.#lastIdleMs = typeof idle === 'number' && Number.isFinite(idle) ? idle : null
    if (this.#lastIdleMs === null) return PRESENCE.UNKNOWN   // 读不到：先保持原判，连续失败后才当离开
    return this.#lastIdleMs < this.#idleThresholdMs ? PRESENCE.PRESENT : PRESENCE.AWAY
  }

  /** 采样一次；返回是否发生了"在场/离开"的状态切换以及方向。 */
  sample() {
    const next = this.#verdict()
    const prev = this.#state
    if (next === prev && next !== PRESENCE.UNKNOWN) { this.#pending = 0; this.#nullStreak = 0; return { changed: false, prev, next } }

    // 读不到值：保持原判（避免 PowerShell 偶发失败把"在场"打成"离开"）
    if (next === PRESENCE.UNKNOWN) {
      this.#nullStreak += 1
      if (this.#state !== PRESENCE.UNKNOWN && this.#nullStreak < this.#nullHold) {
        return { changed: false, prev, next: prev, unknownHold: true, streak: this.#nullStreak }
      }
      this.#state = PRESENCE.AWAY
      this.#pending = 0
      return { changed: prev !== PRESENCE.AWAY, prev, next: PRESENCE.AWAY, direction: prev === PRESENCE.AWAY ? undefined : 'away' }
    }
    this.#nullStreak = 0

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
    const fs = req('node:fs')
    const os = req('node:os')
    const path = req('node:path')

    const body = [
      '$sig = \'[DllImport(\"user32.dll\")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p); [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }\'',
      'Add-Type -MemberDefinition $sig -Name Idle -Namespace Win32 -ErrorAction Stop',
      '$l = New-Object Win32.Idle+LASTINPUTINFO',
      '$l.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($l)',
      '[void][Win32.Idle]::GetLastInputInfo([ref]$l)',
      '[math]::Floor(([Environment]::TickCount - $l.dwTime))',
    ].join('; ')

    let lastGood = null   // { idle, at }
    const nowMs = () => Date.now()

    const probeOnce = () => {
      // 方式一：读管道（正常环境最快）；DSH_IDLE_FORCE_FILE=1 可强制走文件方式
      try {
        if (process.env.DSH_IDLE_FORCE_FILE === '1') throw new Error('forced file mode')
        const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', body], {
          encoding: 'utf8', timeout: 3000, windowsHide: true,
        })
        // 关键：空 stdout 不能当 0（沙箱 EPERM 时 stdout=undefined，
        // Number('') === 0 会被误判成"刚操作过"→ 永远在场 → 通知永久静音）
        const raw = String(r.stdout ?? '').trim()
        if (!r.error && /^\d+$/.test(raw)) return Number(raw)
      } catch {
        /* 管道被沙箱禁止时走文件方式 */
      }

      // 方式二：让 PowerShell 写文件，再读文件（绕开"禁止管道 stdio"的沙箱限制）
      try {
        const out = path.join(os.tmpdir(), `dsh-qq-idle-${process.pid}.txt`)
        const script = `${body} | Out-File -FilePath '${out.replace(/\\/g, '\\\\')}' -Encoding ascii -Force`
        spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          stdio: 'ignore', timeout: 3000, windowsHide: true,
        })
        const rawFile = String(fs.readFileSync(out, 'utf8')).trim()
        try { fs.rmSync(out, { force: true }) } catch { /* ignore */ }
        // 与管道分支同样的严格性：空文件不能当 0
        return /^\d+$/.test(rawFile) ? Number(rawFile) : null
      } catch {
        return null
      }
    }

    return () => {
      let v = null
      try { v = probeOnce() } catch { v = null }
      if (v !== null) {
        lastGood = { idle: v, at: nowMs() }
        return v
      }
      // 失败重试一次（PowerShell 偶尔超时/EPERM）
      try { v = probeOnce() } catch { v = null }
      if (v !== null) {
        lastGood = { idle: v, at: nowMs() }
        return v
      }
      // 仍失败：90 秒内用最近成功值 + 时间差推平，避免"偶尔读不到"把判定打回离开
      if (lastGood && nowMs() - lastGood.at <= 90_000) {
        return lastGood.idle + (nowMs() - lastGood.at)
      }
      return null
    }
  } catch {
    return null
  }
}

/**
 * 选择探针并给出"走的哪条路"，便于 /mode 显示与排障。
 *   electron  → powerMonitor（零开销）
 *   powershell→ GetLastInputInfo（每次采样起一个进程，约几百毫秒）
 *   none      → 都不可用（判定会退化为"离开"）
 * 注意：不能只在 process.versions.electron 存在时才试 PowerShell——
 * 插件可能跑在 utility/worker 进程里，那里没有 electron 但 PowerShell 是可用的。
 */
export function detectIdleProbe() {
  const viaElectron = electronIdleProbe()
  if (viaElectron) return { kind: 'electron', probe: viaElectron }
  if (process.platform === 'win32') {
    const viaPs = powershellIdleProbe()
    if (viaPs) return { kind: 'powershell', probe: viaPs }
    return { kind: 'none', probe: null, reason: 'windows 上 PowerShell 兜底也不可用' }
  }
  return { kind: 'none', probe: null, reason: `platform=${process.platform}，无可用探针` }
}

/** 兼容旧调用：只要探针函数。 */
export function defaultIdleProbe() {
  return detectIdleProbe().probe
}
