# luci-theme-halo

一套为 OpenWrt / ImmortalWrt **LuCI (openwrt-25.12 / ucode 模板)** 手写的仪表盘式主题。
零构建、零依赖，只用到 `luci-base`；静态资源全部自带，不与 aurora / bootstrap 共享文件。

配色是 **Indigo & Copper**：深靛蓝做底盘与主信号（接收 / 主色），铜色做暖金属副调（上传 / 品牌锚点），
中性色整体偏向靛蓝，让整块界面像同一种材料切出来的。灵感来自老式航空仪表 —— 冷底盘、暖指针、灰刻度。

和「换个配色」的主题不同，halo 的概览页是一块真正的仪表盘：

- **网络信息** — WAN/LAN、双向上/下行速率、60 点迷你曲线、网关/DNS/链路速率、开机累计流量
- **网络拓扑** — 互联网 → 主路由（含 CPU/内存条）→ 客户端，链路带动画流向；隧道单独挂在路由下；节点可点，直跳对应配置页
- **吞吐量** — 5 分钟 RX/TX 双曲线，Y 轴按显示单位给整齐刻度，历史不足时按真实跨度铺满并标注「已采集 N 秒」
- **系统** — CPU / 内存 / 存储进度条 + 温度、租约数、负载
- **客户端 / 接口 / 流量大户** — 在线设备与速率、接口协议与链路速率、按会话流量排序的 Top 列表

窄屏（< 620px）拓扑自动切换成**竖向链路**，字号按 1:1 显示，不做 0.45 倍缩小。

## 它是什么（先厘清一件事）

halo 是 **LuCI 主题（theme）**，也就是一个 OpenWrt **软件包**（`luci-theme-*`），不是独立的网页/界面。
它没有自己的服务端、没有路由、没有数据库，全部内容只有：

- 三份 ucode 模板（`header.ut` / `footer.ut` / `sysauth.ut`）—— 由 `luci-base` 的模板引擎渲染；
- 一份 CSS/JS 静态资源 —— 由 uhttpd 直接从 `/www/luci-static/halo/` 吐出；
- 一个 `uci-defaults` 脚本 —— 把自己注册进 `luci.themes`。

所以它**必须装在已经有 LuCI 的系统上**（`+luci-base` 依赖），脱离 OpenWrt 跑不起来；反过来，装到任何架构的 OpenWrt 上都能用，因为包是 `_all` 架构。

## 目录

```
Makefile          OpenWrt 包定义（luci.mk）—— 这个仓库就是一个可编译的包
.github/          CI：两个 SDK 各出一份 ipk / apk
LICENSE           Apache-2.0（base.css 源自 LuCI cascade.css，同为 Apache-2.0）
htdocs/luci-static/halo/
  base.css       LuCI 官方 cascade.css 副本（CBI 组件与变量底座，勿改）
  tokens.css     色板 / 几何 / 深色覆盖
  app.css        外壳、导航、表格、表单、按钮、标签页
  dash.css       仪表盘 12 栏网格与各卡片
  login.css      登录页
  dash.js        HaloDash.render(root, model) —— 纯浏览器脚本，离线预览与真机共用
  images/logo.svg
htdocs/luci-static/resources/
  menu-halo.js   导航轨、面包屑、命令面板、主题切换、折叠
  halo-live.js   ubus 采集 → model → 渲染，5 秒心跳（见下方「稳定性契约」）
ucode/template/themes/halo/
  header.ut  footer.ut  sysauth.ut
root/etc/uci-defaults/40_luci-theme-halo
root/usr/share/rpcd/ucode/luci.halo     rpcd 插件：conntrack → 每台主机的字节数
root/usr/share/rpcd/acl.d/luci-theme-halo.json  给它挂 ACL（登录用户可读）
preview/         离线预览（fixtures）与设计期截图
```

## 部署

```bash
RT_PASS='<路由器口令>' python deploy/halo_deploy.py           # 上传 + 激活（带健康闸门）
RT_PASS='<路由器口令>' python deploy/halo_deploy.py rollback  # 切回 aurora
RT_PASS='<路由器口令>' python deploy/halo_deploy.py health    # 只探活
```

`halo_deploy.py` 会在远端跑 `halo_switch.sh`，它做四件事：

1. **真正停掉 uhttpd** —— SIGTERM，等 6 秒；若进程还在（死锁时会这样）就 `kill -9`；
2. 清 `luci-modulecache` 后**再启动**，不让缓存缺失留到下次访问；
3. **预热三次**，让 ucode 模板在部署时编译完，而不是由访问者触发；
4. 探活（`curl` 取 HTTP 状态码 + 返回体字节数），**失败就自动回滚到 aurora**。

> 不要再用「只清缓存、不重启」的方式收尾。上一次 Web 打不开就是这里来的。

## 打包（ipk / apk）

仓库根目录就是包目录，`Makefile` 用 `luci.mk` 描述它。**同一份源码不需要改任何东西**，包格式由编译时用的 SDK 决定：

