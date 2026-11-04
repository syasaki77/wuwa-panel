/**
 * 鸣潮面板插件（库街区数据）
 *
 * 命令：
 *   #鸣潮绑定<token>       绑定库街区 token（群聊 / 私聊都可用）
 *   #更新鸣潮面板          更新默认角色的面板
 *   #更新<角色名>角色面板   更新指定角色（全名 / 别名）
 *   #<角色名>面板          同上（和原神面板共用，原神有同名角色时让位给 miao）
 *   #<角色名>面板 <UID>    查别的玩家：自己的 b-at + 对方 roleId 取数据，对方需开启数据展示
 */
import fs from 'node:fs'
import path from 'node:path'
import {
  sdkLogin,
  sendSmsCode,
  getBoundRoles,
  requestAccessToken,
  getRoleData,
  getRoleDetail,
  refreshData,
  randomDeviceCode,
} from './lib/kuro.js'
import { solveGeetest } from './lib/geetest.js'
import { Store, WeaponStore, maskToken } from './lib/store.js'
import { lookupRole, normName } from './lib/alias.js'
import { buildPanelData, buildListData } from './lib/panel.js'
import { renderPanel, renderRoleList } from './lib/render.js'
import { findTalentRole, renderTalent } from './lib/talent.js'
import { findChainRole, renderChain } from './lib/chain.js'

const RE_BIND = /^#鸣潮绑定\s*(.*)$/
/** 同一用户 60 秒内只发一次码，别把短信接口刷爆 */
const SEND_COOLDOWN = new Map()
/**
 * 发码成功后的「等验证码」状态：userId → { mobile, masked, device, expireAt }。
 * 用户收到短信直接把验证码发过来就能绑定，不用再带手机号和前缀。
 */
const PENDING = new Map()
const PENDING_TTL = 10 * 60 * 1000
const RE_PHONE = /^1[3-9]\d{9}$/
const RE_CODE = /^\d{4,8}$/
const RE_ALL = /^#更新鸣潮面板(?:\s*(\d{6,12}))?$/
/**
 * 单角色面板：#更新散华角色面板 / #散华面板 / #散华面板 100000002
 * 第二组是可选的目标 UID（查别的玩家）：只用已登录 token 换的 b-at + 对方 roleId 取数据。
 */
const RE_ONE = /^#更新(?!鸣潮面板)(.+?)角色面板(?:\s*(\d{6,12}))?$/
/**
 * 简写：#锁冥面板 / #锁冥角色面板 也认（主人习惯不带「更新」）
 * 负向前瞻除了「更新 / 鸣潮绑定」，还要排除「星铁 / 原神 / 米游社」：
 * TRSS 的 loader 会把 `*xx` 改写成 `#星铁xx`（星铁命令前缀），
 * 以前 `*更新面板` 会变成 `#星铁更新面板` 被这里当成「角色名=星铁更新」抢走，
 * 导致星铁命令先跑一遍库街区请求再让位——现在直接放行给 miao。
 */
const RE_ONE_SHORT = /^#(?!(?:更新|鸣潮绑定|星铁|原神|米游社))(.+?)(?:角色)?面板(?:\s*(\d{6,12}))?$/

/** 绑定引导文案 */
const BIND_HELP = [
  '库街区绑定，两步走：',
  '1. 只发手机号，机器人自己过滑块、给你发验证码',
  '#鸣潮绑定 13800001111',
  '2. 收到短信后，直接把验证码发我（只发数字就行）',
  '123456',
  '',
  '验证码十分钟内有效；建议私聊发，群里手机号别人看得见。',
].join('\n')

/** 从 roleData 里取角色数组（字段名做兼容） */
function pickRoleList(data) {
  if (Array.isArray(data)) return data
  if (!data || typeof data !== 'object') return []
  return data.roleList || data.roles || data.roleData?.roleList || data.roleData?.roles || []
}

/** 角色名的各种可能字段 */
function roleName(role) {
  return role?.roleName || role?.name || role?.role?.roleName || role?.characterName || ''
}

function roleIdOf(role) {
  return role?.roleId || role?.id || role?.role?.roleId || ''
}

function characterIdOf(role) {
  return role?.characterId || role?.id || role?.roleId || role?.role?.characterId || ''
}

