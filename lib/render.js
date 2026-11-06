/**
 * 渲染入口：走 TRSS 的 runtime.render → puppeteer 截图
 */
/** 单角色详情 */
export async function renderPanel(e, data, cfg = {}) {
  const base64 = await e.runtime.render('wuwa-panel', 'profile-detail', data, {
    retType: 'base64',
    ...cfg,
  })
  if (!base64) throw new Error('渲染返回空')
  return base64
}

/** 全角色缩略图一览 */
export async function renderRoleList(e, data, cfg = {}) {
  const base64 = await e.runtime.render('wuwa-panel', 'profile-list', data, {
    retType: 'base64',
    ...cfg,
  })
  if (!base64) throw new Error('渲染返回空')
  return base64
}

/** 玩家名片（库街区「我的 → 角色卡片」长图） */
export async function renderPlayerCard(e, data, cfg = {}) {
  const base64 = await e.runtime.render('wuwa-panel', 'player-card', data, {
    retType: 'base64',
    ...cfg,
  })
  if (!base64) throw new Error('渲染返回空')
  return base64
}

/** base64 → 可直接 reply 的图片消息 */
export function toImage(base64) {
  return base64.startsWith('base64://') ? base64 : `base64://${base64}`
}
