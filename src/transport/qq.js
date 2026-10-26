/**
 * QQ 官方机器人 · WebSocket 长连 + 被动回复。
 *
 * 只做 S2 需要的事：连、认、心跳、收事件、发一条被动消息、断线重连。
 * 所有外部依赖（WebSocket / fetch / token）都可注入，便于脱网测试。
 */

const API = 'https://api.sgroup.qq.com'
const OP = { DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RECONNECT: 7, INVALID_SESSION: 9, HELLO: 10 }

export class QQClient {
  #token
  #ws
  #hb
  #seq = null
  #handlers = new Map()
  #stopped = false
  #attempt = 0
  #state = 'idle'
  #lastFrameAt = 0
  #hbMs = 41_250
  #staleClosed = false
  #hadReady = false

  constructor({
    tokenStore,
    intents = (1 << 0) | (1 << 25),
    WebSocketImpl = globalThis.WebSocket,
    fetchImpl = globalThis.fetch,
    apiBase = API,
    log = console,
    reconnectBaseMs = 1000,
    reconnectMaxMs = 60_000,
  }) {
    if (!tokenStore) throw new Error('QQClient: tokenStore required')
    this.#token = tokenStore
    this.intents = intents
    this.WS = WebSocketImpl
    this.fetch = fetchImpl
    this.apiBase = apiBase
    this.log = log
    this.reconnectBaseMs = reconnectBaseMs
    this.reconnectMaxMs = reconnectMaxMs
  }

  get state() {
    return this.#state
  }

  on(type, fn) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, [])
    this.#handlers.get(type).push(fn)
    return () => {
      const list = this.#handlers.get(type) ?? []
      const i = list.indexOf(fn)
      if (i >= 0) list.splice(i, 1)
    }
  }

  #emit(type, payload) {
    for (const fn of this.#handlers.get(type) ?? []) {
      try {
        fn(payload)
      } catch (err) {
        this.log.error?.(`[qq-bridge] handler ${type} threw: ${err?.message ?? err}`)
      }
    }
  }

  async start() {
    this.#stopped = false
    await this.#connect()
  }

  async stop() {
    this.#stopped = true
    clearInterval(this.#hb)
    this.#hb = undefined
    try {
      this.#ws?.close?.()
    } catch {
      /* ignore */
    }
    this.#state = 'idle'
  }

  async #connect() {
    this.#state = 'connecting'
    try {
      const token = await this.#token.get()
      const res = await this.fetch(`${this.apiBase}/gateway`, {
        headers: { Authorization: `QQBot ${token}` },
      })
      if (!res.ok) throw new Error(`gateway http ${res.status}`)
      const { url } = await res.json()

      const ws = new this.WS(url)
      this.#ws = ws
      ws.addEventListener('open', () => this.log.info?.('[qq-bridge] ws open'))
      ws.addEventListener('message', (ev) => this.#onFrame(ev, token))
      ws.addEventListener('error', (err) => this.#emit('error', err))
      ws.addEventListener('close', (ev) => this.#onClose(ev))
    } catch (err) {
      this.#emit('error', err)
      this.#scheduleReconnect()
    }
  }

  #onFrame(ev, token) {
    let frame
    try {
      frame = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data))
    } catch {
      return
    }
    this.#lastFrameAt = Date.now()
    const { op, t, d, s } = frame
    if (typeof s === 'number') this.#seq = s

    if (op === OP.HELLO) {
      const interval = d?.heartbeat_interval ?? 41_250
      this.#hbMs = interval
      this.#ws.send(JSON.stringify({ op: OP.IDENTIFY, d: { token: `QQBot ${token}`, intents: this.intents, shard: [0, 1], properties: {} } }))
      clearInterval(this.#hb)
      this.#hb = setInterval(() => {
        this.#ws?.send?.(JSON.stringify({ op: OP.HEARTBEAT, d: this.#seq }))
      }, interval)
      return
    }
    if (op === OP.DISPATCH) {
      if (t === 'READY') {
        this.#attempt = 0
        this.#state = 'ready'
        this.#lastFrameAt = Date.now()
        // 已经 READY 过又回到 READY = 重连成功（普通断网或看门狗触发），都要告知
        if (this.#hadReady || this.#staleClosed) {
          const stale = this.#staleClosed
          this.#staleClosed = false
          this.#emit('recovered', { afterMs: this.#hbMs * 2, stale })
        }
        this.#hadReady = true
        this.#emit('ready', d)
        return
      }
      this.#emit('event', { type: t, data: d })
      return
    }
    if (op === OP.INVALID_SESSION) {
      this.#emit('error', new Error('invalid session (token 或 intents 被拒)'))
      return
    }
    if (op === OP.RECONNECT) {
      this.#emit('error', new Error('server requested reconnect'))
      this.#ws?.close?.()
    }
  }

  #onClose(ev) {
    clearInterval(this.#hb)
    this.#hb = undefined
    this.#state = 'closed'
    this.#emit('closed', ev)
    if (!this.#stopped) this.#scheduleReconnect()
  }

  #scheduleReconnect() {
    const delay = Math.min(this.reconnectBaseMs * 2 ** this.#attempt, this.reconnectMaxMs)
    this.#attempt += 1
    this.log.info?.(`[qq-bridge] reconnect in ${delay}ms (attempt ${this.#attempt})`)
    setTimeout(() => {
      if (!this.#stopped) this.#connect()
    }, delay).unref?.()
  }

  /**
   * A14 看门狗：超过 2 个心跳周期没收到任何帧，就认定"活着但不回话"，
   * 主动断开让重连逻辑接手。返回是否触发了恢复。
   */
  recoverIfStale(now = Date.now(), factor = 2) {
    if (this.#state !== 'ready') return false
    const limit = this.#hbMs * factor
    if (this.#lastFrameAt === 0 || now - this.#lastFrameAt < limit) return false
    this.#staleClosed = true
    this.#emit('error', new Error(`stale: ${now - this.#lastFrameAt}ms 无帧，主动重连`))
    try {
      this.#ws?.close?.()
    } catch {
      /* ignore */
    }
    return true
  }

  /** 被动回复：必须带收到的 msg_id；单聊 60 分钟内、每条最多 4 次（msg_seq 必须递增）。 */
  async sendPassive({ userOpenId, msgId, content, msgSeq = 1 }) {
    return this.#postMessage(userOpenId, { content, msg_type: 0, msg_id: msgId, msg_seq: msgSeq })
  }

  /** 主动消息：不带 msg_id。实测可用；频控与"用户可关闭"见 F6。 */
  async sendProactive({ userOpenId, content }) {
    return this.#postMessage(userOpenId, { content, msg_type: 0 })
  }

  async #postMessage(userOpenId, body) {
    const token = await this.#token.get()
    const res = await this.fetch(`${this.apiBase}/v2/users/${userOpenId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `QQBot ${token}` },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(`send http ${res.status}: ${text.slice(0, 200)}`)
    return JSON.parse(text)
  }
}