/**
 * 乱码嗅探：redis 里的角色名 / 服务器名偶尔会被写坏（UTF-8 字节被当 GBK 解码，
 * 例如「零氪夏夏」→「闆舵蔼澶忓」、「鸣潮」→「楦ｆ疆」）。
 * 正常玩家昵称和「国服」里基本不可能出现这些字，命中就认为脏了、重新拉一次。
 */
const MOJIBAKE_HINT = /[闆舵蔼澶忓楦鍞鏄鐨鎴涓绉銆鎬鏂锛]/

function looksMojibake(s) {
  return MOJIBAKE_HINT.test(String(s || ''))
}

/** 库街区把国服的 serverName 写成「鸣潮」，面板上显示「国服」更直观 */
function normServerName(name) {
  const s = String(name || '').trim()
  if (!s || s === '鸣潮') return '国服'
  return s
}

/**
 * 原神 / 星铁的角色名集合（角色目录名 + name + abbr 简称）。
 * `#xx面板` 和 miao 的面板指令共用：对面有同名角色就让位（return false），
 * 免得把原神面板抢成鸣潮的。数据直接读 miao 的 meta 目录，不依赖它的模块。
 */
let __otherCharNames = null
function otherGameCharNames() {
  if (__otherCharNames) return __otherCharNames
  const set = new Set()
  for (const game of ['gs', 'sr']) {
    const root = path.join(process.cwd(), `plugins/miao-plugin/resources/meta-${game}/character`)
    try {
      for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
        if (!ent.isDirectory()) continue
        set.add(ent.name)
        try {
          const j = JSON.parse(fs.readFileSync(path.join(root, ent.name, 'data.json'), 'utf8'))
          if (j.name) set.add(String(j.name))
          for (const a of [].concat(j.abbr || [])) if (typeof a === 'string' && a) set.add(a)
        } catch {}
      }
    } catch {}
  }
  __otherCharNames = set
  return set
}

const num = v => {
  const n = parseFloat(String(v ?? '').replace(/[^\d.+-]/g, ''))
  return Number.isFinite(n) ? n : 0
}

export class WuwaPanel extends plugin {
  constructor() {
    super({
      name: '鸣潮面板',
      dsc: '鸣潮角色面板（库街区数据）绑定与更新',
      event: 'message',
      priority: 40,
      rule: [
        { reg: '^#鸣潮绑定', fnc: 'bind' },
        { reg: '^\\d{4,8}$', fnc: 'bindByCode' },
        { reg: '^#更新鸣潮面板(?:\\s*\\d{6,12})?$', fnc: 'updateAll' },
        { reg: '^#更新(?!鸣潮面板).+?角色面板(?:\\s*\\d{6,12})?$', fnc: 'updateOne' },
        { reg: '^#(?!(?:更新|鸣潮绑定|星铁|原神|米游社)).+?(?:角色)?面板(?:\\s*\\d{6,12})?$', fnc: 'updateOne' },
        // #散华天赋 / #仇远天赋 —— 鸣潮角色天赋图（技能描述 + Lv1-10 倍率表）
        { reg: '^#(?!(?:星铁|原神|米游社|更新|鸣潮)).+?天赋$', fnc: 'talent' },
        // #散华共鸣链 —— 鸣潮角色共鸣链图（6 个节点：名称 + 效果）
        { reg: '^#(?!(?:星铁|原神|米游社|更新|鸣潮)).+?共鸣链$', fnc: 'chain' },
      ],
    })
  }

  /** 统一回复，群里 @ 发送者 */
  async say(msg) {
    return this.reply(msg, false, { at: true })
  }

  /** 角色列表统一收成存 redis 的瘦身结构 */
  slimRoles(roles) {
    return roles.map(r => ({
      roleId: roleIdOf(r),
      serverId: r.serverId || r.server || '',
      roleName: roleName(r) || '未知角色',
      serverName: normServerName(r.serverName || r.server || ''),
      uid: r.uid || r.userId || '',
    }))
  }

  roleLines(slim) {
    return slim.map((r, i) => `${i + 1}. ${r.roleName}${r.serverName ? `（${r.serverName}）` : ''}`).join('\n')
  }

