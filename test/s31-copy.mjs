import './_setup.mjs'
/**
 * 文案一致性检查（静态）：
 *  - 不再出现"回复 1 / 只有运行中才能 /say"这类与 D21 冲突的引导
 *  - 帮助与提示覆盖全部已实现命令
 */
import fs from 'node:fs'

const failures = []
const check = (label, ok, detail = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + label + (detail ? '  — ' + detail : '')); if (!ok) failures.push(label) }

const bridge = fs.readFileSync('src/app/bridge.js', 'utf8')
const envelope = fs.readFileSync('src/transport/envelope.js', 'utf8')
const all = bridge + envelope

// 1) 不得再教用户发裸数字
check('无「回复 1」类裸数字引导', !/回复\s*[1-9１-９]|回\s*[1-9]\s*发送/.test(all))
check('无「只有运行中才能 /say」的错误说法', !/只有["「]?运行中/.test(all))

// 2) /list 页脚必须说清三种状态与 /say 的关系
check('/list 页脚说明「空闲」才能 /say', bridge.includes('「空闲」才能 /say'))
check('/list 页脚说明未加载要先 /wake', bridge.includes('「未加载」先 /wake'))

// 3) 帮助覆盖全部命令
for (const cmd of ['/list', '/progress', '/new', '/use', '/wake', '/say', '/why', '/done', '/ans', '/yes', '/no']) {
  check(`帮助里有 ${cmd}`, all.includes(cmd))
}

// 4) 提示里不再出现只有"序号"的写法（短 id 也支持）
const seqOnly = (bridge.match(/<序号>/g) ?? []).length
check('提示里普遍写成 序号|短id', seqOnly <= 2, `仍出现 <序号> ${seqOnly} 处`)

// 5) 已废弃的"还没开放"文案不得残留
check('无残留的「还没开放」', !bridge.includes('还没开放'))

// 6) 不再用完整 session id 拼接回话（应走 shortOf）
const fullIds = (bridge.match(/String\((?:id|target\.id|targetId)\)\.slice\(0, 8\)/g) ?? []).length
check('回话里不再截取完整 session id', fullIds === 0, `仍 ${fullIds} 处`)

console.log('\n' + (failures.length === 0 ? 'S31 PASS' : 'S31 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
