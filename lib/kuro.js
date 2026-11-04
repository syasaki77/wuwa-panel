/**
 * 库街区（KuroBBS）鸣潮面板数据接口
 *
 * 参考实现：yangfeng20/wuthering-waves-platform（AGPL）的 src/http/game.js
 * 约定：
 *  - 绑定角色列表走 android 平台头（带 user_token Cookie）
 *  - 其余游戏数据走 ios 平台头（token + b-at）
 *  - 响应里的 data 经常是 JSON 字符串，要二次 parse
 *  - code 220 = token 失效
 */

import { randomUUID } from 'node:crypto'

const BASE = 'https://api.kurobbs.com'
const VERSION = '2.9.1'
const IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) KuroGameBox/2.9.1'

/** 缓存公网 IP（devCode 要用） */
let cachedIp = ''
let ipPromise = null

/** 取公网 IP，失败就退回一个内网地址（和参考实现一致，服务端只做弱校验） */
export async function getPublicIp() {
  if (cachedIp) return cachedIp
  if (ipPromise) return ipPromise
  ipPromise = (async () => {
    const sources = [
      async () => (await fetch('https://event.kurobbs.com/event/ip', { signal: AbortSignal.timeout(4000) })).text(),
      async () => (await (await fetch('https://api.ipify.org/?format=json', { signal: AbortSignal.timeout(4000) })).json()).ip,
      async () => (await (await fetch('https://httpbin.org/ip', { signal: AbortSignal.timeout(4000) })).json()).origin,
    ]
    for (const s of sources) {
      try {
        const ip = String(await s()).trim()
        if (ip) {
          cachedIp = ip
          console.log(`[wuwa-debug] getPublicIp = ${JSON.stringify(ip)}`)
          return ip
        }
      } catch {
        continue
      }
    }
    console.log('[wuwa-debug] getPublicIp 全部失败，退回 192.168.0.1')
    cachedIp = '192.168.0.1'
    return cachedIp
  })()
  try {
    return await ipPromise
  } finally {
    ipPromise = null
  }
}

/** 发一个 form 请求，顺手把字符串 data 解析掉 */
async function postForm(path, form, headers) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers,
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(15000),
  })
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(`接口 ${path} 返回的不是 JSON（HTTP ${res.status}）`)
  }
  if (typeof json.data === 'string') {
    try {
      json.data = JSON.parse(json.data)
    } catch {
      /* 保持原样 */
    }
  }
  if (json.code !== 200 && json.code !== 10902) {
    console.log(
      `[wuwa-debug] ${path} -> code=${json.code} msg=${json.msg} | devCode=${headers.devCode} | b-at=${headers['b-at'] || '(无)'} | did=${headers.did || '(无)'} | token头=${headers.token ? '有' : '无'} | body=${text.slice(0, 300)}`,
    )
  }
  return json
}

function failCode(json, op) {
  const err = new Error(`${op}失败：${json.msg || json.message || '未知错误'}`)
  err.apiCode = json.code
  return err
}

function assertCode(json, accepted, op) {
  if (!accepted.includes(json.code)) throw failCode(json, op)
  return json
}

/** 库街区的风控应答：HTTP 200，但 data 里只有一个 { geeTest: true } */
function geeTestError() {
  const err = new Error('触发库街区人机验证（geeTest），稍后再试')
  err.geeTest = true
  return err
}

/** 随机设备码 did（32 位大写十六进制） */
export function randomDeviceCode() {
  return randomUUID().replace(/-/g, '').toUpperCase()
}

async function iosHeaders(token, bat, did, needToken = false) {
  const ip = await getPublicIp()
  const headers = {
    source: 'ios',
    version: VERSION,
    'User-Agent': IOS_UA,
    'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    devCode: `${ip}, ${IOS_UA}`,
  }
  // 参照 wuthering-waves-platform：只有 requestToken / gameData / 签到才带 token 头，
  // refreshData / roleData / getRoleDetail 只带 b-at + did（多带 token 会回 code=10000 参数错误）。
  if (needToken && token) headers.token = token
  if (bat) headers['b-at'] = bat
  if (did) headers.did = did
  return headers
}

async function androidHeaders(token, did) {
  const headers = {
    source: 'android',
    version: VERSION,
    'User-Agent': 'okhttp/3.11.0',
    'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
    osVersion: '35',
    model: 'V2243A',
    versionCode: '2500',
    channelId: '6',
    lang: 'zh-Hans',
    countryCode: 'CN',
  }
  if (token) {
    headers.Cookie = `user_token=${token}`
    headers.token = token
  }
  if (did) {
    // 发码接口 /user/getSmsCode 必须带 devcode 头（设备码），缺了会回 code=102「服务器外部错误」。
    // 参考：Kuro-autosignin2/sms_send.py（headers 里有 devcode=deviceCode）。
    headers.devcode = did
    headers.did = did
  }
  return headers
}