  /** #鸣潮绑定 —— 手机号 + 验证码；也兼容直接贴 token */
  async bind() {
    const m = this.e.msg.match(RE_BIND)
    const args = (m?.[1] || '').trim().split(/\s+/).filter(Boolean)
    const userId = this.e.user_id

    if (!args.length) return this.say(BIND_HELP)

    // 手机号模式
    if (RE_PHONE.test(args[0])) {
      const mobile = args[0]
      const code = (args[1] || '').trim()
      const masked = `${mobile.slice(0, 3)}****${mobile.slice(-4)}`
      if (!code) return this.sendCode(userId, mobile, masked)
      if (!/^\d{4,8}$/.test(code)) return this.say('验证码应该是 4~8 位数字，重新复制一次再发')
      const pending = PENDING.get(userId)
      const device = pending && pending.mobile === mobile ? pending.device : undefined
      return this.bindBySms(userId, mobile, masked, code, device)
    }

    // 兼容旧方式：直接给 token
    const token = args[0]
    if (token.length < 20) return this.say('这串既不像手机号也不像 token。\n发 #鸣潮绑定（不带参数）看用法')
    return this.bindByToken(userId, token)
  }

  /** 自动过极验 + 给这个手机号发验证码 */
  async sendCode(userId, mobile, masked) {
    const last = SEND_COOLDOWN.get(userId) || 0
    const wait = 60 * 1000 - (Date.now() - last)
    if (wait > 0) {
      return this.say(`刚发过一次，${Math.ceil(wait / 1000)} 秒后再试（短信有频率限制）`)
    }

    let seccode
    try {
      seccode = await solveGeetest()
    } catch (err) {
      logger.mark(`[鸣潮面板] 极验失败 user=${userId} mobile=${masked} msg=${err.message}`)
      return this.say('滑块没过去，再发一次试试；还不行就自己拿码发我：#鸣潮绑定 手机号 验证码')
    }

    // 设备码要在发码和登录之间保持一致（参考实现同一个 deviceCode）
    const device = randomDeviceCode()
    try {
      await sendSmsCode(mobile, seccode, device)
    } catch (err) {
      logger.mark(`[鸣潮面板] 发码失败 user=${userId} mobile=${masked} code=${err.apiCode || '-'} msg=${err.message}`)
      return this.say('验证码没发出去：' + (err.message || '未知错误') + '\n可以自己拿码发我：#鸣潮绑定 手机号 验证码')
    }

    SEND_COOLDOWN.set(userId, Date.now())
    PENDING.set(userId, { mobile, masked, device, expireAt: Date.now() + PENDING_TTL })
    return this.say(
      `验证码已发到 ${masked}，10 分钟内有效。\n收到后直接把验证码发我（只发数字就行，不用带手机号和前缀）。\n` +
        '（库里绑一次就够；库街区 App 可能被挤下线，重新登一下）',
    )
  }

  /** 纯验证码消息：发过码的用户直接把验证码发过来就能绑定 */
  async bindByCode() {
    const userId = this.e.user_id
    const pending = PENDING.get(userId)
    if (!pending) return false
    if (Date.now() > pending.expireAt) {
      PENDING.delete(userId)
      return this.say('验证码等太久过期了，重新发 #鸣潮绑定 手机号，我给你发新的')
    }
    const code = String(this.e.msg || '').trim()
    if (!RE_CODE.test(code)) return false
    const ok = await this.bindBySms(userId, pending.mobile, pending.masked, code, pending.device)
    if (ok) PENDING.delete(userId)
    return ok
  }

  /** 短信验证码登录绑定 */
  async bindBySms(userId, mobile, masked, code, device) {
    let login
    try {
      login = await sdkLogin(mobile, code, device)
    } catch (err) {
      logger.mark(
        `[鸣潮面板] 短信登录失败 user=${userId} mobile=${masked} code=${err.apiCode || '-'} msg=${err.message}`,
      )
      if (err.apiCode === -130 || /验证码/.test(String(err.message))) {
        return this.say('验证码不对或已经过期，重新发 #鸣潮绑定 手机号 拿新的码')
      }
      return this.say('库街区登录失败，稍后再试')
    }

    let roles
    try {
      roles = await getBoundRoles(login.token, login.did)
    } catch (err) {
      logger.mark(`[鸣潮面板] 取绑定角色失败 user=${userId} code=${err.apiCode || '-'} msg=${err.message}`)
      return this.say('登录成功了，但取角色列表失败，可能是库街区「数据展示」没打开')
    }
    if (!roles.length) return this.say('登录成功，但这个账号下没查到鸣潮角色')

    const slim = this.slimRoles(roles)
    await Store.save(userId, { token: login.token, did: login.did, mode: 'sms', roles: slim, updatedAt: Date.now() })

    await this.say(
      `已绑定${login.userName ? `「${login.userName}」` : ` ${masked}`}：\n${this.roleLines(slim)}\n` +
        '之后发 #更新鸣潮面板 或 #更新<角色名>角色面板\n' +
        '（库街区 App 同一时间只能登录一个，这次登录可能把你手机上的挤掉，重新登一下就行）',
    )
    return true
  }