| SDK / 固件版本 | 包管理器 | 产物 |
|---|---|---|
| 24.10 及更早 | opkg | `luci-theme-halo_1.0.0-1_all.ipk` |
| 25.12 及更新 | apk-tools | `luci-theme-halo-1.0.0-r1.apk` |

### GitHub Actions（推荐）

推上去就能编，`.github/workflows/build.yml` 已经按上表跑一个 2×2 矩阵（两个 SDK × 同一份源码）：

```bash
git init && git add -A && git commit -m "luci-theme-halo 1.0.0"
git remote add origin git@github.com:qqxu223/luci-theme-halo.git
git push -u origin main
```

- push / PR → 两个 artifact：`luci-theme-halo-ipk`、`luci-theme-halo-apk`；
- 打 tag（`git tag v1.0.0 && git push --tags`）→ 自动挂到 GitHub Release 附件。

SDK 文件名里的 gcc 版本每个小版本都会变，workflow 里是现场解析下载页拿到的，所以升小版本只需要改 `matrix.release` 一个数字。

### 本地用 SDK 编译

```bash
# 25.12 → apk
wget https://downloads.openwrt.org/releases/25.12.6/targets/x86/64/openwrt-sdk-25.12.6-x86-64_gcc-14.3.0_musl.Linux-x86_64.tar.zst
tar --zstd -xf openwrt-sdk-*.tar.zst && cd openwrt-sdk-*/

cp -r /path/to/luci-theme-halo package/luci-theme-halo
./scripts/feeds update luci && ./scripts/feeds install luci-base
make defconfig
make package/luci-theme-halo/compile V=s -j$(nproc)

ls bin/packages/*/luci/luci-theme-halo*
```

### 塞进自己的固件一起编

```bash
# 在 buildroot 根目录
git clone https://github.com/qqxu223/luci-theme-halo.git package/luci-theme-halo
make menuconfig     # LuCI → Themes → luci-theme-halo
make -j$(nproc)
```

### 安装

```bash
# 25.12（apk，本地文件未签名，要 --allow-untrusted）
apk add --allow-untrusted ./luci-theme-halo-1.0.0-r1.apk

# 24.10（opkg）
opkg install ./luci-theme-halo_1.0.0-1_all.ipk
```

装完到 **系统 → 语言和界面 → 主题** 选 `Halo`。包只注册、不强制切换，所以不会把你锁在某个主题里；卸载也不影响当前界面。

> 从 Windows 提交代码时注意 `.gitattributes` 已锁 `eol=lf`，以及 `root/etc/uci-defaults/40_luci-theme-halo` 的可执行位——丢了它主题装完不会注册（CI 里有 `chmod +x` 兜底，本地提交请确认 `git ls-files -s` 显示 `100755`）。

## 稳定性契约（改 `halo-live.js` 必读）

uhttpd 是**单进程 epoll**：一串慢 ubus 调用能把整条 accept 队列堵死，之后连 SIGTERM 都不响应，
整个 Web 面板失联（本项目真实发生过一次）。所以采集层有七条硬规则，不要绕过：

| # | 规则 | 代码位置 |
|---|---|---|
| 1 | **单飞**：一轮没结束不开始下一轮 | `beat()` 的 `S.busy` |
| 2 | **每次调用都有超时**，绝不留悬挂 promise | `guard()` |
| 3 | **在途请求上限**：被放弃的调用未回落时停止发新请求 | `INFLIGHT_CAP` |
| 4 | **失败退避**：5→10→20→40→60 秒，而不是原速重试 | `BACKOFF` / `nextDelay()` |
| 5 | **心跳只跳过、不停止**：隐藏标签页零网络请求，但计时器不拆 | `startHeartbeat()` / `beat()` |
| 6 | **三时钟**：廉价计数器 5 秒，客户端流量 10 秒，重表（租约/主机）30 秒 | `STEP` / `TALK` / `SLOW` |
| 7 | **禁止在浏览器里轮询 `luci/getConntrackList`**（见下） | 全文无此调用 |
| 8 | **单主机流量交给 `luci.halo/talkers`**：服务端聚合，回几百字节 | `sampleTalk()` |

### 为什么不能调 `getConntrackList`

它没有过滤参数，一次性把整张 `nf_conntrack` 表序列化出来。实测这台路由器在透明代理跑起来后
有 **12,337 条**连接，单次调用 **30 秒不返回**，随后 **rpcd 退出（exit 0）** —— 会话全在 rpcd 的
ubus `session` 对象里，于是**所有浏览器立刻被踢回登录页**。procd 会重启 rpcd，但攒够崩溃次数就进入
crash loop 停止重启，表现就是「换台手机登录一直弹重新登录」。

客户端流量排行因此改由主题自带的 rpcd 插件 `luci.halo` 提供
（`root/usr/share/rpcd/ucode/luci.halo`）：它在**服务端**把 `nf_conntrack` 聚合成
「每台内网主机的累计字节数」，只回几百字节；浏览器只负责把两次采样的差值除以间隔得到速率。

成本模型（这台 aarch64 路由器实测，表 4 MB / 约 13k 条）：

