/**
 * qq-bridge · 插件入口
 *
 * S1：只占住 `approval/request`，给固定结果（证明接缝是我们的）。
 * S3：配置了 transport 时，改成"发卡片 → 等你回话 → resolve"。
 *
 * 接缝签名（dsh-tool-cordis 的 api-catalog）：
 *   'approval/request'(this: Scoped<Agent>, req: ApprovalRequestEvent,
 *                      next: () => Promise<ApprovalOutcome>): Promise<ApprovalOutcome>
 */
function pick(fns) {
  for (const fn of fns) {
    try {
      const v = fn()
      if (v !== undefined && v !== null) return v
    } catch {
      /* ignore */
    }
  }
  return null
}

export const name = 'qq-bridge'

export const inject = []

/** S1 的可观测痕迹：测试与 doctor 都靠它判断"到底有没有接管"。 */
export const trace = []

let bridge = null

export function getBridge() {
  return bridge
}

const OUTCOMES = new Set(['allowed', 'rejected', 'cancelled', 'unavailable'])

function normalize(value) {
  return OUTCOMES.has(value) ? value : 'rejected'
}

export function apply(ctx, config = {}) {
  const fallbackOutcome = normalize(config.s1DefaultOutcome ?? 'rejected')
  console.error('[qq-bridge] apply() loaded; s1DefaultOutcome=' + fallbackOutcome)

  // 只有"配置齐全"才接管审批：appId + 至少一个白名单。
  // 配置不全时宁可不注册 answerer（让 DSH 回退到桌面 UI），也不能把审批吞进一个不会回话的桥接。
  const transportReady = Boolean(config.transport?.appId && (config.transport?.allowlist ?? []).length > 0)

  if (transportReady) {
    // 延迟 import：没配通道时不让插件把 QQ 那套也拖进来
    import('../src/app/bridge.js')
      .then(({ Bridge }) => {
        bridge = new Bridge({
          getAgents: () => pick([() => ctx.get?.('agents'), () => ctx.agents, () => ctx.get?.('agent')]),
          probeServices: () => ({
            agents: pick([() => ctx.get?.('agents'), () => ctx.agents]),
            sessions: pick([() => ctx.get?.('sessions'), () => ctx.sessions]),
            sessionController: pick([() => ctx.get?.('sessionController'), () => ctx.sessionController, () => ctx.get?.('session')?.controller, () => ctx.session?.controller]),
            sessionQuery: pick([() => ctx.get?.('sessionQuery'), () => ctx.sessionQuery]),
            agentLoop: pick([() => ctx.get?.('agentLoop'), () => ctx.agentLoop]),
          }),
          getSessionController: () => pick([() => ctx.get?.('sessionController'), () => ctx.sessionController, () => ctx.get?.('session')?.controller, () => ctx.session?.controller]),
          appId: config.transport.appId,
          appSecret: config.transport.appSecret,
          allowlist: config.transport.allowlist ?? [],
          mergeMs: config.mergeMs ?? 1500,
          maxNewPerWorkspacePerDay: config.newPerWorkspacePerDay ?? 10,
        })
        return bridge.start()
      })
      .catch((err) => console.error('[qq-bridge] transport 启动失败: ' + (err?.message ?? err)))
  }

  ctx.on('approval/request', async (request, next) => {
    if (request === undefined || request.agent === undefined) return next()

    if (bridge !== null) {
      // 双通道（C）：先放行给 GUI（next），同时发 QQ，谁先答用谁
      const outcome = normalize(await bridge.handleApproval(request, { next: () => next() }))
      trace.push({
        at: Date.now(),
        toolName: request.toolName ?? null,
        callId: request.callId ?? null,
        outcome,
        via: 'qq',
      })
      return outcome
    }

    trace.push({
      at: Date.now(),
      toolName: request.toolName ?? null,
      callId: request.callId ?? null,
      outcome: fallbackOutcome,
      via: 's1-fallback',
    })
    return fallbackOutcome
  })

  ctx.on('user-questions/request', async (request, next) => {
    if (bridge === null) return next()
    const answered = await bridge.handleQuestion(request)
    return answered ?? next()
  })

  // 绑定会话：等审批/提问来绑太被动（新会话永远绑不上）。
  // 改为从 agent 状态事件里认出"最近活跃的 agent"——dsh-acp 用的是同一签名。
  ctx.on('agent/status', (payload) => {
    if (bridge !== null && payload?.agent !== undefined) bridge.bindAgent(payload.agent)
  })

  const ticker = setInterval(() => { bridge?.tick?.().catch(() => {}) }, 60_000)
  const wd = setInterval(() => { bridge?.client?.recoverIfStale?.() }, 10_000)
  wd.unref?.()
  ticker.unref?.()

  ctx.on('session/event', (session, event) => {
    if (bridge !== null) bridge.onSessionEvent(session, event).catch(() => {})
  })

  ctx.on('dispose', () => {
    trace.push({ at: Date.now(), disposed: true })
    const b = bridge
    bridge = null
    if (b !== null) {
      // A17：退出前说一声；发不出去也不阻塞退出
      b.sayGoodbye?.('我下班了（桥接退出）').finally(() => b.client?.stop?.())
    }
  })
}

export default apply