  /** 旧方式：直接粘 token */
  async bindByToken(userId, token) {
    let roles
    try {
      roles = await getBoundRoles(token)
    } catch (err) {
      logger.mark(`[鸣潮面板] 绑定失败 user=${userId} token=${maskToken(token)} code=${err.apiCode || '-'} msg=${err.message}`)
      return this.say('token 无效或已过期，请重新绑定')
    }

    if (!roles.length) return this.say('这个 token 下没有查到鸣潮角色，请确认已登录库街区')

    const slim = this.slimRoles(roles)
    await Store.save(userId, { token, mode: 'token', roles: slim, updatedAt: Date.now() })

    return this.say(`已绑定：\n${this.roleLines(slim)}\n之后发 #更新鸣潮面板 或 #更新<角色名>角色面板`)
  }

  /** 取绑定 + 换 b-at，失败时直接回话并返回 null */
  async prepare() {
    const userId = this.e.user_id
    const bind = await Store.get(userId)
    if (!bind) {
      await this.say('还没绑定，先发 #鸣潮绑定<token>')
      return null
    }
    let acc = bind.roles?.[0]
    if (!acc) {
      await this.say('绑定信息里没有角色，请重新绑定')
      return null
    }
    // 自愈：redis 里的中文被写坏过就重新拉一次角色列表并回写，避免右上角/角色名乱码
    if (looksMojibake(acc.roleName) || looksMojibake(acc.serverName)) {
      try {
        const fresh = await getBoundRoles(bind.token, bind.did)
        if (fresh?.length) {
          bind.roles = this.slimRoles(fresh)
          await Store.save(userId, bind)
          acc = bind.roles[0]
          logger.mark(`[鸣潮面板] 修复乱码绑定信息 user=${userId}`)
        }
      } catch (err) {
        logger.mark(`[鸣潮面板] 修复乱码绑定失败 user=${userId} msg=${err.message}`)
      }
    }
    try {
      const bat = await requestAccessToken(bind.token, acc.serverId, acc.roleId, bind.did)
      return { bind, acc, bat }
    } catch (err) {
      logger.mark(`[鸣潮面板] 取 b-at 失败 user=${userId} code=${err.apiCode || '-'} msg=${err.message}`)
      if (err.apiCode === 220) {
        await Store.remove(userId)
        await this.say('token 无效或已过期，请重新绑定')
        return null
      }
      await this.say('库街区接口开小差了，稍后再试')
      return null
    }
  }