| 做法 | 一次采样 |
|---|---|
| 64 KB 缓冲逐行读 | 49 次全表遍历、8.4 秒 |
| **2 MB 缓冲、一次读** | **1 次遍历、0.2–0.8 秒** |
| 硬上限 `MAX_PASSES = 3` | 最坏 3 次遍历后放弃，`truncated` 由前端整帧丢弃 |

关键点是 `/proc/net/nf_conntrack` **不支持 lseek**：每次 `read()` 都从表头重新遍历，所以必须用
大缓冲一次读完，逐行读会退化成 O(表大小²)。这也是 `getConntrackList` 慢到 30 秒的真正原因 ——
不是它对数据做了什么，而是它把整表序列化成几 MB 的 blobmsg 回包。

采样间隔不是固定的：每次采样会量自己的耗时，下一轮按 `max(12 秒, 耗时 × 6)` 退让
（上限 30 秒），所以连接表越大、机器越慢，采样越稀，rpcd 被占用的比例始终压在 15% 左右。
卡片标题右侧会写明这次数字覆盖的窗口（「近 12 秒」「近 29 秒」），不会假装是瞬时值。

**精度边界**：插件按「连接」做差分 —— 同一个 5 元组在相邻两次采样都出现过，才把它的增量
计入。这样连接关闭不会把速率拖成 0（这是按主机求和的老做法的问题：实测空载时「总量」都在
以几百 kB/s 倒退）。代价是**生命周期短于采样窗口的连接会被漏掉**：一次 3 秒的网页加载、
一个在两次采样之间开始又结束的下载，都不会出现在排行里。长时间下载、视频流这类持续流量是
准确的（实测单连接 614 kB/s 时卡片显示 755 kB/s，差额是后台流量）。

安装/升级时 `uci-defaults` 会重启一次 rpcd 让插件生效（rpcd 只在启动时扫描插件目录）。
重启前先单独跑一遍插件确认语法，跑不通就直接删掉再重启：一个坏插件不能有能力把 Web 面板拖下水。
权限走 `luci-theme-halo` 这个 ACL 组，默认的 root 登录是 `list read '*'`，天然拥有；
受限用户没有这个组，卡片会显示「客户端流量采样不可用」，不会报错也不会空转重试。

另外 `safe()` 接收的是**函数**而不是已调用的 promise：`rpc.declare` 的返回值在构造阶段就可能抛
（ACL 拒绝、expect 不合法、模块未就绪）。一旦它在 `Promise.all([...])` 的参数里同步抛出，
`tick()` 就不会返回 promise，释放锁的 `.then` 永远不执行 —— 仪表盘会停在第 1 帧且再无更新。

再加两道兜底，由 `/usr/sbin/halo-watchdog` 每分钟执行：

- **rpcd 存活 + `session` 对象存在** —— 缺失则抓现场（fd/syscall/连接/procd 状态）后重启 rpcd；
- **`127.0.0.1:80` 能响应** —— 连续 2 次失败（间隔 15 秒）才重启 uhttpd。

两者都有冷却时间，日志在 `/tmp/halo-watchdog.log`，现场在 `/tmp/halo-freeze.log`。

移除看门狗：

```sh
rm -f /usr/sbin/halo-watchdog
sed -i '/halo-watchdog/d' /etc/crontabs/root && /etc/init.d/cron reload
```


## 回滚

主题是**增量**安装，没有覆盖任何原有文件：

```bash
RT_PASS='<口令>' python deploy/halo_deploy.py rollback
```

或手动全量清除：

```sh
uci set luci.main.mediaurlbase='/luci-static/aurora'
uci delete luci.themes.Halo 2>/dev/null
uci commit luci
rm -rf /www/luci-static/halo \
       /www/luci-static/resources/menu-halo.js \
       /www/luci-static/resources/halo-live.js \
       /usr/share/ucode/luci/template/themes/halo \
       /etc/uci-defaults/40_luci-theme-halo
rm -rf /tmp/luci-modulecache /tmp/luci-indexcache*
/etc/init.d/uhttpd stop; sleep 2; /etc/init.d/uhttpd start
```

## 实现约束（改这个主题前先读）

1. `base.css` 是 LuCI 的功能底座，不要在它里面改样式；所有覆盖写在 `tokens.css` / `app.css`。
2. ucode 模板**没有** `?:` 三元；`{{ a ?: b }}` 会编译失败。常量在 `{% %}` 里先算好。
3. 菜单树是**以 name 为键的 map**，不是数组，统一走 `ui.menu.getChildren(node)`。
4. 菜单脚本由 footer 的 `L.require('menu-halo')` 载入；若在 `ui.menu.load().then()` 里再 `L.require`，会被静默吞掉，必须 `setTimeout(..., 0)`。
5. 页面名不等于直觉：防火墙是 `nftables`、状态里的路由是 `routesj`。`menu-halo.js` 的 `ICONS` 按真实 name 建 key，并有 `HINTS` 关键字兜底。
6. 登录页（`blank_page`）需要 `cbi.js`，否则 LuCI 构造器会因为缺 `String.prototype.format` 抛错。
7. `network.interface.<name>/status` 在本机被 ACL 拒绝（-32002），只能用 `network.interface/dump`；`expect:{}` 才会拿到裸数组。
