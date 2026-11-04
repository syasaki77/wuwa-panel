/**
 * 绑定信息存取（redis，不落文件）
 * key: wuwa:bind:<userId>
 * value: { token, did, roles: [{ roleId, serverId, roleName, serverName }], updatedAt }
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PREFIX = 'wuwa:bind:'
const SELF_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * 共用同一份绑定的账号：<别名 QQ> → <主账号 QQ>
 * 别名账号不用单独 `#鸣潮绑定`，读写全部落到主账号的 key 上。
 *
 * 真实 QQ 号不进仓库：本地写 data/bind-alias.json（已在 .gitignore），
 * 或者用环境变量 WUWA_BIND_ALIAS 传同样结构的 JSON。
 */
let BIND_ALIAS = {}
try {
  BIND_ALIAS = JSON.parse(readFileSync(join(SELF_DIR, '../data/bind-alias.json'), 'utf8'))
} catch {
  try {
    BIND_ALIAS = JSON.parse(process.env.WUWA_BIND_ALIAS || '{}')
  } catch {
    BIND_ALIAS = {}
  }
}
const resolveUser = (userId) => BIND_ALIAS[String(userId)] || String(userId)

export const Store = {
  async get(userId) {
    try {
      const raw = await redis.get(PREFIX + resolveUser(userId))
      if (!raw) return null
      return JSON.parse(raw)
    } catch {
      return null
    }
  },

  async save(userId, data) {
    await redis.set(PREFIX + resolveUser(userId), JSON.stringify(data))
  },

  async remove(userId) {
    await redis.del(PREFIX + resolveUser(userId))
  },
}

/** 日志脱敏：前 6 后 4，其它打星号 */
export function maskToken(token) {
  if (!token) return '(空)'
  const s = String(token)
  if (s.length <= 12) return '***'
  return s.slice(0, 6) + '****' + s.slice(-4)
}

/**
 * 已装备武器的持久缓存（redis hash，按玩家 UID 分桶）
 * key: wuwa:weapons:<玩家UID>
 * field: <角色ID> → { name, icon, star, reson, at }
 *
 * 用途：库街区风控/限流时 getRoleDetail 会回空，这时沿用上一次成功查到的武器，
 * 别让列表页的武器图标一会儿有一会儿没有。
 */
const WPN_PREFIX = 'wuwa:weapons:'

export const WeaponStore = {
  /** 取某个玩家的全部武器缓存，坏条目跳过 */
  async load(playerId) {
    const out = {}
    if (!playerId) return out
    try {
      const all = await redis.hgetall(WPN_PREFIX + playerId)
      for (const [id, raw] of Object.entries(all || {})) {
        try {
          out[id] = JSON.parse(raw)
        } catch {
          /* 坏条目直接忽略，后面会重新查 */
        }
      }
    } catch {
      /* redis 不可用时当没有缓存 */
    }
    return out
  },

  /** 写单条（只在真的查到武器时调用，空结果不覆盖旧缓存） */
  async save(playerId, roleId, data) {
    if (!playerId || !roleId || !data) return
    try {
      await redis.hset(WPN_PREFIX + playerId, { [roleId]: JSON.stringify({ ...data, at: Date.now() }) })
    } catch {
      /* 缓存写失败不影响出图 */
    }
  },
}
