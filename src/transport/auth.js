/**
 * token 管理：换 access_token、缓存、到期前刷新。
 * fetch 可注入，测试用假实现。
 */
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'
const SAFETY_MS = 60_000

export class TokenStore {
  #appId
  #appSecret
  #fetch
  #token = null
  #expiresAt = 0
  #inflight = null

  constructor({ appId, appSecret, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
    if (!appId || !appSecret) throw new Error('TokenStore: appId/appSecret required')
    this.#appId = appId
    this.#appSecret = appSecret
    this.#fetch = fetchImpl
    this.now = now
  }

  get expiresAt() {
    return this.#expiresAt
  }

  async get() {
    if (this.#token && this.now() < this.#expiresAt - SAFETY_MS) return this.#token
    if (this.#inflight) return this.#inflight
    this.#inflight = this.#refresh().finally(() => {
      this.#inflight = null
    })
    return this.#inflight
  }

  async #refresh() {
    const res = await this.#fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appId: this.#appId, clientSecret: this.#appSecret }),
    })
    if (!res.ok) throw new Error(`token http ${res.status}`)
    const json = await res.json()
    if (!json.access_token) throw new Error(`token missing: ${JSON.stringify(json).slice(0, 200)}`)
    this.#token = json.access_token
    this.#expiresAt = this.now() + Number(json.expires_in ?? 7200) * 1000
    return this.#token
  }
}

export function header(token) {
  return { Authorization: `QQBot ${token}` }
}