  /**
   * 逐个角色取「已装备武器」（角色列表接口不带武器信息，只能查详情）。
   *
   * 缓存策略（2026-11-02 主人要求「刷新不出来的沿用上次的结果」）：
   *  - 成功的武器数据按「玩家UID:角色ID」持久化到 redis（WeaponStore），进程重启也不丢；
   *  - 每次先用缓存里的旧值兜底，2 小时内查过的不再打接口（省请求、避风控）；
   *  - 刷新失败 / 被限流回来是空，就保留旧值，不让图标一会儿有一会儿没有；
   *  - 空结果绝不写缓存（否则真的没查到会永远显示空）。
   */
  async collectWeapons(bind, acc, bat, list, ownerId = '') {
    const REFRESH_TTL = 2 * 60 * 60 * 1000
    const now = Date.now()
    const result = {}
    const queue = []
    // 缓存按玩家 UID 分开：同一角色在不同账号上装备的武器不一样
    const playerId = ownerId || acc.roleId
    const sleep = ms => new Promise(res => setTimeout(res, ms))
    const saved = await WeaponStore.load(playerId)

    for (const r of list) {
      const id = String(r?.roleId ?? '')
      if (!id) continue
      const old = saved[id]
      if (old) {
        // 先铺上次的结果，刷新失败时就是它
        result[id] = {
          name: old.name || '',
          icon: old.icon || '',
          star: Number(old.star || 0),
          reson: Number(old.reson || 0),
        }
      }
      if (!old || !old.at || now - old.at > REFRESH_TTL) {
        queue.push({ id, charId: r.roleId })
      }
    }
    if (!queue.length) return result

    // 刷新一次账号资料就够，批量里不再逐个刷；失败也别挡住列表出图
    try {
      await refreshData(bind.token, acc.serverId, playerId, bat, bind.did)
    } catch (err) {
      logger.mark(`[鸣潮面板] 刷资料失败 user=${playerId} ${err.message}`)
    }

    const pickWeapon = detail => {
      const w = detail?.weaponData?.weapon
      return w
        ? {
            name: w.weaponName || '',
            icon: w.weaponIcon || '',
            star: Number(w.weaponStarLevel || 0),
            reson: Number(detail?.weaponData?.resonLevel || 0),
          }
        : null
    }

    const workers = Array.from({ length: 2 }, async () => {
      while (queue.length) {
        const item = queue.shift()
        if (!item) break
        try {
          let detail
          try {
            detail = await getRoleDetail(bind.token, acc.serverId, playerId, item.charId, bat, bind.did, { skipRefresh: true })
          } catch (err) {
            // 撞到人机验证就等一下，刷一次资料再试一把
            if (!err.geeTest) throw err
            await sleep(1500)
            await refreshData(bind.token, acc.serverId, playerId, bat, bind.did)
            detail = await getRoleDetail(bind.token, acc.serverId, playerId, item.charId, bat, bind.did, { skipRefresh: true })
          }
          const data = pickWeapon(detail)
          if (data) {
            result[item.id] = data
            await WeaponStore.save(playerId, item.id, data)
          } else if (!result[item.id]) {
            // 没旧值也没新值：留空，但下次还会重试
            result[item.id] = null
          }
        } catch (err) {
          logger.mark(`[鸣潮面板] 取武器失败 role=${item.id} ${err.message}`)
          if (!result[item.id]) result[item.id] = null
        }
        await sleep(200)
      }
    })
    await Promise.all(workers)
    return result
  }

  /** 渲染并发送某个角色（uidOverride 有值时查的是别人） */
  async renderRole(bind, acc, bat, hit, uidOverride = '') {
    const name = roleName(hit)
    const characterId = characterIdOf(hit)
    const ownerId = uidOverride || acc.roleId
    if (!characterId) {
      await this.say(`「${name || '该角色'}」没有角色 ID，接口可能改版了`)
      return
    }
    const detail = await getRoleDetail(bind.token, acc.serverId, ownerId, characterId, bat, bind.did)
    if (!detail) {
      await this.say(`「${name}」没有查到详细数据`)
      return
    }
    const data = buildPanelData(detail, {
      uid: ownerId || acc.uid || '',
      dataSource: '库街区',
    })
    const img = await renderPanel(this.e, data)
    await this.reply(img, false)
  }

  /** #更新鸣潮面板 [UID] —— 全角色缩略图一览（带 UID 时查别人） */
  async updateAll() {
    const m = this.e.msg.match(RE_ALL)
    const targetUid = (m?.[1] || '').trim()

    const ctx = await this.prepare()
    if (!ctx) return
    const { bind, acc, bat } = ctx
    // 带 UID = 查别人：b-at 还是自己的，roleId 换成对方的
    const ownerId = targetUid || acc.roleId

    try {
      const list = pickRoleList(await getRoleData(bind.token, acc.serverId, ownerId, bat, bind.did))
      if (!list.length) {
        return this.say(
          targetUid
            ? `UID ${targetUid} 的角色列表是空的，对方可能没开数据展示`
            : '角色列表是空的，可能没在库街区打开数据展示',
        )
      }
      const weapons = await this.collectWeapons(bind, acc, bat, list, targetUid ? ownerId : '')
      const data = buildListData(list, {
        uid: ownerId || acc.uid || '',
        serverName: acc.serverName || '国服',
        dataSource: '库街区',
        weapons,
      })
      const img = await renderRoleList(this.e, data)
      return this.reply(img, false)
    } catch (err) {
      logger.mark(`[鸣潮面板] 更新面板失败 user=${this.e.user_id} uid=${ownerId} msg=${err.message}`)
      if (targetUid && /未开放展示|showToGuest/.test(err.message)) {
        return this.say(`UID ${targetUid} 没开数据展示（库街区 → 我的 → 数据展示），查不了`)
      }
      if (targetUid) return this.say(`查 UID ${targetUid} 失败了，可能 UID 不对或者不是同区服`)
      return this.say('读取面板失败，稍后再试')
    }
  }

