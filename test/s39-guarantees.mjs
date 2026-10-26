import './_setup.mjs'
/**
 * 代码层面的"实测问题"防回归清单。
 *
 * 每一条都对应一次真机上暴露过的故障，或一次对已签需求的偏离处理。
 * 这些都是**行为契约**：谁改坏了，这里先红。
 */
import fs from 'node:fs'

const failures = []
const check = (label, ok, detail = '') => {
  console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  — ' + detail : ''))
  if (!ok) failures.push(label)
}

const bridge = fs.readFileSync('src/app/bridge.js', 'utf8')
const index = fs.readFileSync('lib/index.js', 'utf8')
const envelope = fs.readFileSync('src/transport/envelope.js', 'utf8')

// 1) /wake 必须走 sessionController.resolveAgent（真机报过错：resume 不存在）
check('/wake 用 resolveAgent', bridge.includes('resolveAgent'))
check('/wake 失败时报出可用方法', /可用方法/.test(bridge))

// 2) /new 必须传 workspaceId（否则 GUI 归到"未分组"）
check('/new 传 workspaceId', /workspaceId/.test(bridge))
check('/new 不再只传 cwd', !/createFn\(\{\s*cwd:/.test(bridge))

// 3) /say 必须优先 followup（inject 只入队不唤醒，真机上表现为"没动静"）
check('投递优先 followup', /followup/.test(bridge) && /deliverToAgent/.test(bridge))

// 4) session/title 事件形状必须完整（真机报过 SessionFormatError）
check('title 事件带 messageSeqs', /messageSeqs/.test(bridge))
check('title 事件带 source', /source:\s*\{\s*kind:/.test(bridge))

// 5) 审批双通道：GUI 与 QQ 同时，谁先答用谁
check('审批接受 next（GUI 通道）', /handleApproval\([^)]*next/.test(bridge))
check('GUI 先答会清理待答点', bridge.includes('answered-on-gui'))
check('GUI 之后 reject 被吞（不影响 QQ 结果）', /by: 'gui', outcome: null/.test(bridge))
check('lib 把 next 传给 bridge', /handleApproval\(request, \{ next/.test(index + (fs.existsSync('lib/seams.js') ? fs.readFileSync('lib/seams.js', 'utf8') : '')))

// 6) 短 id：统一由 shortOf 处理，不再截完整 session id
check('存在 shortOf', /function shortOf/.test(bridge))
check('不再截取完整 session id', !/String\((?:id|target\.id|targetId)\)\.slice\(0, 8\)/.test(bridge))

// 7) 新建配额默认 10（人类裁定）
check('配额默认 10', /maxNewPerWorkspacePerDay\s*=\s*10/.test(bridge))
check('配额可配置', /newPerWorkspacePerDay/.test(index))

// 8) /list 页脚状态正确（真机上写反过：说"只有运行中才能 /say"）
check('/list 页脚：空闲才能 /say', bridge.includes('「空闲」才能 /say'))
check('/list 页脚：未加载先 /wake', /「未加载」先 \/wake/.test(bridge))

// 9) 提示语不得教用户发裸数字（真机连续三次）
check('无"回复序号/回复 1"类引导', !/回复序号|回复\s*[1-9１-９]\s*(?:批准|发送|取消)/.test(bridge + envelope))
check('确认类提示带 /ans 命令', /\/ans \$\{wp\.id\} 1 发送/.test(bridge))

// 10) 会话标题只加 QQ 前缀
check('新建标题为 QQ', /title: 'QQ'/.test(bridge))

// 11) UserMessage 形状（少了 role 会被静默丢弃）
check('userMessage 带 role', /role: 'user'/.test(bridge))
check('userMessage 带 id', /randomUUID/.test(bridge))

console.log('\n' + (failures.length === 0 ? 'S39 PASS' : 'S39 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
