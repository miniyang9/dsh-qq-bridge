import './_setup.mjs'
/**
 * 纯数字短 id 的歧义（回归）
 * 场景：某个会话短 id 恰好是 6 位纯数字，/use 123456、/say 012345 必须命中它，不能当序号。
 */
const failures = []
const check = (l, ok, d = '') => { console.log((ok ? 'PASS  ' : 'FAIL  ') + l + (d ? '  — ' + d : '')); if (!ok) failures.push(l) }
const { resolveStoredTarget } = await import('../src/core/resolve.js')

const shortOf = (id) => String(id ?? '').replace(/^session-/, '').slice(0, 6)
const stored = [
  { id: 'session-000001-aaaa', cwd: 'C:/w1', title: '零开头' },
  { id: 'session-123456-bbbb', cwd: 'C:/w2', title: '纯数字' },
  { id: 'session-7f9dea-cccc', cwd: 'C:/w3', title: '十六进制' },
]

// 1) 纯数字短 id 精确命中，而不是被当成第 123456 项
check('123456 命中纯数字会话', resolveStoredTarget(stored, '123456', shortOf)?.id === 'session-123456-bbbb')
check('012345... 前导零保留', resolveStoredTarget(stored, '000001', shortOf)?.id === 'session-000001-aaaa',
  JSON.stringify(resolveStoredTarget(stored, '000001', shortOf)))

// 2) 短参数仍按序号
check('1 = 第 1 项', resolveStoredTarget(stored, '1', shortOf)?.id === 'session-000001-aaaa')
check('2 = 第 2 项', resolveStoredTarget(stored, '2', shortOf)?.id === 'session-123456-bbbb')

// 3) ≥6 位数字前缀
check('7f9dea 前缀命中', resolveStoredTarget(stored, '7f9dea', shortOf)?.id === 'session-7f9dea-cccc')

// 4) 不存在的 6 位数字 → 不回退成序号
check('999999 不存在 → null', resolveStoredTarget(stored, '999999', shortOf) === null,
  JSON.stringify(resolveStoredTarget(stored, '999999', shortOf)))

// 5) wp-N 不能当会话
check('wp-1 返回 null', resolveStoredTarget(stored, 'wp-1', shortOf) === null)

// 6) 未入库的新会话 token 原样返回
check('未知 token 原样返回', resolveStoredTarget(stored, 'abc123', shortOf)?.id === 'abc123')

console.log('\n' + (failures.length === 0 ? 'S58 PASS' : 'S58 FAIL') + ' (' + failures.length + ')')
process.exit(failures.length === 0 ? 0 : 1)
