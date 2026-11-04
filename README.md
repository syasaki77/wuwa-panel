# wuwa-panel · 鸣潮面板插件

库街区（KuroBBS）数据驱动的鸣潮角色面板插件，适用于 Yunzai / TRSS-Yunzai 3.x。

## 安装

1. 把整个 `wuwa-panel` 目录放进机器人的 `plugins/` 目录下
2. 重启机器人（或等热加载，新目录一般需要重启一次）
3. 群里/私聊发命令即可

依赖：Node 18+（用原生 fetch），redis（Yunzai 自带）。

## 命令

| 命令 | 说明 |
|---|---|
| `#鸣潮绑定` | 看绑定教程 |
| `#鸣潮绑定 手机号` | 机器人自动过极验滑块、把验证码发到这个手机号 |
| `验证码` | 发码后直接发 6 位验证码就能绑定（10 分钟内有效；也兼容 `#鸣潮绑定 手机号 验证码`） |
| `#鸣潮绑定 <token>` | 老方式：直接粘库街区 token（兼容保留） |
| `#更新鸣潮面板` | 更新默认角色的面板 |
| `#更新鸣潮面板 <UID>` | 查别的玩家：按对方 UID 出全角色列表，对方需在库街区开启数据展示 |
| `#更新<角色名>角色面板` | 更新指定角色，支持全名与模糊匹配 |
| `#<角色名>面板` | 同上（简写，和原神/星铁面板共用，有同名角色时让位给 miao） |
| `#<角色名>面板 <UID>` | 查别的玩家：用自己的登录态换 b-at、按对方 UID 取面板，对方需在库街区开启数据展示 |
| `#<角色名>天赋` | 角色天赋图：共鸣能力、90 级基础面板、六大技能描述 + Lv1-10 倍率表（走库街区 wiki，**不需要绑定**；别名/梗名都认，原神/星铁同名角色自动让位给 miao） |
| `#<角色名>共鸣链` | 角色共鸣链图：6 条共鸣链节点 + 效果（数据同样来自库街区 wiki，**不需要绑定**；别名/梗名都认） |

## 绑定说明

- 发码要过极验 v4 滑块：`lib/geetest.js` 里纯 Node 实现（load → Canny 边缘匹配找缺口 → AES+RSA 生成 w → verify 拿 seccode），一次约 0.5 秒，失败自动重试
- 发码接口 `POST /user/getSmsCode`（form：`mobile, geeTestData`；**必须带 `devcode` 头**，缺了会回 `code=102 服务器外部错误`）
- 登录接口 `POST /user/sdkLogin`（form：`mobile, code, devCode, gameList`）
- 同一 QQ 60 秒内只发一次码，别把短信接口刷爆
- 发码成功后该用户进入「等验证码」状态（10 分钟）：之后收到纯 4~8 位数字消息就当验证码处理；发码和登录复用同一个设备码
- 每次绑随机生成设备码 `did`（32 位大写十六进制），后续取数都带同一个 did
- **库街区 App 同一时间只允许一个登录**：机器人登录会用新 token 把用户手机上的会话挤掉，重新登录即可
- token 只存在 redis：`wuwa:bind:<QQ号>`，不落文件
- 回复与日志都不回显完整 token（日志脱敏为前 6 位 + 后 4 位）；手机号日志脱敏为前 3 后 4
- 群里发手机号/验证码时，消息本身其他人可见，建议私聊绑定
- token 失效（库街区 code 220）会提示「token 无效或已过期，请重新绑定」

## 数据链路

```
/user/sdkLogin           (ios 头, 手机号+验证码)            → 登录 token + userId + userName
/gamer/role/list         (android 头, Cookie user_token)   → 绑定角色列表
/aki/roleBox/requestToken (ios 头, token)                  → b-at 访问令牌
/aki/roleBox/akiBox/roleData       (ios 头, b-at)          → 角色列表
/aki/roleBox/akiBox/getRoleDetail  (ios 头, b-at)          → 单角色培养数据
```

- base：`https://api.kurobbs.com`
- 全部 POST form；响应的 `data` 常是 JSON 字符串，已二次解析
- `devCode` 使用「公网 IP + ios UA」，公网 IP 启动时取一次并缓存

## 当前进度

