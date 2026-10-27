/**
 * Bridge · 接缝 ↔ QQ 通道
 *
 * S3：卡片 ↔ 答复闭环（真机已跑通）
 * S4：状态落盘（原子写）、投递去重、重启后待答点作废、主动消息兜底
 */
import { TokenStore } from '../transport/auth.js'
import { QQClient } from '../transport/qq.js'
import { renderCard, renderQuestionCard, parseCommand, dedupeKey } from '../transport/envelope.js'
import { WaitPointStore } from '../core/wait-point.js'
import { JsonStore, defaultStatePath } from '../core/store.js'
import { classify, findToolArgs } from '../core/label.js'
import { isEvent } from '../core/events.js'   // Event 形状有测试，但生产路径尚未投影成 Event（见 02）
import { Audit } from './audit.js'
import { BridgeLog, defaultLogPath } from './log.js'
import { listStoredSessions, humanAge, defaultSessionsRoot, listKnownWorkspaces } from '../core/sessions.js'
import { Presence, PRESENCE, detectIdleProbe, probeDiagnostics } from '../core/presence.js'
import { resolveStoredTarget } from '../core/resolve.js'

/**
 * 一张票 → 审批结局。批准/yes 都算允许；其余算拒绝。
 * 单独导出是为了让测试能直接锁住映射（/yes 与 /ans 1 必须等价）。
 */
export function outcomeFromVote(vote) {
  const v = String(vote ?? '').trim().toLowerCase()
  return v === '批准' || v === 'yes' || v === 'allow' || v === 'allowed' || v === 'allowed-once'
    ? 'allowed-once'
    : 'rejected'
}

/** GUI 想写结果时发现手机那票已先结算：以已生效的那票为准（不可解析时按取消）。 */
export function decisionFromOther(other) {
  if (other === null || other === undefined) return 'cancelled'
  if (other.status !== 'resolved') return 'cancelled'
  return outcomeFromVote(other.text)
}

function shortOf(id) {
  return String(id ?? '').replace(/^session-/, '').slice(0, 6)
}

const OUTCOMES = new Set(['allowed-once', 'allowed', 'rejected', 'cancelled', 'unavailable'])
const MAX_PUSH_PER_DAY = 3

/**
 * 用户消息的形状取自 `agent.inject()` 的既有用法（审批策略变更处）。
 * 真机未验证——S5 的遗留项，见台账。
 */
export function userMessage(text) {
  // 形状对齐 dsh-llm 的 createUserMessage：role + id 缺一不可，否则会被静默丢弃
  const id = globalThis.crypto?.randomUUID?.() ?? `say-${Date.now()}-${Math.random().toString(16).slice(2)}`
  return {
    id,
    role: 'user',
    content: [{ type: 'text', text }],
    // DSH 的 MessageSource 词表：kind 必须是 'user'（还要 rpcId），没有 'user-say'
    source: { kind: 'user', rpcId: id },
  }
}

/** 会话是否正在跑：从尾部往前，先遇到 turn/start 就是忙，先遇到 turn/end 就是闲。 */
export function isBusy(session) {
  if (!session || typeof session.eventAt !== 'function') return false
  const end = Number(session.seq ?? 0)
  for (let i = end - 1; i >= 0 && i >= end - 200; i -= 1) {
    const ev = session.eventAt(i)
    if (ev?.type === 'turn/start') return true
    if (ev?.type === 'turn/end') return false
  }
  return false
}

/** 从会话尾部找"上次停在哪"：最近一个 turn/end。 */
export function lastStop(session) {
  if (!session || typeof session.eventAt !== 'function') return '没有会话记录'
  const end = Number(session.seq ?? 0)
  for (let i = end - 1; i >= 0 && i >= end - 200; i -= 1) {
    const ev = session.eventAt(i)
    if (ev?.type === 'turn/end') {
      const at = ev.data?.at ?? ev.at ?? null
      return at === null || at === undefined
        ? '上次 turn 已结束（结束时刻未记录）'
        : `上次 turn 在 ${new Date(at).toISOString()} 结束`
    }
  }
  return '还没有 turn 结束记录'
}

/** seam 可以传 Event，也可以传裸 request（迁移期兼容）。 */
export function unwrap(request) {
  if (isEvent(request)) return { ...request.payload, callId: request.requestId }
  return request
}

/** 只有"看起来像命令"的入站文本才回纠正，裸词静默（它只是给我们一个被动窗口）。 */
const WRITE_TOOL_RE = /(write|edit|create|delete|remove|move|rename|mkdir|rm|mv|cp|apply_patch)/i

/** 从 tool/call 里认出"这是写操作"，并尽量取出目标路径。 */
export function writeTargetOf(name, argsRaw) {
  if (!WRITE_TOOL_RE.test(String(name ?? ''))) return null
  let args = argsRaw
  if (typeof args === 'string') {
    try { args = JSON.parse(args) } catch { return { tool: name, path: null } }
  }
  const path = args && typeof args === 'object'
    ? (args.path ?? args.filePath ?? args.file ?? args.target ?? args.dest ?? args.cwd ?? null)
    : null
  return { tool: name, path: path === null ? null : String(path) }
}

/**
 * 把一条用户消息真正送进会话：
 *   - followup：排队并在空闲时唤醒 → 会起新 turn（空闲会话必须用这个）
 *   - inject：只入队不唤醒（会静默留在收件箱）
 * 所以优先 followup。
 */
export function deliverToAgent(agent, message) {
  if (agent === null || agent === undefined) throw new Error('没有 agent 可投递')
  if (typeof agent.followup === 'function') { agent.followup(message); return 'followup' }
  if (typeof agent.send === 'function') { agent.send(message, 'next-turn', true); return 'send' }
  if (typeof agent.inject === 'function') { agent.inject(message); return 'inject' }
  throw new Error('这个 agent 没有 followup/send/inject')
}

function extractText(data) {
  const parts = data?.message?.content ?? data?.content ?? []
  if (typeof parts === 'string') return parts
  if (!Array.isArray(parts)) return ''
  return parts.filter((p) => p?.type === 'text' && typeof p.text === 'string').map((p) => p.text).join('')
}

export function looksLikeCommand(raw) {
  const t = String(raw ?? '').trim()
  return /^\//.test(t) || /^[1-9]$/.test(t) || /^(yes|no)\b/i.test(t)
}

export class Bridge {
  constructor({
    appId, appSecret, allowlist = [], apiBase, log = console,
    WebSocketImpl, fetchImpl, client,
    statePath = defaultStatePath(),
    workspaceRoot = process.cwd(),
    toolWhitelist = [],
    sessionsRoot = defaultSessionsRoot(),
    workspaceIndex = undefined,
    getAgents = () => null,
    getSessionController = () => null,
    getWorkspaceController = () => null,
    probeServices = null,
    logFile = defaultLogPath(),
    maxNewPerWorkspacePerDay = 10,
    idleProbe = null,
    presenceIdleMs = 5 * 60_000,
    sayReplyChars = 800,
    mergeMs = 0,
    now = () => Date.now(),
  } = {}) {
    this.workspaceRoot = workspaceRoot
    this.toolWhitelist = toolWhitelist
    this.sessionsRoot = sessionsRoot
    this.workspaceIndex = workspaceIndex
    this.getAgents = getAgents
    this.getSessionController = getSessionController
    this.getWorkspaceController = getWorkspaceController
    this.probeServices = probeServices
    this.maxNewPerWorkspacePerDay = maxNewPerWorkspacePerDay
    this.mergeMs = mergeMs
    this.cardBuffer = []
    this.cardTimer = null
    this.allowlist = new Set(allowlist.filter(Boolean))
    this.log = log
    this.now = now
    this.points = new WaitPointStore(() => this.now())
    this.boundAgent = null
    this.sessions = new Map()
    this.consults = new Map()
    this.consultIdleMs = 300_000
    this.dualChannel = true
    this.maxNoticesPerDay = 10
    this.sayReplyChars = sayReplyChars
    // 在场判定：只有空闲一维；探针可由测试注入（idleProbe）
    const probePick = idleProbe ? { kind: 'injected', probe: idleProbe } : detectIdleProbe()
    this.idleProbeKind = probePick.kind
    this.idleProbeReason = probePick.reason ?? null
    this.presence = new Presence({
      probe: probePick.probe ?? (() => null),
      now: () => this.now(),
      idleThresholdMs: presenceIdleMs,
      confirmSamples: 2,
    })
    // 模式：auto / pc（静音到 until） / away（强制推送）
    // 注意：此时 this.state 还没建（由 #loadState 负责），默认值在 #mode() 里兜底
    this.startedAt = Date.now()
    this.qqCreated = new Set()
    this.failedSends = 0
    this.firstFailedAt = null
    this.stallFirstMs = 10 * 60_000
    this.stallSecondMs = 30 * 60_000
    this.watchCache = null
    this.watchCacheAt = 0
    this.sessionState = new Map() // id → {lastAt, turnOpen, notified, session}
    this.seen = new Set()
    this.lastMsgId = null
    this.lastMsgAt = 0
    this.seqByMsgId = new Map()
    this.store = new JsonStore(statePath)
    this.runLog = new BridgeLog(logFile)
    this.audit = new Audit(statePath.replace(/\.json$/, '') + '.audit.jsonl')
    this.state = { version: 1, waitPoints: [], deliveries: {}, interruption: null }
    this.deliveries = new Map()
    this.ready = null
    this.client = client ?? new QQClient({
      tokenStore: new TokenStore({ appId, appSecret, fetchImpl }),
      apiBase, WebSocketImpl, fetchImpl, log,
    })
    this.client.on('event', (ev) => this.onEvent(ev))
    this.client.on('ready', () => this.onReady())
    this.client.on('error', (err) => this.log.error?.(`[qq-bridge] transport: ${err?.message ?? err}`))
    this.client.on('ready', () => {
      if (this.failedSends > 0) {
        const n = this.failedSends
        const since = this.firstFailedAt === null ? '' : `，最早一条在 ${new Date(this.firstFailedAt).toISOString().slice(11, 16)}`
        this.failedSends = 0
        this.firstFailedAt = null
        if (!this.#present()) this.send(`断网期间有 ${n} 条没送达${since}。要逐条补发请说一声，否则只给这条摘要。`, null).catch(() => {})
      }
    })
    this.client.on('recovered', () => {
      this.runLog?.write({ dir: 'out', kind: 'reconnect', detail: 'recovered' })
      if (!this.#present()) this.send('我重连过（连接曾无响应）。', null).catch(() => {})
    })
  }

  async start() {
    await this.#loadState()
    // 在场采样独立于 tick：30 秒一次，回座后最多 60 秒恢复"在场"
    this.presenceTimer = setInterval(() => { this.samplePresence().catch(() => {}) }, 30_000)
    this.presenceTimer.unref?.()   // 不阻止进程退出
    // A26：审计保留 180 天；启动时裁剪一次（失败不影响启动）
    if (this.audit && typeof this.audit.prune === 'function') {
      this.audit.prune().catch?.(() => {})
    }
    this.ready = this.client.start()
    return this.ready
  }

  async #loadState() {
    const loaded = await this.store.load()
    this.state = loaded
    this.deliveries = new Map(Object.entries(loaded.deliveries ?? {}))

    const staleOpen = (loaded.waitPoints ?? []).filter((w) => w.status === 'open')
    if (staleOpen.length > 0) {
      const at = this.now()
      for (const w of loaded.waitPoints) {
        if (w.status === 'open') {
          w.status = 'dropped'
          w.dropReason = 'restart'
          w.droppedAt = at
        }
      }
      this.state.interruption = { at, dropped: staleOpen.length }
      this.log.info?.(`[qq-bridge] 上次非正常结束：${staleOpen.length} 个待答点已作废`)
    }
    // 先装回内存，再落盘；顺序反了会用空列表把磁盘覆盖掉。
    this.points.restore(loaded.waitPoints ?? [])
    if (staleOpen.length > 0) await this.#persist()
  }

  async #persist() {
    this.state.deliveries = Object.fromEntries(this.deliveries)
    this.state.consults = this.state.consults ?? []
    this.state.waitPoints = this.points.list().map((p) => ({
      id: p.id, kind: p.kind, title: p.title, status: p.status,
      createdAt: p.createdAt, answer: p.answer ?? null, dropReason: p.dropReason ?? null,
      meta: { toolName: p.meta?.toolName ?? null, labeled: p.meta?.labeled ?? false },
    }))
    try {
      await this.store.save(this.state)
    } catch (err) {
      this.log.error?.(`[qq-bridge] 落盘失败: ${err?.message ?? err}`)
    }
  }