  /** #更新<角色名>角色面板 [UID] / #<角色名>面板 [UID] */
  async updateOne() {
    const m = this.e.msg.match(RE_ONE) || this.e.msg.match(RE_ONE_SHORT)
    const want = (m?.[1] || '').trim().replace(/角色$/, '')
    const targetUid = (m?.[2] || '').trim()
    if (!want) return false

    // 短指令 #xx面板 和原神 / 星铁面板共用：对面有同名角色就让位给 miao
    if (!RE_ONE.test(this.e.msg) && otherGameCharNames().has(want)) return false

    const ctx = await this.prepare()
    if (!ctx) return
    const { bind, acc, bat } = ctx
    // 带 UID = 查别人：b-at 还是自己的，roleId 换成对方的
    const ownerId = targetUid || acc.roleId

    try {
      const list = pickRoleList(await getRoleData(bind.token, acc.serverId, ownerId, bat, bind.did))
      if (!list.length) {
        return this.say(
          targetUid
            ? `UID ${targetUid} 的角色列表是空的，对方可能没开数据展示`
            : '角色列表是空的，可能没在库街区打开数据展示',
        )
      }

      const hit =
        list.find(r => roleName(r) === want) ||
        list.find(r => roleName(r).includes(want)) ||
        list.find(r => want.includes(roleName(r)) && roleName(r))

      if (hit) return this.renderRole(bind, acc, bat, hit, targetUid)

      // 别名 / 小名 / 输入法同音错字：查表找到标准名，再回角色列表里对
      for (const cand of lookupRole(want)) {
        const h = list.find(r => roleName(r) === cand.name || normName(roleName(r)) === normName(cand.name))
        if (h) return this.renderRole(bind, acc, bat, h, targetUid)
      }

      // 查别人：角色列表里没有这个角色，直接说清楚，别让给别的插件
      if (targetUid) return this.say(`UID ${targetUid} 的角色里没找到「${want}」`)
      // 不是鸣潮角色，把这条消息让给别的插件
      return false
    } catch (err) {
      logger.mark(`[鸣潮面板] 更新角色失败 user=${this.e.user_id} uid=${ownerId} msg=${err.message}`)
      if (targetUid && /未开放展示|showToGuest/.test(err.message)) {
        return this.say(`UID ${targetUid} 没开数据展示（库街区 → 我的 → 数据展示），查不了`)
      }
      if (targetUid) return this.say(`查 UID ${targetUid} 失败了，可能 UID 不对或者不是同区服`)
      return this.say('读取角色数据失败，稍后再试')
    }
  }

  /**
   * #<角色名>共鸣链 —— 鸣潮角色共鸣链图
   * 数据来自库街区 wiki（共鸣链 → 6 个节点的名称 + 效果），不需要绑定账号。
   */
  async chain() {
    const want = String(this.e.msg || '')
      .replace(/^#/, '')
      .replace(/共鸣链$/, '')
      .trim()
    if (!want) return false

    // 原神 / 星铁同名角色让位给 miao
    if (otherGameCharNames().has(want)) return false

    const key = findChainRole(want)
    // 不是鸣潮角色：让给别的插件
    if (!key) return false

    try {
      const img = await renderChain(this.e, key)
      if (!img) return this.say(`「${want}」共鸣链渲染失败，稍后再试`)
      return this.reply(img, false)
    } catch (err) {
      logger.mark(`[鸣潮面板] 共鸣链失败 role=${key} msg=${err.message}`)
      return this.say(`「${want}」共鸣链渲染失败：${err.message}`)
    }
  }

  /**
   * #<角色名>天赋 —— 鸣潮角色天赋图
   * 数据来自库街区 wiki（技能介绍 → 描述 + Lv1-10 倍率表），不需要绑定账号。
   */
  async talent() {
    const want = String(this.e.msg || '')
      .replace(/^#/, '')
      .replace(/天赋$/, '')
      .trim()
    if (!want) return false

    // 原神 / 星铁同名角色让位给 miao
    if (otherGameCharNames().has(want)) return false

    const key = findTalentRole(want)
    // 不是鸣潮角色：让给别的插件
    if (!key) return false

    try {
      const img = await renderTalent(this.e, key)
      if (!img) return this.say(`「${want}」天赋图渲染失败，稍后再试`)
      return this.reply(img, false)
    } catch (err) {
      logger.mark(`[鸣潮面板] 天赋图失败 role=${key} msg=${err.message}`)
      return this.say(`「${want}」天赋图渲染失败：${err.message}`)
    }
  }
}
