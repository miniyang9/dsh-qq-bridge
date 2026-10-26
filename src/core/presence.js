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

    // 沙箱里通常只允许写临时目录；LOCALAPPDATA 可能被拒，所以优先 TEMP
    const outDir = os.tmpdir()
    const ps1 = path.join(outDir, 'idle-probe.ps1')
    const outFile = path.join(outDir, 'idle-probe.out')

    const script = [
      '$sig = \'[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p); [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }\'',
      'Add-Type -MemberDefinition $sig -Name Idle -Namespace Win32 -ErrorAction Stop',
      '$l = New-Object Win32.Idle+LASTINPUTINFO',
      '$l.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($l)',
      '[void][Win32.Idle]::GetLastInputInfo([ref]$l)',
      '[math]::Floor(([Environment]::TickCount - $l.dwTime))',
    ].join('\n')

    /** 用 cmd 重定向取输出。路径不能加引号——cmd 会把带引号的重定向目标当失败。 */
    const runToFile = (command, out) => {
      try { fs.mkdirSync(outDir, { recursive: true }) } catch { /* ignore */ }
      try { fs.rmSync(out, { force: true }) } catch { /* ignore */ }
      const r = spawnSync('cmd.exe', ['/c', `${command} > ${out} 2>&1`], {
        stdio: 'ignore', timeout: 8000, windowsHide: true,
      })
      if (r?.error) return { text: '', error: String(r.error.code ?? r.error.message) }
      try {
        const text = fs.readFileSync(out, 'utf8')
        try { fs.rmSync(out, { force: true }) } catch { /* ignore */ }
        return { text, error: null }
      } catch (e) {
        return { text: '', error: String(e?.code ?? e?.message) }
      }
    }

    const parseQuser = (text) => {
      // quser 输出示例："  u1   console   1  Active   .   2026/10/25 9:00"
      // IDLE TIME：'.'（<1 分钟）、'none'、'H:MM'、'H:MM:SS'
      const line = text.split(/\r?\n/).find((l) => /\bActive\b/i.test(l)) ?? ''
      const cols = line.trim().split(/\s{2,}/)
      const idle = cols.find((c) => c === '.' || c === 'none' || /^\d+:\d{2}(:\d{2})?$/.test(c))
      if (!idle) return null
      if (idle === '.' || idle === 'none') return 0
      const parts = idle.split(':').map(Number)
      if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 60_000
      return ((parts[0] * 60 + parts[1]) * 60 + parts[2]) * 1000
    }

    let lastGood = null
    const nowMs = () => Date.now()

    const probeOnce = () => {
      // 方式一：直接读管道（DSH 沙箱允许；本机测试环境会 EPERM，自动退方式二）
      try {
        const pr = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
          encoding: 'utf8', timeout: 8000, windowsHide: true,
        })
        const rawPipe = String(pr?.stdout ?? '').trim()
        if (!pr?.error && /^\d+$/.test(rawPipe)) return Number(rawPipe)
      } catch { /* 走文件方式 */ }

      // 方式二：PowerShell 脚本文件（管道不可用时）
      try { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(ps1, script, 'utf8') } catch { /* ignore */ }
      const ps = runToFile(`powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ${ps1}`, outFile)
      const raw = String(ps.text ?? '').trim()
      if (ps.error === null && /^\d+$/.test(raw)) return Number(raw)

      // 方式二：quser（不需要编译；分钟级）
      const q = runToFile('quser.exe', outFile)
      if (q.error === null) {
        const idle = parseQuser(q.text)
        if (idle !== null) return idle
      }
      return null
    }

    return () => {
      let v = probeOnce()
      if (v !== null) { lastGood = { idle: v, at: nowMs() }; return v }
      v = probeOnce()
      if (v !== null) { lastGood = { idle: v, at: nowMs() }; return v }
      if (lastGood && nowMs() - lastGood.at <= 90_000) return lastGood.idle + (nowMs() - lastGood.at)
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

/**
 * 探针诊断：把"为什么拿不到空闲"逐条打出来，供 /mode 显示。
 * 不改变判定逻辑，只做取证。
 */
export function probeDiagnostics() {
  const out = []
  try {
    out.push(`electron=${process.versions?.electron ?? '无'}；平台=${process.platform}`)
  try {
    const req = createRequire(import.meta.url)
    const em = req('electron')
    const kind = typeof em
    const hasMon = kind === 'object' && em && typeof em.powerMonitor === 'object' ? '有' : '无'
    out.push(`require(electron): type=${kind} powerMonitor=${hasMon} keys=${kind === 'object' && em ? Object.keys(em).slice(0, 8).join(',') : ''}`)
  } catch (e) {
    out.push(`require(electron): 抛异常 ${String(e?.code ?? e?.message).slice(0, 60)}`)
  }
  } catch { out.push('electron=读取失败') }

  let cp = null
  try { cp = createRequire(import.meta.url)('node:child_process') } catch { cp = null }
  if (!cp) { out.push('child_process=不可用'); return out }

  const tryRun = (label, file, args, opts) => {
    try {
      const r = cp.spawnSync(file, args, { encoding: 'utf8', timeout: 5000, windowsHide: true, ...opts })
      const err = r.error ? String(r.error.code ?? r.error.message) : 'none'
      const so = String(r.stdout ?? '').trim().slice(0, 40)
      out.push(`${label}: error=${err} status=${r.status} stdout=${JSON.stringify(so)}`)
    } catch (e) {
      out.push(`${label}: 抛异常 ${String(e?.code ?? e?.message).slice(0, 60)}`)
    }
  }

  // 跑"真实脚本"，把 stderr 也带出来（Add-Type 在受限语言模式下会在这里报错）
  const realScript = [
    '$sig = \'[DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO p); [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }\'',
    'Add-Type -MemberDefinition $sig -Name Idle -Namespace Win32 -ErrorAction Stop',
    '$l = New-Object Win32.Idle+LASTINPUTINFO',
    '$l.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($l)',
    '[void][Win32.Idle]::GetLastInputInfo([ref]$l)',
    '[math]::Floor(([Environment]::TickCount - $l.dwTime))',
  ].join('; ')
  try {
    const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', realScript], {
      encoding: 'utf8', timeout: 8000, windowsHide: true,
    })
    out.push(`realScript: status=${r.status} out=${JSON.stringify(String(r.stdout ?? '').trim().slice(0, 40))} err=${JSON.stringify(String(r.stderr ?? '').trim().slice(0, 160))}`)
  } catch (e) {
    out.push(`realScript: 抛异常 ${String(e?.code ?? e?.message).slice(0, 80)}`)
  }

  // 不需要编译的兜底：读光标位置（能证明 PS 与 .NET 可用，但只能反映鼠标）
  try {
    const cur = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.Windows.Forms; $p=[System.Windows.Forms.Cursor]::Position; "$($p.X),$($p.Y)"'], {
      encoding: 'utf8', timeout: 8000, windowsHide: true,
    })
    out.push(`cursor: status=${cur.status} out=${JSON.stringify(String(cur.stdout ?? '').trim().slice(0, 20))} err=${JSON.stringify(String(cur.stderr ?? '').trim().slice(0, 80))}`)
  } catch (e) {
    out.push(`cursor: 抛异常 ${String(e?.code ?? e?.message).slice(0, 60)}`)
  }

  tryRun('echo(pipe)', 'cmd.exe', ['/c', 'echo ok'])
  tryRun('echo(ignore)', 'cmd.exe', ['/c', 'echo ok'], { stdio: 'ignore' })
  tryRun('powershell', 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'echo ok'])
  tryRun('quser', 'quser.exe', [])
  return out
}