  async onReady() {
    const interrupt = this.state.interruption
    if (!interrupt) return
    const interrupted = Object.keys(this.state.activeTurns ?? {}).length
    const text = `我重启过。上次非正常结束：${interrupted} 个中断 turn，${interrupt.dropped} 个待答请求已作废（不会重放），请重新触发。`
    this.state.interruption = null
    await this.#persist()
    if (!this.#present()) await this.send(text, null)   // 在场时不必把重启提示推到手机
  }

  async onEvent({ type, data }) {
    if (type !== 'C2C_MESSAGE_CREATE') return
    const openid = data?.author?.user_openid
    const key = dedupeKey(data?.id, data?.message_seq)
    if (this.seen.has(key)) return
    this.seen.add(key)

    if (!this.allowlist.has(openid)) {
      this.log.info?.('[qq-bridge] 非白名单身份，忽略')
      return
    }

    this.lastMsgId = data.id
    this.lastMsgAt = this.now()
    this.msgAt = this.msgAt ?? new Map()
    if (data?.id) this.msgAt.set(String(data.id), this.now())

    const raw = String(data?.content ?? '')
    const cmd = parseCommand(raw)

    if (cmd.kind === 'option' || cmd.kind === 'confirm' || cmd.kind === 'reject' || cmd.kind === 'answerText') {
      await this.resolveAnswer(cmd, data)
      return
    }

    if (cmd.kind === 'unknown') {
      // D21：不带斜杠（或写错的命令）没有路由语义，只回状态提示
      await this.send(
        ['这条消息没有对应任何命令。', '答复：/yes <id> ｜ /no <id> ｜ /ans <id> 1',
         '咨询：/why <id|序号> <问题> ｜ /done <id>',
         '指令：/say <id|序号> <文本>', '任务：/list ｜ /use <n|短id> ｜ /wake <n|短id> ｜ /new [n]'].join('\n'),
        data.id,
      )
      return
    }

    // 已解析但尚未实现的命令：明确说不支持，绝不静默吞掉（否则你会以为它生效了）。
    if (cmd.kind === 'say') {
      // "/say doctor 指令…" 与 "/say doctor指令…" 要在意：只有确实像会话引用才当 id
      let text = cmd.text
      let idArg = cmd.id
      if (idArg !== null && idArg !== undefined && !(await this.looksLikeSessionRef(idArg))) {
        text = `${idArg} ${text}`
        idArg = null
      }
      await this.startSay(text, data, idArg)
      return
    }
    if (cmd.kind === 'list') {
      await this.send(await this.listSessions(), data.id)
      return
    }
    if (cmd.kind === 'mode') {
      await this.send(this.#modeText(), data.id)
      return
    }
    if (cmd.kind === 'pc') {
      // ADR-32：分钟数必须是正整数；0/负数/非数字一律拒绝
      if (cmd.minutes !== null && cmd.minutes !== undefined && !(typeof cmd.minutes === 'number' && Number.isInteger(cmd.minutes) && cmd.minutes >= 1)) {
        await this.send(`参数「${cmd.minutes}」无效：/pc 只接受正整数分钟（例如 /pc 60）。`, data.id)
        return
      }
      const minutes = cmd.minutes ?? 60
      this.state.mode = { mode: 'pc', until: this.now() + minutes * 60_000 }
      await this.#persist()
      await this.send(`已静音 ${minutes} 分钟（到期自动恢复）。审批 5 分钟没人答仍会推给你。`, data.id)
      return
    }
    if (cmd.kind === 'away') {
      this.state.mode = { mode: 'away', until: null }
      await this.#persist()
      await this.send('已切到「始终推送」。（/auto 恢复自动）', data.id)
      return
    }
    if (cmd.kind === 'auto') {
      this.state.mode = { mode: 'auto', until: null }
      await this.#persist()
      await this.send('已恢复自动判定（按空闲时长）。', data.id)
      return
    }
    if (cmd.kind === 'more') {
      await this.#morePage(cmd.id, data)
      return
    }
    if (cmd.kind === 'progress') {
      await this.send(await this.progress(cmd.id), data.id)
      return
    }
    if (cmd.kind === 'why') {
      await this.ask(cmd, data)
      return
    }
    if (cmd.kind === 'done') {
      await this.endConsult(cmd.id, data, '手动结束')
      return
    }
    if (cmd.kind === 'new') {
      await this.send(await this.newSession(cmd.arg), data.id)
      return
    }
    if (cmd.kind === 'wake') {
      await this.send(await this.wakeSession(cmd.arg), data.id)
      return
    }
    if (cmd.kind === 'use') {
      const picked = await this.useSession(cmd.arg ?? cmd.index)
      const msg = picked.ok
        ? `已绑定 ${shortOf(picked.id)}；「空闲」时可用 /say，运行中会等它结束。`
        : picked.reason === 'not-running'
          ? `${shortOf(picked.id)} 不在运行中，无法 /say；请在 GUI 里打开它。`
          : `没有 ${cmd.arg ?? cmd.index} 这个任务，发 /list 看列表。`
      await this.send(msg, data.id)
      return
    }
    // 所有命令都已实现；这里只留兜底，避免未来新增 kind 时静默吞掉
    const NOT_YET = {}
    if (NOT_YET[cmd.kind]) {
      await this.send(NOT_YET[cmd.kind], data.id)
    }
  }

  async resolveAnswer(cmd, data) {
    const target = this.points.get(cmd.id)
    if (!target) {
      await this.send(`没有 ${cmd.id} 这个待答请求。发 /list 看任务，或 /why <id> 问现场。`, data.id)
      return
    }
    if (target.status !== 'open') {
      const why = target.status === 'expired'
        ? (target.kind === 'question'
          ? '该提问已超时结束（DSH 侧已中止），你的答复不再生效'
          : '已失效（DSH 侧已中止/超时），你的答复不再生效')
        : target.status === 'dropped'
          ? `已作废（${target.dropReason ?? '原因未记录'}）`
          : '已处理过'
      await this.send(`${cmd.id} 属于已结束的请求 ${target.id}：${why}——这次答复没有被采纳。`, data.id)
      return
    }

    // /say 的确认：/ans <id> 1 = 发送，/ans <id> 2 = 取消
    if (target.kind === 'say') {
      // 兼容两种写法：/ans <id> 1|2，以及 Q18 约定的 /yes <id>、/no <id>
      const pick = cmd.kind === 'option' ? cmd.index
        : cmd.kind === 'yes' ? 1
          : cmd.kind === 'no' ? 2
            : null
      if (pick === null) {
        await this.send(`要发送请回 /yes ${target.id} 或 /ans ${target.id} 1；取消回 /no ${target.id} 或 /ans ${target.id} 2。`, data.id)
        return
      }
      if (pick === 2) {
        this.points.drop(target.id, 'cancelled-by-user')
        await this.send(`已取消 ${target.id}。`, data.id)
        await this.#persist()
        return
      }
      try {
        // 目标会话可能不是 boundAgent（/say <短id> 指到别的会话），从 meta 里取回来
        const agent = this.#agentFor(target.meta?.sessionId) ?? this.boundAgent
        if (!agent) throw new Error('目标会话没有可用的 agent')
        const agentId = String(agent.id ?? agent.session?.id ?? '')
        const sess = agent.session
        const before = Number(sess?.seq ?? 0)
        // 我们建的会话，第一句话顺便当标题：QQ <首行，≤20 字>
        // 判定用"当前标题仍是 QQ"，这样重启后（内存集合为空）也能改名
        const currentTitle = await this.#titleOf(agentId, sess).catch(() => null)
        if (this.qqCreated?.has?.(agentId) || currentTitle === 'QQ') {
          try {
            const firstLine = String(target.meta.text).split('\n')[0].replace(/\s+/g, ' ').trim().slice(0, 20)
            if (firstLine) {
              agent?.session?.append?.('session/title', {
                title: `QQ ${firstLine}`,
                messageSeqs: [],
                source: { kind: 'user' },
              })
              this.qqCreated.delete(agentId)
            }
          } catch {
            /* 忽略 */
          }
        }
        const how = deliverToAgent(agent, userMessage(target.meta.text))
        await new Promise((r) => setTimeout(r, 600))
        const after = Number(sess?.seq ?? 0)
        this.points.answer(target.id, { text: target.meta.text, via: 'say' })
        // 记下"这一轮跑完要把结果带回来"（A22 的可用性：发了话不能没有下文）
        this.sayRelay = { sessionId: agentId, qqMsgId: data.id, at: this.now() }
        const delta = after - before
        const status = String(agent?.status ?? '未知')
        const diag = `${how}｜事件 ${before}→${after}｜status=${status}｜agent=${shortOf(agentId)}`
        await this.send(
          delta > 0
            ? `已发送：${target.meta.text.slice(0, 60)}\n（${diag}）跑完我会把回答带回来一条。`
            : `已发送：${target.meta.text.slice(0, 60)}\n（${diag}）——消息已入队，但没看到事件增长；若 GUI 一直没反应，把这一行发我。`,
          data.id,
        )
      } catch (err) {
        this.points.drop(target.id, 'inject-failed')
        await this.send(`发送失败：${err?.message ?? err}`, data.id)
      }
      await this.#persist()
      return
    }

    // 被标注的请求只认 /yes：/ans 的任何形式都不受理
    if (target.meta?.labeled === true && cmd.kind !== 'confirm' && cmd.kind !== 'reject') {
      await this.send(`这是不可逆请求，只认 /yes ${target.id}（或 /no ${target.id}）。`, data.id)
      return
    }

    // B6：提问只能 /ans；/yes /no 对提问不成立（02 契约矩阵为"—"）
    if (target.kind === 'question' && (cmd.kind === 'confirm' || cmd.kind === 'reject')) {
      await this.send(`这是提问，不是审批：请用 /ans ${target.id} <选项序号> 或 /ans ${target.id} <文本>。`, data.id)
      return
    }

    let payload
    if (cmd.kind === 'reject') {
      payload = target.kind === 'question'
        ? { selected: [], by: data.author?.user_openid }
        : { text: '拒绝', by: data.author?.user_openid }
    } else if (cmd.kind === 'confirm') {
      payload = target.kind === 'question'
        ? { custom: 'yes', by: data.author?.user_openid }
        : { text: 'yes', by: data.author?.user_openid }
    } else if (cmd.kind === 'answerText') {
      if (target.kind !== 'question') {
        await this.send(`这个请求不支持文本答复（审批只接受选项）；请用 /ans ${target.id} 1 或 2，被标注的用 /yes ${target.id}。`, data.id)
        return
      }
      payload = { custom: cmd.text, by: data.author?.user_openid }
    } else {
      const label = target.meta?.optionLabels?.[cmd.index - 1] ?? target.meta?.options?.[cmd.index - 1]
      if (label === undefined) {
        await this.send(`没有第 ${cmd.index} 个选项。`, data.id)
        return
      }
      payload = target.kind === 'question'
        ? { selected: [label], by: data.author?.user_openid }
        : { text: label, by: data.author?.user_openid }
    }

    // N2：结算成功才算"采纳"。已被另一端处理的请求不再回"已收到"，也不写第二条审计
    const res = this.points.answer(target.id, payload)
    if (!res || res.ok !== true) {
      await this.send(`${target.id} 已被处理（${res?.reason ?? '已完成'}），这次答复没有采纳。`, data.id)
      return
    }
    await this.send(`已收到：${target.id} → ${payload.selected?.[0] ?? payload.text ?? payload.custom}`, data.id)
    await this.audit.append({
      // B7：能对齐 DSH 日志时优先用 callId，同时保留 wp-N 便于本地追溯
      requestId: String(target.meta?.callId ?? target.id),
      wpId: target.id,
      openid: data.author?.user_openid,
      at: this.now(),
      card: target.meta?.card ?? null,
      evidenceViewed: target.meta?.evidenceViewed === true,
      evidenceMissing: target.meta?.evidenceMissing === true,
      outcome: JSON.stringify(payload),
    })
    this.log.info?.(`[qq-bridge] 答复 ${target.id}: ${JSON.stringify(payload)} (${res.ok ? 'ok' : res.reason})`)
    await this.#persist()
  }

  /** 提问型：任意文本都算答案（自由文本）。 */
  async answerWithText(wp, data) {
    const raw = String(data?.content ?? '').trim()
    await this.send(`已收到：${wp.id} → ${raw.slice(0, 100)}`, data.id)
    this.points.answer(wp.id, { custom: raw, by: data.author?.user_openid })
    await this.audit.append({
      requestId: wp.id,
      openid: data.author?.user_openid,
      at: this.now(),
      card: wp.meta?.card ?? null,
      evidenceViewed: false,
      outcome: JSON.stringify({ custom: raw }),
    })
    this.log.info?.(`[qq-bridge] 文本答复 ${wp.id}`)
    await this.#persist()
  }

  /** 合并窗口：窗口内的多张卡片合成一条发送（C2）。mergeMs=0 时逐条立即发。 */
  async #queueCard(id, text) {
    const wp = this.points.get(id)
    if (this.#present()) {
      // 人在电脑前：DSH 自己会弹窗，不再推 QQ（5 分钟兜底 / 离开补推会接手）
      if (wp) wp.meta = { ...(wp.meta ?? {}), pushedToQQ: false }
      return
    }
    // 先标记"正在发"，发送成功后才置 true；失败由下面的 catch 回滚，
    // 否则 #flushPending 与 5 分钟兜底都会因 pushedToQQ===true 跳过 → 审批卡片静默丢失
    if (wp) wp.meta = { ...(wp.meta ?? {}), pushedToQQ: true }
    if (this.mergeMs <= 0) {
      try {
        return await this.send(text, this.lastMsgId)
      } catch (err) {
        this.#markPushed([id], false)   // 发失败 → 回滚，交给离开补推/5 分钟兜底
        throw err
      }
    }
    this.cardBuffer.push({ id, text })
    if (this.cardTimer === null) {
      this.cardTimer = setTimeout(() => { this.#flushCards().catch(() => {}) }, this.mergeMs)
      this.cardTimer?.unref?.()
    }
    return undefined
  }

  /** 批量把"已推送"标记改成指定值（发送失败时回滚）。 */
  #markPushed(ids, value) {
    for (const id of ids) {
      const wp = this.points.get(id)
      if (wp) wp.meta = { ...(wp.meta ?? {}), pushedToQQ: value }
    }
  }

  async #flushCards() {
    const items = this.cardBuffer
    this.cardBuffer = []
    this.cardTimer = null
    if (items.length === 0) return undefined
    const text = items.length === 1
      ? items[0].text
      : `[${items.length} 个新请求]\n${items.map((it) => it.text).join('\n----\n')}`
    try {
      return await this.send(text, this.lastMsgId)
    } catch (err) {
      // 发送失败：把这几张卡回滚成"未推送"，否则它们永远发不出去（任务卡死）
      this.#markPushed(items.map((it) => it.id), false)
      this.log.error?.(`[qq-bridge] 卡片发送失败，已回滚待补推：${err?.message ?? err}`)
      return undefined
    }
  }

  /** 咨询通道能不能用：两个服务都在才算（A27a：不可用要在卡片上如实标注）。 */
  #consultAvailable() {
    const sc = this.getSessionController?.()
    const agents = this.getAgents?.()
    return Boolean(sc && agents)
  }