/**
 * 手机号 + 短信验证码登录。
 *
 * 验证码获取：/user/getSmsCode 要极验 seccode，插件自己过滑块发码（见 lib/geetest.js）。
 * 登录本身不需要极验。
 *
 * 注意：APP 端同一时间只允许一个登录，这里登录会把用户自己手机上的登录挤下线。
 *
 * @param {string} [did] 发码时用的设备码；传进来就复用，不传就现生成
 * @returns {Promise<{token:string, userId:string, userName:string, did:string}>}
 */
export async function sdkLogin(mobile, code, did) {
  const device = did || randomDeviceCode()
  const headers = await iosHeaders(null, null, device)
  const json = await postForm('/user/sdkLogin', { mobile, code, devCode: device, gameList: '' }, headers)
  assertCode(json, [200], '验证码登录')
  const data = json.data || {}
  if (!data.token) throw new Error('登录成功但没有返回 token')
  return { token: data.token, userId: data.userId ? String(data.userId) : '', userName: data.userName || '', did: device }
}

/**
 * 发短信验证码
 * @param {string} mobile 手机号
 * @param {string} geeTestData 极验 seccode 的 JSON 字符串
 * @param {string} [did] 设备码；不传就现生成（发码接口的 devcode 头必须和它一致）
 */
export async function sendSmsCode(mobile, geeTestData, did) {
  const device = did || randomDeviceCode()
  const json = await postForm('/user/getSmsCode', { mobile, geeTestData }, await androidHeaders(null, device))
  assertCode(json, [200], '发送验证码')
  return json
}

/** 用 token 校验并拿账号绑定的鸣潮角色列表 */
export async function getBoundRoles(token, did = '') {
  const json = await postForm('/gamer/role/list', { gameId: 3 }, await androidHeaders(token, did))
  assertCode(json, [200], '获取绑定角色')
  return Array.isArray(json.data) ? json.data : []
}

/** 用角色换游戏访问令牌 b-at（这个接口要带 token 头） */
export async function requestAccessToken(token, serverId, roleId, did = '') {
  const json = await postForm('/aki/roleBox/requestToken', { serverId, roleId }, await iosHeaders(token, null, did, true))
  if (json.code === 220) {
    const err = new Error('token 已过期')
    err.apiCode = 220
    throw err
  }
  assertCode(json, [200, 10902], '获取访问令牌')
  const data = json.data
  return data?.accessToken || data?.token || data
}

/** 刷新账号资料（参考实现里所有取数前都先刷一次） */
export async function refreshData(token, serverId, roleId, bat, did = '') {
  const json = await postForm(
    '/aki/roleBox/akiBox/refreshData',
    { gameId: 3, serverId, roleId },
    await iosHeaders(token, bat, did),
  )
  assertCode(json, [10902, 200], '刷新账号资料')
  const data = json.data
  if (data && data.geeTest) throw geeTestError()
  return data
}

/** 角色列表（含 characterId / 等级 / 武器等） */
export async function getRoleData(token, serverId, roleId, bat, did = '') {
  await refreshData(token, serverId, roleId, bat, did)
  const json = await postForm(
    '/aki/roleBox/akiBox/roleData',
    { gameId: 3, serverId, roleId },
    await iosHeaders(token, bat, did),
  )
  assertCode(json, [10902, 200], '获取角色列表')
  const data = json.data
  if (data && data.geeTest) throw geeTestError()
  if (!data || data.showToGuest === false) throw new Error('角色数据未开放展示，请去库街区打开数据展示')
  return data
}

/**
 * 单个角色详细培养数据
 * opts.skipRefresh=true 时不重复刷新账号资料——批量取多个角色时由调用方先刷一次，
 * 否则 N 个角色就是 2N 次请求，很容易吃 geeTest 人机验证。
 */
export async function getRoleDetail(token, serverId, roleId, characterId, bat, did = '', opts = {}) {
  if (!opts.skipRefresh) await refreshData(token, serverId, roleId, bat, did)
  const json = await postForm(
    '/aki/roleBox/akiBox/getRoleDetail',
    { serverId, roleId, id: characterId },
    await iosHeaders(token, bat, did),
  )
  assertCode(json, [10902, 200], '获取角色详细数据')
  const data = json.data
  if (data && data.geeTest) throw geeTestError()
  return data
}