- [x] 三条命令路由
- [x] 绑定改为手机号 + 短信验证码（保留 token 兼容）
- [x] 绑定 / token 失效处理
- [x] 库街区 API 封装
- [x] 面板出图（接 miao-plugin 的 profile-detail 模板）
- [x] 角色别名表（社区梗名 + 同音错字）
- [x] `#XX天赋` 角色天赋图

## 天赋图（#XX天赋）

- 命令：`#散华天赋`，不需要绑定账号，数据来自库街区 wiki
- 数据链路：`POST https://api.kurobbs.com/wiki/core/catalogue/item/getEntryDetail`
  （form：`id=<entryId>`；**必须带 `wiki_type: 9` 头**，缺了报「wiki库类型不能为空」）
  - 角色目录：`/wiki/core/catalogue/item/getPage`（`catalogueId=1105&page=1&limit=1000`）→ 角色名到 entryId
  - 角色页路由是 `https://wiki.kurobbs.com/mc/item/<entryId>`（不是 `/mc/role/<游戏roleId>`，那个 404）
- 解析：`modules[].components[]` 里按 title 找「技能介绍」（tabs：常态攻击/共鸣技能/共鸣回路/共鸣解放/变奏技能/延奏技能），每个 tab 的 `content` 是 HTML
  - 技能图标：第一个 `width="9x"` 的 `<img>`
  - 描述：图标所在 `<p>` 之后到第一个 `<table>` 之间，`<p>` 首行短且不带句号就当小标题
  - 倍率表：第一张含 ≥3 个 `Lv N` 单元格的 `<table>`；命中次数 `%*4` 转 `%×4`，多段合并的 `A + B` 拆两行
- 数据落地：`data/talent.json`（60 个角色，漂泊者按属性分 4 套）
- 图片：`resources/img/talent/`（456 张技能图标/立绘/背景，抓取时本地化，运行时不需要联网）
- 渲染：`resources/talent.html`；图片统一用 TRSS 注入的相对 `_res_path`（**不要改成 `file:///` 绝对路径**：shotium 渲染器加载不了带空格的 file URL，图标会整块空掉）
- 渲染器坑：TRSS 默认的 shotium **不认 CSS `filter`**（所以图标/装饰一律用 PNG 素材，不靠反色滤镜），也**不画 inline SVG**

## 共鸣链（#XX共鸣链）

- 命令：`#散华共鸣链`，不需要绑定账号
- 数据来源：`POST https://api.kurobbs.com/wiki/core/catalogue/item/getEntryDetail`（`wiki_type: 9` 头）里 `title === '共鸣链'` 的模块，HTML 表格「名称 / 效果」6 行
- 数据落地：`data/chains.json`（60 个角色，莉莉在 wiki 上没有这一栏）
- 图标：`resources/img/chain/`（360 张，抓取时本地化，运行时不需要联网）
  - 原始图标是黑色线稿，深色面板上看不见，抓取时统一反色成白色（`_dl_chains.py` 下载即反色）
- 渲染：`resources/chain.html`，颜色跟随角色属性（同属性色表），背景用属性星空图 + 角色名片

## 素材与声明

- 游戏立绘、图标、名片来自库街区 wiki / 库街区 App，版权归库洛游戏所有，本项目仅作非商业用途的学习与工具用途
- 公开仓库不含任何真实 QQ 号与 token：多账号共用绑定请自行写 `data/bind-alias.json`（已 gitignore），格式 `{"别名QQ":"主QQ"}`

## 文件

- `index.js`：命令注册与业务
- `lib/kuro.js`：库街区接口
- `lib/geetest.js`：极验 v4 滑块自动通过（PNG 解码 + Canny + 模板匹配 + w 生成）
- `lib/store.js`：redis 存取 + token 脱敏 + 武器持久缓存
- `lib/panel.js`：面板数据 → 渲染数据（角色列表 / 单角色详情）
- `lib/alias.js`：角色名匹配（全名 / 社区梗名 / 同音错字）
- `lib/talent.js`：天赋图数据与出图
- `lib/chain.js`：共鸣链数据与出图
- `data/`：静态数据（别名表、天赋、倍率、共鸣链、头像与名片映射）
- `resources/`：HTML 模板与本地化图片素材