  /** 当前标题：先看会话自身的最后一个 session/title 事件，读不到再查会话库。 */
  async #titleOf(id, session = null) {
    try {
      if (session && typeof session.eventAt === 'function') {
        for (let i = Number(session.seq ?? 0) - 1; i >= 0; i -= 1) {
          const ev = session.eventAt(i)
          if (ev?.type === 'session/title' && typeof ev.data?.title === 'string') return ev.data.title
        }
      }
    } catch {
      /* 落到库查询 */
    }
    try {
      const rows = await listStoredSessions(this.sessionsRoot, this.now())
      const hit = rows.find((r) => String(r.id) === String(id))
      return hit?.title ?? null
    } catch {
      return null
    }
  }

  /** `/list`：**全部任务**（读会话库），活跃的标出来；咨询会话不列（A36）。 */
  async listSessions(limit = 10) {
    const hidden = new Set(this.state.consults ?? [])
    const stored = (await listStoredSessions(this.sessionsRoot, this.now())).filter((x) => !hidden.has(x.id))
    if (stored.length === 0) return '会话库里没有找到任何会话（或读不到 ~/.dsh/sessions）。'
    const liveIds = new Set(this.sessions.keys())
    const rows = stored.slice(0, limit).map((s, i) => {
      const live = liveIds.has(s.id)
      const rec = this.sessions.get(s.id)
      const state = !live ? '未加载' : isBusy(rec?.agent?.session) ? '运行中' : '空闲'
      const bound = this.boundAgent !== null && String(this.boundAgent.id ?? this.boundAgent.session?.id ?? '') === s.id
      const label = s.title ?? '(无标题)'
      return `${i + 1}) ${shortOf(s.id)} · ${label}｜${humanAge(s.ageMs)}｜${state}${bound ? '｜已绑定' : ''}｜${s.project}`
    })
    const more = stored.length > limit ? `\n（共 ${stored.length} 个，只列最近 ${limit} 个）` : `\n（共 ${stored.length} 个）`
    return [
      '任务列表（按修改时间倒序）：',
      ...rows,
      '用 /use <序号|短id> 绑定；「空闲」才能 /say（运行中会等它结束）；「未加载」先 /wake。',
    ].join('\n') + more
  }

  /** `/progress [id|序号|短id]`（A3）：当前 turn、最近几条事件、待答点数量。 */
  async progress(idArg) {
    let target = null
    if (idArg !== null && idArg !== undefined) {
      target = await this.resolveTargetId(idArg)
    } else if (this.boundAgent !== null) {
      target = { id: String(this.boundAgent.id ?? this.boundAgent.session?.id ?? ''), cwd: null }
    }
    if (!target?.id) return '还没绑定会话：先 /use <序号|短id>，或直接 /progress <序号|短id>。'

    const live = this.sessions.get(target.id)
      ?? (this.boundAgent && String(this.boundAgent.id ?? '') === target.id ? { agent: this.boundAgent } : null)
    if (!live?.agent) return `${shortOf(target.id)} 没加载：/wake <序号|短id> 之后再问进度。`

    const session = live.agent.session
    const busy = isBusy(session)
    const open = this.points.list().filter((p) => p.status === 'open').length
    const recent = []
    const end = Number(session?.seq ?? 0)
    if (typeof session?.eventAt === 'function') {
      for (let i = end - 1; i >= 0 && i >= end - 50 && recent.length < 5; i -= 1) {
        const ev = session.eventAt(i)
        if (!ev?.type) continue
        if (['turn/start', 'turn/end', 'assistant/message', 'tool/call', 'approval/asked', 'approval/decided'].includes(ev.type)) {
          recent.push(`· ev-${i} ${ev.type}${ev.data?.name ? '(' + String(ev.data.name).slice(0, 20) + ')' : ''}`)
        }
      }
    }
    return [
      `会话 ${shortOf(target.id)}：${busy ? '正在跑' : '空闲'}`,
      `待答请求：${open} 个${open > 0 ? '（' + this.points.list().filter((p) => p.status === 'open').map((p) => p.id).join('、') + '）' : ''}`,
      recent.length ? '最近事件（新→旧）：' + recent.join(' ') : '还没有事件',
      busy ? `想看它为什么停：/why ${shortOf(target.id)}` : `要继续：/say ${shortOf(target.id)} <指令>`,
    ].join('\n')
  }

  /** 把 id 参数解析成会话：数字=列表序号，其它=短 id 前缀；库里有就用库里的，没有原样当 id。 */
  async resolveTargetId(idArg) {
    if (idArg === null || idArg === undefined) return null
    // B8：/list 会隐藏咨询会话，序号解析必须用同一份列表，否则 /use 1 会绑到咨询会话
    const hidden = new Set(this.state.consults ?? [])
    const stored = (await listStoredSessions(this.sessionsRoot, this.now())).filter((x) => !hidden.has(x.id))
    const byStore = resolveStoredTarget(stored, idArg, shortOf)
    if (byStore !== null) return byStore
    // B3：待答点 id（wp-N）绝不能被当成会话 id（卡片的 /why 提示会误导）
    if (/^wp-\d+$/i.test(String(idArg))) return null
    // 其它未入库的 token 仍按"可能是刚建的会话"处理（B5：新建会话要能立刻 /why）
    return { id: String(idArg), cwd: null, title: null }
  }

  /** 会话 id → 已加载的 agent（精确 id 优先，其次短 id 前缀）。 */
  #agentFor(id) {
    const key = String(id ?? '')
    if (!key) return null
    const rec = this.sessions.get(key)
    if (rec?.agent) return rec.agent
    const boundId = String(this.boundAgent?.id ?? this.boundAgent?.session?.id ?? '')
    if (boundId && boundId === key) return this.boundAgent
    const short = key.replace(/^session-/, '').toLowerCase()
    for (const [sid, r] of this.sessions) {
      const full = String(sid).replace(/^session-/, '').toLowerCase()
      if (full === short || full.startsWith(short)) return r.agent ?? null
    }
    return null
  }

  /** `/why <id|序号> <问题>`（D18）：起/复用该会话的咨询通道，把问题投进去。 */
  async ask(cmd, data) {
    if (!cmd.question) {
      await this.send('用法：/why <id|序号|短id> <你的问题>', data.id)
      return
    }
    const target = await this.resolveTargetId(cmd.id)
    if (!target?.id) {
      await this.send(`找不到 ${cmd.id ?? ''} 这个会话，发 /list 看序号或短 id。`, data.id)
      return
    }

    // B7：用户真的发起了 /why → 该会话当前所有待答点都算"现场已看过"，写进审计
    let marked = 0
    for (const p of this.points.list()) {
      if (p.status !== 'open') continue
      if (String(p.meta?.sessionId ?? '') !== target.id) continue
      p.meta = { ...(p.meta ?? {}), evidenceViewed: true }
      marked += 1
    }
    if (marked > 0) await this.#persist()

    let entry = this.consults.get(target.id)
    if (!entry) {
      const sc = this.getSessionController()
      const agents = this.getAgents()
      if (!sc || !agents) {
        const brief = await this.#fallbackSummary(target.id)
        await this.send(`咨询不可用（拿不到 sessionController/agents）。这是摘要，不是现场调查：\n${brief}`, data.id)
        return
      }
      const createFn = typeof sc.create === 'function' ? sc.create.bind(sc)
        : typeof sc.createSession === 'function' ? sc.createSession.bind(sc)
          : null
      if (createFn === null) {
        await this.send('拿不到创建会话的方法（create/createSession 都没有），咨询通道不可用。', data.id)
        return
      }
      try {
        // 咨询会话跟着任务会话的工作区走（它只是替你看现场，不建新任务）
        // 有 workspaceId 就用它：只传 cwd 会在 GUI 里落到「未分组」
        let wsId = null
        try {
          const spaces = await listKnownWorkspaces(this.workspaceIndex)
          wsId = spaces.find((w) => String(w.path) === String(target.cwd ?? ''))?.id ?? null
        } catch {
          /* 读不到就退回 cwd */
        }
        const createArgs = wsId ? { workspaceId: wsId } : { cwd: target.cwd ?? this.workspaceRoot }
        const created = await createFn(createArgs)
        const newId = created?.sessionId ?? created?.id ?? created?.session?.id ?? null
        const agent = newId ? await this.#waitAgent(agents, newId) : null
        if (!agent) {
          await this.send('咨询会话建好了，但没拿到 agent。', data.id)
          return
        }
        // 起个能认出来的名字，避免侧边栏出现"未命名"
        try {
          const label = target.title ? String(target.title).slice(0, 16) : shortOf(target.id)
          agent?.session?.append?.('session/title', {
            title: `QQ 咨询 · ${label}`,
            messageSeqs: [],
            source: { kind: 'user' },
          })
        } catch {
          /* 起名失败不影响咨询 */
        }
        entry = { consultId: String(newId), agent, rounds: 0, pending: null, timer: null }
        this.consults.set(target.id, entry)
        this.state.consults = [...new Set([...(this.state.consults ?? []), String(newId)])]
        await this.#persist()
      } catch (err) {
        await this.send(`起咨询会话失败：${err?.message ?? err}`, data.id)
        return
      }
    }

    if (entry.pending !== null) {
      await this.send(`上一个问题还没答完，等它说完再问（${shortOf(target.id)}）。`, data.id)
      return
    }

    entry.rounds += 1
    entry.pending = { qqMsgId: data.id, buffer: '', writes: [] }
    this.#armConsultTimer(target.id, entry)
    try {
      deliverToAgent(entry.agent, userMessage(`关于任务会话 ${target.id}（工作区 ${target.cwd ?? '未知'}）：${cmd.question}`))
    } catch (err) {
      entry.pending = null
      await this.send(`投递问题失败：${err?.message ?? err}`, data.id)
    }
  }

  async #waitAgent(agents, id, tries = 20) {
    if (agents === null || agents === undefined) return null   // 服务不在时不要崩，交给调用方报错
    for (let i = 0; i < tries; i += 1) {
      const a = agents.get?.(id)
      if (a) return a
      await new Promise((r) => setTimeout(r, 100))
    }
    return null
  }

  #armConsultTimer(targetId, entry) {
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      this.endConsult(targetId, null, `${this.consultIdleMs / 1000}s 无追问`).catch(() => {})
    }, this.consultIdleMs)
    entry.timer?.unref?.()
  }

  async endConsult(idArg, data, reason) {
    const target = await this.resolveTargetId(idArg)
    const key = target?.id ?? idArg
    const entry = this.consults.get(key)
    if (!entry) {
      if (data) await this.send(`没有 ${idArg ?? ''} 的咨询通道。`, data.id)
      return
    }
    clearTimeout(entry.timer)
    this.consults.delete(key)
    try { entry.agent?.cancel?.({ kind: 'user' }) } catch { /* ignore */ }
    // /done 之后自动归档咨询会话（用户要求）：不留在侧边栏里继续占位置
    let archived = false
    let archiveError = null
    try {
      const wc = this.getWorkspaceController?.()
      const consultId = String(entry.consultId ?? '')
      if (wc && typeof wc.archiveSession === 'function' && consultId) {
        // stopActivity：会话还在跑（例如正在回答你的问题）时，官方接口默认拒绝归档；
        // 这里明确要求先停掉它的活动再归档，否则 /done 一定失败。
        await wc.archiveSession({ sessionId: consultId, stopActivity: true })
        archived = true
        this.runLog?.write({ dir: 'out', kind: 'archive', requestId: consultId, detail: 'archived' })
      } else {
        archiveError = '拿不到 workspaceController'
      }
    } catch (err) {
      archived = false
      archiveError = err?.message ?? String(err)
      this.runLog?.write({ dir: 'err', kind: 'archive', requestId: String(entry.consultId ?? ''), detail: archiveError.slice(0, 120) })
    }

    const tail = archived ? '；已归档' : `；归档未成功（${archiveError ?? '未知原因'}）`
    const msg = `咨询已结束（会话 ${shortOf(key)}，共 ${entry.rounds} 轮，原因：${reason}${tail}）`
    if (data) await this.send(msg, data.id)
    else if (!this.#present()) await this.send(msg, null)   // 自动结束的提示：在场时不打扰
  }

  /** `/new [n]`（D16/D17）：只在已知工作区新建，每天每工作区 ≤ 上限。 */
  async newSession(arg) {
    const spaces = await listKnownWorkspaces(this.workspaceIndex)
    if (spaces.length === 0) return '读不到工作区清单（~/.dsh/storages/workspace.json）。'
    if (arg === undefined || arg === null || String(arg) === '') {
      return [
        '在哪个工作区新建？',
        ...spaces.map((w, i) => `${i + 1}) ${w.path}`),
        '（发 /new <序号> 选择，例如 /new 2）',
      ].join('\n')
    }
    if (!/^\d+$/.test(String(arg))) {
      return `无效的工作区「${arg}」：只接受清单里的序号（发 /new 看列表）。`
    }
    const index = Number(arg)
    const target = spaces[index - 1]
    if (!target) return `第 ${index} 个工作区不存在（超出清单范围）；发 /new 看列表。`

    const today = new Date(this.now()).toISOString().slice(0, 10)
    const rec = this.state.newSessions?.[target.id]
    const used = rec && rec.day === today ? rec.count : 0
    if (used >= this.maxNewPerWorkspacePerDay) {
      return `今天在 ${target.path} 已经新建 ${used} 个，到上限了（每工作区 ${this.maxNewPerWorkspacePerDay} 个/天）。`
    }

    const sc = this.getSessionController()
    const createFn = typeof sc?.create === 'function' ? sc.create.bind(sc)
      : typeof sc?.createSession === 'function' ? sc.createSession.bind(sc)
        : null
    if (createFn === null) return '拿不到 sessionController 服务，新建不可用。'
    try {
      // workspaceId 与 cwd 互斥：只传 cwd 的会话在 GUI 里会落到「未分组」
      const created = await createFn(target.id ? { workspaceId: target.id } : { cwd: target.path })
      const id = created?.sessionId ?? created?.id ?? created?.session?.id ?? created?.session?.header?.id ?? null
      this.state.newSessions = { ...(this.state.newSessions ?? {}), [target.id]: { day: today, count: used + 1 } }
      await this.#persist()
      if (id) {
        const agents = this.getAgents()
        const agent = await this.#waitAgent(agents, id)   // D16：创建是异步的，等一下并重试
        // 先只给一个 "QQ" 前缀，等第一句话进来再补成 "QQ <任务>"
        try {
          agent?.session?.append?.('session/title', {
            title: 'QQ',
            messageSeqs: [],                       // 必填：缺了会写坏会话日志（真机 SessionFormatError）
            source: { kind: 'user' },              // 必填：与 DSH 的 SessionTitleEventData 对齐
          })
          this.qqCreated?.add?.(String(id))
        } catch {
          /* 起名失败不影响建会话 */
        }
        if (agent) this.bindAgent(agent)
        return `已在 ${target.path} 新建 ${shortOf(id)}（今天第 ${used + 1}/${this.maxNewPerWorkspacePerDay} 个）。用 /say 给它第一句话。`
      }
      return `已在 ${target.path} 新建会话（今天第 ${used + 1} 个），但没拿到 id。`
    } catch (err) {
      return `新建失败：${err?.message ?? err}`
    }
  }

  /** `/wake <序号|短id>`（D15）：把未加载的会话挂回进程。只用服务取 agent，不新建。 */
  async wakeSession(arg) {
    if (arg === null || arg === undefined || String(arg) === '') {
      return '要唤醒哪个？/wake <序号|短id>（空参数无效，先发 /list 看列表）。'
    }
    // B8：与 /list 同源过滤，否则 /wake 1 会指向被隐藏的咨询会话
    const hidden = new Set(this.state.consults ?? [])
    const stored = (await listStoredSessions(this.sessionsRoot, this.now())).filter((x) => !hidden.has(x.id))
    let target = null
    if (/^\d+$/.test(String(arg))) {
      const index = Number(arg)
      if (index < 1) return `参数「${arg}」无效：/wake 只接受 /list 里的序号或短 id。`
      target = stored[index - 1]
      if (!target) return `第 ${index} 个任务不存在（当前共 ${stored.length} 个）；发 /list 看列表。`
    } else {
      const key = String(arg).replace(/^session-/, '').toLowerCase()
      target = stored.find((x) => String(x.id).replace(/^session-/, '').toLowerCase().startsWith(key))
      if (!target) return `参数「${arg}」无效：找不到这个会话；发 /list 看短 id。`
    }
    if (this.sessions.has(target.id)) {
      return `${shortOf(target.id)} 已经加载着（${isBusy(this.sessions.get(target.id)?.agent?.session) ? '运行中' : '空闲'}），不用唤醒。`
    }

    const sc = this.getSessionController()
    if (sc === null || sc === undefined) return '拿不到会话服务（sessionController 为空），唤醒不可用。'
    try {
      // DSH 自带的取法：resolveAgent(id) → { agent } 或 { error }
      if (typeof sc.resolveAgent === 'function') {
        const found = await sc.resolveAgent(target.id)
        if (found && found.agent) {
          this.bindAgent(found.agent)
          return `已唤醒 ${(target.title ?? shortOf(target.id)).slice(0, 24)}（${shortOf(target.id)}），状态「空闲」，可以 /say。`
        }
        if (found && found.error) return `唤醒失败：${found.error.message ?? found.error}`
        return '唤醒失败：resolveAgent 没有返回 agent'
      }
      for (const name of ['resume', 'claim']) {
        if (typeof sc[name] === 'function') {
          const agent = await sc[name](target.id)
          if (agent) {
            this.bindAgent(agent)
            return `已唤醒 ${(target.title ?? shortOf(target.id)).slice(0, 24)}（${shortOf(target.id)}），状态「空闲」，可以 /say。`
          }
        }
      }
      const proto = Object.getPrototypeOf(sc)
      const available = proto === null ? [] : Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor').slice(0, 12)
      return `唤醒失败：这个服务没有 resolveAgent/resume。可用方法：${available.join(', ')}`
    } catch (err) {
      return `唤醒失败：${err?.message ?? err}`
    }
  }

  /** `/use <序号|短id>`：把已加载的会话设为 /say 的默认目标。 */
  async useSession(arg) {
    // B8：与 /list 同源过滤
    const hidden = new Set(this.state.consults ?? [])
    const stored = (await listStoredSessions(this.sessionsRoot, this.now())).filter((x) => !hidden.has(x.id))
    let picked = null
    if (/^\d+$/.test(String(arg))) {
      picked = stored[Number(arg) - 1] ?? null
    } else {
      const key = String(arg ?? '').replace(/^session-/, '').toLowerCase()
      picked = stored.find((x) => String(x.id).replace(/^session-/, '').toLowerCase().startsWith(key)) ?? null
    }
    if (!picked) return { ok: false, reason: 'no-such-index' }
    const rec = this.sessions.get(picked.id)
    if (!rec) return { ok: false, reason: 'not-running', id: picked.id }
    this.boundAgent = rec.agent
    return { ok: true, id: picked.id }
  }

  /** 这个 token 看起来像不像会话引用（序号或短 id 前缀）？ */
  async looksLikeSessionRef(token) {
    if (token === null || token === undefined) return false
    const t = String(token)
    if (/^\d+$/.test(t)) return true
    const key = t.replace(/^session-/, '').toLowerCase()
    for (const id of this.sessions.keys()) {
      const full = String(id).toLowerCase()
      if (full === key || full.replace(/^session-/, '').startsWith(key)) return true
    }
    // B5：磁盘上有、但当前未加载的会话，短 id 也该被识别成"目标"，而不是被吞进正文
    try {
      const hidden = new Set(this.state.consults ?? [])
      const stored = (await listStoredSessions(this.sessionsRoot, this.now())).filter((x) => !hidden.has(x.id))
      return stored.some((x) => String(x.id).replace(/^session-/, '').toLowerCase().startsWith(key))
    } catch {
      return false
    }
  }

  /** `/say [<id|序号|短id>] <text>`：先回显"上次停在哪"，再等你确认，才投递。 */
  async startSay(text, data, idArg = null) {
    const open = this.points.list().filter((p) => p.status === 'open')
    if (open.length > 0) {
      await this.send(`还有待答请求没处理（${open.map((p) => p.id).join('、')}），先答复它。`, data.id)
      return
    }
    // B5：给定了显式 id 就不要求先 /use（重启后 boundAgent 为空是常态）
    if ((this.boundAgent === null || this.boundAgent === undefined) && (idArg === null || idArg === undefined)) {
      await this.send('还没有绑定会话：先 /use <序号|短id> 选一个，或在 GUI 里发一句话让它跑起来。', data.id)
      return
    }

    let targetId = String(this.boundAgent?.id ?? this.boundAgent?.session?.id ?? '')
    let agent = this.boundAgent
    if (idArg !== null && idArg !== undefined) {
      const target = await this.resolveTargetId(idArg)
      if (!target?.id) {
        await this.send(`找不到 ${idArg} 这个会话，发 /list 看列表。`, data.id)
        return
      }
      targetId = target.id
      agent = this.#agentFor(target.id)
      if (!agent) {
        await this.send(`${shortOf(target.id)} 没加载：先 /wake <序号|短id> 再 /say。`, data.id)
        return
      }
    }
    if (isBusy(agent?.session)) {
      await this.send('它正在跑（turn 还没结束），现在发进去会打乱它。等它停下来再 /say。', data.id)
      return
    }

    const wp = this.points.create({ kind: 'say', title: '发送到会话', meta: { text, sessionId: targetId } })
    const summary = lastStop(agent?.session)
    await this.send(
      [`[${wp.id}] 将要发送：${text.slice(0, 200)}`,
        `上次停在：${summary}`,
        `改：/ans ${wp.id} 1 发送 ｜ /ans ${wp.id} 2 取消`].join('\n'),
      data.id,
    )
    await this.#persist()
  }

  /** 绑定会话：记住 agent 与它的 id（/list、/progress、/say 都靠这份索引）。 */
  bindAgent(agent) {
    if (agent === null || agent === undefined) return
    this.boundAgent = agent
    const id = String(agent.id ?? agent.session?.id ?? '')
    if (id) this.sessions.set(id, { agent, at: this.now() })
  }

  /** 会话事件 → 咨询答话中继 + 活跃度/turn 状态。由插件把 ctx 的 session/event 转进来。 */
  async onSessionEvent(session, event) {
    await this.trackActivity(session, event)
    const sessionId = String(session?.id ?? '')
    for (const [targetId, entry] of this.consults) {
      if (entry.consultId !== sessionId || entry.pending === null) continue
      if (event?.type === 'assistant/message') {
        const text = extractText(event.data)
        if (text) entry.pending.buffer += (entry.pending.buffer ? '\n' : '') + text
        return
      }
      if (event?.type === 'tool/call') {
        const wrote = writeTargetOf(event.data?.name, event.data?.arguments)
        if (wrote) {
          entry.pending.writes = entry.pending.writes ?? []
          entry.pending.writes.push(wrote)
        }
        return
      }
      if (event?.type === 'turn/end') {
        const answer = entry.pending.buffer.trim() || '（这一轮没有文本输出）'
        const writes = entry.pending.writes ?? []
        const msgId = entry.pending.qqMsgId
        entry.pending = null
        this.#armConsultTimer(targetId, entry)

        const paths = writes.map((w) => w.path).filter(Boolean)
        const writeLine = writes.length === 0
          ? '本次改动：无'
          : `本次改动：${writes.length} 次写操作${paths.length ? '（' + paths.slice(0, 5).join('、') + '）' : ''}`

        // A19′：每一次写操作各写一条审计（上限 50 条，防极端情况撑爆）
        for (const w of writes.slice(0, 50)) {
          await this.audit.append({
            requestId: entry.consultId,
            wpId: entry.consultId,
            openid: null,
            at: this.now(),
            card: { kind: 'consult-write', target: targetId, tool: w.tool },
            evidenceViewed: true,
            outcome: JSON.stringify({ path: w.path }),
          })
        }

        await this.send(
          `关于 ${shortOf(targetId)}（第 ${entry.rounds} 轮）：\n${answer.slice(0, 700)}\n${writeLine}\n— /done ${shortOf(targetId)} 结束｜/why ${shortOf(targetId)} <继续问>`,
          msgId,
        )
        return
      }
    }
  }

  /** 会话事件 → 活跃度/turn 状态 + 空转通知（A24）与 /say 回执。 */
  async trackActivity(session, event) {
    const id = String(session?.id ?? '')
    if (!id) return
    const st = this.sessionState.get(id) ?? { lastAt: 0, turnOpen: false, notified: {} }
    st.session = session
    st.lastType = event?.type
    st.lastAt = this.now()
    if (event?.type === 'turn/start') {
      st.turnOpen = true
      this.state.activeTurns = { ...(this.state.activeTurns ?? {}), [String(id)]: this.now() }
      this.#persist().catch(() => {})
      st.notified = {}
      st.startedAt = this.now()
      st.tools = {}
      st.lastText = ''
    }
    if (event?.type === 'tool/call') {
      const name = String(event.data?.name ?? '工具').slice(0, 24)
      st.tools = st.tools ?? {}
      st.tools[name] = (st.tools[name] ?? 0) + 1
    }
    if (event?.type === 'assistant/message') {
      const text = extractText(event.data)
      if (text) st.lastText = text
    }
    if (event?.type === 'turn/end') {
      st.turnOpen = false
      if (this.state.activeTurns && this.state.activeTurns[String(id)] !== undefined) {
        delete this.state.activeTurns[String(id)]
        this.#persist().catch(() => {})
      }
      // 回执不依赖"是否被监视"：/say 注进去的，一定要把结果带回来
      await this.#relaySayResult(id, st)
      const openHere = this.points.list().some((p) => p.status === 'open')
      if (!st.notified.idle && !openHere && await this.#isWatched(session)) {
        st.notified.idle = true
        this.sessionState.set(id, st)
        if (!this.#present() && this.#noticeBudgetOk()) {
          await this.send(await this.#idleMessage(id, st), null)
        }
      }
    }
    this.sessionState.set(id, st)
  }

  /**
   * A8：通知预算（自然日 ≤ maxNoticesPerDay，默认 10）。
   * 只约束"主动找你"的通知（空闲/停滞）；审批卡片永远不受限。
   */
  /** /mode 的展示文本。 */
  #modeText() {
    const mode = this.#mode()
    const info = this.presence.describe()
    const present = this.#present()
    const idleMs = this.presence.idleMs
    const pendingNote = this.presence.pending > 0 && idleMs !== null && !present && mode === 'auto'
      ? '（检测到你回来了，等下一次采样确认，约 30 秒）'
      : ''
    const until = this.state.mode?.until
    const left = mode === 'pc' && until ? Math.max(0, Math.round((until - this.now()) / 60_000)) : null
    return [
      `模式：${mode === 'pc' ? `静音（还剩 ${left} 分钟）` : mode === 'away' ? '始终推送' : '自动'}`,
      `判定：${present ? '在场（不打扰）' : '离开（会推送）'}${pendingNote}`,
      `依据：空闲 ${info.idleText}`,
      `今日主动推送：${this.state.push?.count ?? 0} 条（A8 自限：正常日 ≤10；审批卡片不受限）`,
      `探针：${this.idleProbeKind}${this.idleProbeKind === 'none' && this.idleProbeReason ? `（${this.idleProbeReason}）` : ''}`,
      ...(info.idleText.startsWith('拿不到') ? ['诊断：', ...probeDiagnostics().map((l) => '· ' + l)] : []),
      mode === 'auto' ? '规则：空闲 < 5 分钟视为在场，≥5 分钟视为离开' : '（手动模式，忽略空闲）',
    ].join('\n')
  }

  /** 离开时把"还等着你做决定"的请求补推出去（跑完/状态类不补）。 */
  async #flushPending(reason) {
    let n = 0
    for (const p of this.points.list()) {
      if (p.status !== 'open') continue
      if (p.meta?.pushedToQQ === true) continue
      p.meta = { ...(p.meta ?? {}), pushedToQQ: true }
      n += 1
      const text = p.meta?.card?.text ?? `[${p.id}] ${p.title ?? '待答请求'}`
      await this.send(`[补发] ${reason}\n${text}`, null)
    }
    if (n > 0) await this.#persist().catch(() => {})
    return n
  }

  /** A20：咨询不可用时的 L1 摘要（只用本地已知信息，不假装调查过）。 */
  async #fallbackSummary(id) {
    const rec = this.sessions.get(id)
    const session = rec?.agent?.session
    const alive = rec !== undefined && rec !== null
    const busy = isBusy(session)
    const open = this.points.list().filter((p) => p.status === 'open').length
    const recent = []
    if (session && typeof session.eventAt === 'function') {
      const end = Number(session.seq ?? 0)
      for (let i = end - 1; i >= 0 && i >= end - 30 && recent.length < 3; i -= 1) {
        const ev = session.eventAt(i)
        if (ev?.type) recent.push(ev.type)
      }
    }
    return [
      `会话 ${shortOf(id)}：${alive ? (busy ? '运行中' : '空闲') : '未加载'}`,
      `待答请求：${open} 个`,
      recent.length ? `最近事件：${recent.join(' → ')}` : '没有可读事件',
      '要看完整现场，请在电脑上打开该会话（桥接只读不到它的完整上下文）。',
    ].join('\n')
  }

  /** 采一次在场；变吵（→离开）立即补推压在手里的待答请求。 */
  async samplePresence() {
    const snap = this.presence.sample()
    if (snap.direction === 'away') {
      await this.#flushPending('你现在离开了，这条先补给你')
    }
    return snap
  }

  /** 当前模式（pc 到期自动回 auto）。 */
  #mode() {
    const m = this.state.mode ?? { mode: 'auto', until: null }
    if (m.mode === 'pc' && m.until !== null && this.now() > m.until) {
      this.state.mode = { mode: 'auto', until: null }
      this.#persist().catch(() => {})
      return 'auto'
    }
    return m.mode
  }

  /** 是否"人在电脑前"：pc 视为在场；away 视为离开；auto 看空闲。 */
  #present() {
    const mode = this.#mode()
    if (mode === 'pc') return true
    if (mode === 'away') return false
    return this.presence.state === PRESENCE.PRESENT
  }

  /** A8：记一条主动推送（卡片与通知都算）。 */
  #countPush() {
    const day = new Date(this.now()).toISOString().slice(0, 10)
    const st = this.state.push ?? { day, count: 0 }
    if (st.day !== day) { st.day = day; st.count = 0 }
    st.count += 1
    this.state.push = st
    return st.count
  }

  #noticeBudgetOk() {
    const day = new Date(this.now()).toISOString().slice(0, 10)
    const st = this.state.notices ?? { day, count: 0 }
    if (st.day !== day) { st.day = day; st.count = 0 }
    if (st.count >= (this.maxNoticesPerDay ?? 10)) {
      this.state.notices = st
      return false
    }
    st.count += 1
    this.state.notices = st
    this.#persist().catch(() => {})
    return true
  }

  /**
   * 哪些会话该发通知（A24/A30）：
   *   - 排除咨询会话（/why 起的）
   *   - 排除子 agent 会话（session 自带 origin / delegationDepth 时直接判；否则查会话库索引，缓存 60s）
   *   - 其余一律发：**不管你有没有 /use 绑它**，长任务在哪个会话跑都能被看见
   */
  async #isWatched(session) {
    const id = String(session?.id ?? '')
    if (!id) return false
    if (new Set(this.state.consults ?? []).has(id)) return false
    for (const entry of this.consults.values()) {
      if (entry.consultId === id) return false
    }

    if (session?.origin === 'subagent' || (session?.delegationDepth ?? 0) > 0) return false

    const now = this.now()
    if (this.watchCache === null || now - this.watchCacheAt > 60_000) {
      try {
        const rows = await listStoredSessions(this.sessionsRoot, now)
        this.watchCache = new Set(rows.map((r) => r.id))
        this.watchRows = new Map(rows.map((r) => [r.id, r]))
      } catch {
        this.watchCache = new Set()
      }
      this.watchCacheAt = now
    }
    // 会话库里查不到（刚建、还没落盘）→ 当作真人会话，宁可多发一条
    if (this.watchCache.size === 0) return true
    return this.watchCache.has(id)
  }

  /** `[标题 · id6]`：标题取投影缓存/会话头，取不到用短 id。 */
  async #label(id) {
    if (this.watchRows === undefined || this.watchRows === null) {
      try {
        const rows = await listStoredSessions(this.sessionsRoot, this.now())
        this.watchRows = new Map(rows.map((r) => [r.id, r]))
        this.watchCache = new Set(rows.map((r) => r.id))
      } catch {
        this.watchRows = new Map()
      }
    }
    const title = this.watchRows.get(id)?.title
    const short = shortOf(id)
    return title ? `[${title.slice(0, 24)} · ${short}]` : `[${short}]`
  }

  /** 本轮做了什么的摘要：优先人话首句，取不到降级成工具统计。 */
  #roundSummary(st) {
    const clean = String(st.lastText ?? '')
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/[#*_`>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const first = (clean.split(/[。！？.!?\n]/).find((x) => x.trim().length > 0) ?? '').trim()
    if (first.length > 0) {
      const clipped = first.length > 80 ? first.slice(0, 79) + '…' : first
      return { kind: 'text', text: clipped }
    }
    const tools = st.tools ?? {}
    const parts = Object.entries(tools)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([name, n]) => `${name} ×${n}`)
    return { kind: 'tools', text: parts.length ? parts.join('、') : '这一轮没有工具调用' }
  }

  #minutes(st) {
    const ms = this.now() - (st.startedAt ?? this.now())
    return Math.max(1, Math.round(ms / 60000))
  }

  async #idleMessage(id, st) {
    const label = await this.#label(id)
    const summary = this.#roundSummary(st)
    const line = summary.kind === 'text' ? summary.text : `工具：${summary.text}`
    return [
      label,
      `本轮 ${this.#minutes(st)} 分钟：${line}`,
      `它停了，等你下一句 ｜ /say ${shortOf(id)} 继续 ｜ /list 全部`,
    ].join('\n')
  }

  async #stallMessage(id, st, idleFor, escalated) {
    const label = await this.#label(id)
    const mins = Math.max(1, Math.round(idleFor / 60000))
    const head = escalated ? `已 ${mins} 分钟没有新输出，可能卡住了` : `已 ${mins} 分钟没有新输出`
    const tail = escalated
      ? `发 /why ${shortOf(id)} 看现场，或直接 /say ${shortOf(id)} 给指令`
      : `发 /why ${shortOf(id)} 看现场`
    return [label, `本轮 ${this.#minutes(st)} 分钟｜${head}`, tail].join('\n')
  }

  /** 由定时器调用；测试也可直接调。返回这一轮发出的通知（便于断言）。 */
  async tick() {
    const sent = []
    await this.samplePresence()

    // A12：两次 tick 间隔异常大 = 设备睡过/被挂起，醒后只发一条摘要
    // 用真实墙钟判断睡眠：注入的假时钟（测试）不应被当成"设备睡过"
    const wall = Date.now()
    const gap = this.lastWallTickAt ? wall - this.lastWallTickAt : 0
    this.lastWallTickAt = wall
    if (gap > 3 * 60_000) {
      const openCount = this.points.list().filter((p) => p.status === 'open').length
      if (!this.#present()) {
        await this.send(`设备睡眠/挂起过约 ${Math.round(gap / 60_000)} 分钟。当前待答 ${openCount} 个（与本地计数一致）。`, null)
      }
    }

    for (const [id, st] of this.sessionState) {
      if (!st.turnOpen) continue
      if (!(await this.#isWatched(st.session))) continue
      // A30：工具调用进行中（还没有后续事件）不算停滞，避免长命令被误报"卡住"
      if (st.lastType === 'tool/call') continue
      const idleFor = this.now() - st.lastAt
      if (idleFor >= this.stallSecondMs && !st.notified.stall2) {
        st.notified.stall2 = true
        if (!this.#present() && this.#noticeBudgetOk()) {
          await this.send(await this.#stallMessage(id, st, idleFor, true), null)
        }
        sent.push(id)
      } else if (idleFor >= this.stallFirstMs && !st.notified.stall1) {
        st.notified.stall1 = true
        if (!this.#present() && this.#noticeBudgetOk()) {
          await this.send(await this.#stallMessage(id, st, idleFor, false), null)
        }
        sent.push(id)
      }
    }
    // A6/D4：待答点 10 分钟、30 分钟各提醒一次（同一请求每档只一次）
    let touched = false
    for (const p of this.points.list()) {
      if (p.status !== 'open') continue
      const age = this.now() - (p.createdAt ?? this.now())
      const meta = p.meta ?? {}
      if (age >= 30 * 60_000 && meta.remind30 !== true) {
        meta.remind30 = true
        p.meta = meta
        touched = true
        if (!this.#present() && this.#noticeBudgetOk()) {
          await this.send(
            `[${p.id}] 已经 30 分钟没人答复了（${p.title ?? '待答请求'}）。\n/ans ${p.id} 1 批准 ｜ /ans ${p.id} 2 拒绝 ｜ /why ${meta.sessionId ? shortOf(meta.sessionId) : p.id} 看现场`,
            null,
          )
        }
      } else if (age >= 10 * 60_000 && meta.remind10 !== true) {
        meta.remind10 = true
        p.meta = meta
        touched = true
        if (!this.#present() && this.#noticeBudgetOk()) {
          await this.send(`[${p.id}] 还没答复（${p.title ?? '待答请求'}，10 分钟了）。`, null)
        }
      }
    }
    // 兜底：静音期间超过 5 分钟仍未答 → 强制推一条（每请求只一次）
    for (const p of this.points.list()) {
      if (p.status !== 'open') continue
      if (p.meta?.pushedToQQ === true) continue
      const age = this.now() - (p.createdAt ?? this.now())
      if (age < 5 * 60_000) continue
      p.meta = { ...(p.meta ?? {}), pushedToQQ: true }
      const text = p.meta?.card?.text ?? `[${p.id}] ${p.title ?? '待答请求'}`
      await this.send(`[补发] 你在电脑前但 5 分钟没有处理，这条先推给你\n${text}`, null)
    }
    if (touched) await this.#persist().catch(() => {})

    return sent
  }

  /**
   * /say 注入后的回执：把这一轮最后一条助手消息带回来。
   * 超过 sayReplyChars 就分片，并告诉用户一共几片、怎么取下一片。
   */
  async #relaySayResult(id, st) {
    const relay = this.sayRelay
    if (!relay || relay.sessionId !== id) return
    this.sayRelay = null

    const raw = String(st.lastText ?? '').trim()
    const full = raw || `（这一轮没有文本输出，工具：${this.#roundSummary(st).text}）`
    const size = Math.max(200, Number(this.sayReplyChars ?? 800))
    const chunks = []
    for (let i = 0; i < full.length; i += size) chunks.push(full.slice(i, i + size))
    if (chunks.length === 0) chunks.push('')

    this.sayPages = { sessionId: String(id), chunks, index: 0 }
    const head = chunks.length > 1 ? `会话 ${shortOf(id)} 回复（1/${chunks.length} 片）：` : `会话 ${shortOf(id)} 回复：`
    const more = chunks.length > 1 ? `\n— 共 ${chunks.length} 片；发 /more ${shortOf(id)} 看下一片` : ''
    await this.send(head + '\n' + chunks[0] + more, null)
  }

  /** /more <id>：取下一片。 */
  async #morePage(idArg, data) {
    const pages = this.sayPages
    if (!pages) {
      await this.send('没有可续看的内容（上一轮已看完或还没收到回复）。', data.id)
      return
    }
    if (idArg && String(idArg).replace(/^session-/, '').toLowerCase() !== pages.sessionId.replace(/^session-/, '').toLowerCase().slice(0, String(idArg).length)) {
      await this.send(`当前续看的是 ${shortOf(pages.sessionId)}；要换会话请重新 /say。`, data.id)
      return
    }
    pages.index += 1
    if (pages.index >= pages.chunks.length) {
      this.sayPages = null
      await this.send('已经到最后一片了。', data.id)
      return
    }
    const total = pages.chunks.length
    const idx = pages.index
    const tail = idx + 1 < total ? `\n— 第 ${idx + 1}/${total} 片；发 /more 继续` : `\n— 第 ${idx + 1}/${total} 片（已是最后一片）`
    await this.send(`会话 ${shortOf(pages.sessionId)} 回复（${idx + 1}/${total} 片）：\n${pages.chunks[idx]}${tail}`, data.id)
  }

  /**
   * approval/request 的 answerer（S3/S6/S21/S38）。
   * 不设桥接侧超时（D10）：没人答就一直等；timeoutMs 只在测试里传。
   * 双通道（C）：有了 next 就让 GUI 同时开跑，谁先答用谁。
   */
  async handleApproval(rawRequest, { timeoutMs, next } = {}) {
    const request = unwrap(rawRequest)
    if (request?.agent === undefined) return 'unavailable'
    this.boundAgent = request.agent

    // S6 实测：审批请求本身不带工具参数；参数要从会话的 tool/call 事件按 callId 反查。
    const args = request.args ?? findToolArgs(request.agent?.session, request.callId)
    // A11：判断"是否在工作区外"必须以该会话自己的 cwd 为根，不能用进程 cwd
    const sessionCwd = request.agent?.session?.header?.cwd
      ?? request.agent?.session?.cwd
      ?? this.workspaceRoot
    const label = classify({
      toolName: request.toolName,
      args,
      workspaceRoot: sessionCwd,
      whitelist: this.toolWhitelist,
    })

    // 先建待答点：去重键按契约取 `callId ?? wp.id`（wp.id 天然跨重启唯一）
    const wp = this.points.create({
      kind: 'approval',
      title: `需要你批准：${request.toolName ?? '未知工具'}`,
      meta: {
        callId: request.callId ?? null,
        toolName: request.toolName ?? null,
        options: ['批准', '拒绝'],
        optionLabels: ['批准', '拒绝'],
        shortId: 1,
        labeled: label.labeled,
        labelReason: label.reason,
        evidenceMissing: label.labeled && !this.#consultAvailable(),
        whyTarget: shortOf(String(request.agent?.id ?? request.agent?.session?.id ?? '')),
        sessionId: String(request.agent?.id ?? request.agent?.session?.id ?? ''),
      },
    })
    await this.#persist()

    // A6：同一请求 24h 内最多推 3 条（连点/重试不该把手机刷爆）
    const key = String(request.callId ?? wp.id)
    const now = this.now()
    const pushed = (this.deliveries.get(key) ?? []).filter((t) => now - t < 86400_000)
    if (pushed.length >= MAX_PUSH_PER_DAY) {
      this.deliveries.set(key, pushed)
      this.points.drop(wp.id, 'push-quota')
      await this.#persist()
      this.log.info?.(`[qq-bridge] ${key} 24h 内已推 ${pushed.length} 条，不再推`)
      return 'unavailable'
    }
    this.deliveries.set(key, [...pushed, now])

    const card = renderCard({
      id: wp.id,
      title: `需要你批准：${request.toolName ?? '未知工具'}`,
      toolName: request.toolName,
      reason: request.reason ?? request.displayReason,
      args: args === undefined ? undefined : JSON.stringify(args).slice(0, 300),
      target: label.reason === 'outside-workspace' ? '工作区外'
        : label.reason === 'escalation' ? '需要提权（沙箱外）'
        : label.reason === null ? '工作区/沙箱范围内'
        : '需人工判断',
      reversible: undefined,   // 不做代理判断：未知就是未知，卡片显示“未判定”（ADR-19 已作废）
      labeled: label.labeled,
      evidenceMissing: wp.meta.evidenceMissing,
      evidenceViewed: wp.meta.evidenceViewed === true,
      whyTarget: wp.meta.whyTarget,
      options: ['批准', '拒绝'],
    })
    wp.meta.card = { text: card.text, labeled: label.labeled, reason: label.reason }
    await this.#queueCard(wp.id, card.text)
    this.log.info?.(`[qq-bridge] 审批已发 ${wp.id}（${request.toolName ?? '?'}，labeled=${label.labeled}），等待答复…`)

    let onAbort = null
    if (request.signal && typeof request.signal.addEventListener === 'function') {
      onAbort = () => { this.points.expire(wp.id) }
      request.signal.addEventListener('abort', onAbort, { once: true })
      if (request.signal.aborted) onAbort()
    }

    // —— 双通道（C）：GUI 同时开跑，谁先答就用谁；没有 next 时行为与旧版一致 ——
    let settled
    if (this.dualChannel && typeof next === 'function') {
      const gui = Promise.resolve()
        .then(() => next())
        .then(
          (v) => ({ by: 'gui', outcome: v }),
          () => ({ by: 'gui', outcome: null }),
        )
      const qq = wp.promise.then((v) => ({ by: 'qq', ...v }), () => null)
      const first = await Promise.race([qq, gui])
      // 只有"真决策"才算 GUI 已答；无桌面 answerer 时瀑布兜底返回的 'unavailable' 不算
      const guiDecided = first !== null && first.by === 'gui'
        && typeof first.outcome === 'string'
        && first.outcome !== 'unavailable'
      if (guiDecided) {
        // 兼容旧词：GUI/旧版本可能仍返回 'allowed'，对外一律输出 allowed-once
        const guiOutcome = first.outcome === 'allowed' ? 'allowed-once' : first.outcome
        // N2：drop 返回 false 表示手机那票已经先结算了——此时以已生效的结局为准
        if (!this.points.drop(wp.id, 'answered-on-gui')) {
          const other = await qq
          return decisionFromOther(other)
        }
        await this.#persist()   // N1：drop 必须落盘，否则重启会把它当成"待答已作废"
        await this.audit.append({
          requestId: String(wp.meta?.callId ?? wp.id),
          wpId: wp.id,
          openid: null,
          at: this.now(),
          card: wp.meta?.card ?? null,
          evidenceViewed: wp.meta?.evidenceViewed === true,
          evidenceMissing: wp.meta?.evidenceMissing === true,
          outcome: JSON.stringify({ via: 'gui', outcome: guiOutcome }),
        })
        if (!this.#present()) this.send(`已在电脑端处理（${guiOutcome}），这条不用再回手机。`, null).catch(() => {})
        return guiOutcome
      }
      settled = first !== null && first.by === 'qq' ? first : await qq
    } else {
      settled = timeoutMs === undefined
        ? await wp.promise
        : await Promise.race([
            wp.promise,
            new Promise((r) => setTimeout(() => r({ status: 'timeout' }), timeoutMs).unref?.()),
          ])
    }

    if (onAbort && request.signal?.removeEventListener) request.signal.removeEventListener('abort', onAbort)

    if (settled?.status === 'expired') {
      await this.#persist()
      return 'cancelled'
    }
    if (settled?.status === 'timeout') {
      this.points.drop(wp.id, 'test-timeout')
      await this.#persist()
      return 'unavailable'
    }
    if (settled?.status === 'dropped') {
      await this.#persist()
      return 'cancelled'
    }
    if (settled?.status !== 'resolved') return 'unavailable'
    const yes = settled.text === '批准' || settled.text === 'yes' || settled.selected?.[0] === '批准'
    return outcomeFromVote(yes ? 'yes' : 'no')
  }

  /**
   * user-questions/request 的 answerer。
   * 只支持**单问题**请求：多问题需要逐题作答与批量提交，本版直接让行（返回 undefined → 上层 next()）。
   */
  async handleQuestion(rawRequest, { timeoutMs, next } = {}) {
    const request = unwrap(rawRequest)
    const questions = request?.questions ?? []
    if (questions.length !== 1) return undefined // 让位给桌面 UI
    if (request?.agent !== undefined) this.boundAgent = request.agent
    const q = questions[0]
    const optionLabels = (q.options ?? []).map((o) => o.label)

    const wp = this.points.create({
      kind: 'question',
      title: q.question,
      meta: { question: q, optionLabels, options: optionLabels, shortId: 1, callId: request.callId ?? null, sessionId: String(request.agent?.id ?? request.agent?.session?.id ?? '') },
    })
    await this.#persist()

    const card = renderQuestionCard({ id: wp.id, question: q })
    wp.meta.card = { text: card.text, kind: 'question', question: q }
    await this.#queueCard(wp.id, card.text)
    await this.#persist()
    this.log.info?.(`[qq-bridge] 问题已发 ${wp.id}，等待回答…`)

    // 同审批：不设桥接侧超时（D10）。timeoutMs 只在测试里传。
    let onAbort = null
    if (request.signal && typeof request.signal.addEventListener === 'function') {
      onAbort = () => { this.points.expire(wp.id) }
      request.signal.addEventListener('abort', onAbort, { once: true })
      if (request.signal.aborted) onAbort()
    }

    // —— 双通道（C）：GUI 同时开跑，谁先答就用谁；没有 next 时行为与旧版一致 ——
    let settled
    if (this.dualChannel && typeof next === 'function') {
      const gui = Promise.resolve()
        .then(() => next())
        .then(
          (v) => ({ by: 'gui', outcome: v }),
          () => ({ by: 'gui', outcome: null }),
        )
      const qq = wp.promise.then((v) => ({ by: 'qq', ...v }), () => null)
      const first = await Promise.race([qq, gui])
      // B4：提问接口的答复是 { answers: [...] }，不是字符串；'unavailable'/null 都表示桌面没答
      const rawAnswers = first !== null && first.by === 'gui' && first.outcome
        && typeof first.outcome === 'object' && Array.isArray(first.outcome.answers)
        ? first.outcome.answers
        : null
      // B4：空数组不算答复（N6）
      const guiAnswers = Array.isArray(rawAnswers) && rawAnswers.length > 0 ? rawAnswers : null
      if (guiAnswers !== null) {
        const picked = guiAnswers[0]
        // N2：手机那票已经先结算时，以它为准，不写第二条审计
        if (!this.points.drop(wp.id, 'answered-on-gui')) {
          const other = await qq
          if (other?.status === 'resolved') {
            return { answers: [{ id: q.id, selected: other.selected ?? [], ...(other.custom !== undefined ? { custom: other.custom } : {}) }] }
          }
          return { answers: [] }
        }
        await this.#persist()   // N1：与审批侧一致，drop 必须落盘
        if (!this.#present()) this.send(`已在电脑端答复（${picked?.selected?.join('/') ?? picked?.custom ?? '已答'}），这条不用再回手机。`, null).catch(() => {})
        await this.audit.append({
          requestId: String(wp.meta?.callId ?? wp.id),
          wpId: wp.id,
          openid: null,
          at: this.now(),
          card: wp.meta?.card ?? null,
          evidenceViewed: wp.meta?.evidenceViewed === true,
          outcome: JSON.stringify({ via: 'gui', answers: guiAnswers }),
        }).catch?.(() => {})
        return { answers: guiAnswers }
      }
      settled = first !== null && first.by === 'qq' ? first : await qq
    } else {
      settled = timeoutMs === undefined
        ? await wp.promise
        : await Promise.race([
            wp.promise,
            new Promise((r) => setTimeout(() => r({ status: 'timeout' }), timeoutMs)),
          ])
    }

    if (onAbort && request.signal?.removeEventListener) request.signal.removeEventListener('abort', onAbort)

    if (settled?.status === 'expired') {
      await this.#persist()
      return undefined
    }
    if (settled?.status === 'timeout') {
      this.points.drop(wp.id, 'test-timeout')
      await this.#persist()
      return undefined
    }
    if (settled?.status !== 'resolved') return undefined

    // 只回一条答案对象：上层拿它当 seam 的返回值（多问题已在上面让位）
    return {
      answers: [{
        id: q.id ?? null,
        selected: Array.isArray(settled.selected) ? settled.selected : [],
        custom: settled.custom ?? null,
        by: settled.by ?? null,
      }],
    }
  }

  /** A17：正常退出前发最后一条（不等回复，最多等 3s）。 */
  async sayGoodbye(reason = '我下班了') {
    if (this.allowlist.size === 0) return false
    const done = this.send(reason, null)
    await Promise.race([done, new Promise((r) => setTimeout(r, 3000).unref?.())])
    return true
  }

  async send(content, msgId) {
    try {
      const used = this.seqByMsgId.get(msgId) ?? 0
      let res
      // B9：官方规则（2026-10-25 核对 bot.q.qq.com）：单聊被动回复有效期 60 分钟、
      // 每条消息最多回复 4 次；相同 msg_id+msg_seq 重复发送会失败。这里按"被回复的
      // 那条 msg_id 的年龄"判断窗口，而不是按"最后一次收到消息的时间"。
      // 55 分钟 < 60 分钟是刻意留的余量；used < 4 与官方"4 次"一致。
      const arrived = msgId ? (this.msgAt?.get(String(msgId)) ?? this.lastMsgAt) : 0
      const withinWindow = arrived === 0 || this.now() - arrived < 55 * 60_000
      if (msgId && used < 4 && withinWindow) {
        const seq = used + 1
        this.seqByMsgId.set(msgId, seq)
        try {
          res = await this.client.sendPassive({ userOpenId: [...this.allowlist][0], msgId, msgSeq: seq, content })
        } catch (err) {
          // B9：被动失败不再只记日志——立刻用主动消息兜底，否则卡片静默丢失
          this.log.error?.(`[qq-bridge] passive 失败，转主动：${err?.message ?? err}`)
          res = await this.client.sendProactive({ userOpenId: [...this.allowlist][0], content })
        }
      } else {
        res = await this.client.sendProactive({ userOpenId: [...this.allowlist][0], content })
      }
      if (msgId === null || msgId === undefined) this.#countPush()
      this.runLog?.write({ dir: 'out', kind: 'send', openid: this.lastInboundOpenid ?? null, requestId: this.lastInboundRequestId ?? null, detail: String(content ?? '').slice(0, 80) })
      this.log.info?.(`[qq-bridge] 已发送 ${res?.id ?? ''}`)
      return res
    } catch (err) {
      this.failedSends += 1
      if (this.firstFailedAt === null) this.firstFailedAt = this.now()
      this.runLog?.write({ dir: 'err', kind: 'send-failed', detail: String(err?.message ?? err).slice(0, 120) })
      this.log.error?.(`[qq-bridge] 发送失败: ${err?.message ?? err}`)
      return null
    }
  }
}
