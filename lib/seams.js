/**
 * 接缝处理器（可单测）
 *
 * 从 lib/index.js 抽出来，是为了让"是否占住瀑布"能被离线测试证明：
 * 之前 apply() 里直接内联，测试只能靠 Electron 起真插件，等于没有证据（审计 P0-2）。
 */

/** 审批接缝：拿到桥接就用桥接（双通道），没拿到就让行给下一个 answerer。 */
export function makeApprovalHandler({ getBridge, nextOf, onTrace } = {}) {
  return async function approvalHandler(request, next) {
    if (request === undefined || request.agent === undefined) return next()
    const bridge = getBridge?.() ?? null
    if (bridge === null) return undefined            // 桥接未就绪 → 交给桌面
    const outcome = await bridge.handleApproval(request, { next: () => next() })
    onTrace?.({ toolName: request.toolName ?? null, callId: request.callId ?? null, outcome, via: 'qq' })
    return outcome
  }
}

/** 提问接缝：桥接未就绪时让行；已中止的请求不再二次调用桌面。 */
export function makeQuestionHandler({ getBridge } = {}) {
  return async function questionHandler(request, next) {
    const bridge = getBridge?.() ?? null
    if (bridge === null) return next()
    const answered = await bridge.handleQuestion(request, { next })
    if (request?.signal?.aborted) return undefined
    return answered === undefined ? next() : answered
  }
}
