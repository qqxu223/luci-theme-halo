# SPDX-License-Identifier: Apache-2.0
#
# luci-theme-halo — 仪表盘式 LuCI 主题（Indigo & Copper）
#
# 编译（OpenWrt SDK 或 buildroot 内）：
#   make package/luci-theme-halo/compile V=s
#
# 产物：
#   24.10 及更早 → bin/packages/<arch>/luci/luci-theme-halo_<ver>-<rel>_all.ipk
#   25.12 及更新 → bin/packages/<arch>/luci/luci-theme-halo_<ver>-<rel>_all.apk
#   包格式由 SDK 版本决定，与主题无关。
#
# 目录约定（luci.mk 会自动打包）：
#   htdocs/luci-static/halo/          → /www/luci-static/halo/
#   htdocs/luci-static/resources/*.js → /www/luci-static/resources/
#   ucode/template/themes/halo/       → /usr/share/ucode/luci/template/themes/halo/
#   root/                             → /

include $(TOPDIR)/rules.mk

LUCI_TITLE:=Halo - a dashboard-style LuCI theme
LUCI_DESCRIPTION:=Overview page as a real dashboard: live throughput charts, network topology and client/talker lists. No build step, no extra dependencies beyond luci-base.
LUCI_DEPENDS:=+luci-base
LUCI_PKGARCH:=all
# 注意是 LUCI_ 前缀：luci.mk 里写的是 MAINTAINER:=$(LUCI_MAINTAINER)、URL:=$(LUCI_URL)，
# 用 PKG_MAINTAINER / PKG_URL 会被静默忽略，control 里仍然显示 luci.mk 的默认值。
LUCI_MAINTAINER:=qqxu223
LUCI_URL:=https://github.com/qqxu223/luci-theme-halo

PKG_VERSION:=1.0.2
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE

# 资源是手写并已调优的：csstidy / terser 会改写 color-mix()、:is() 和 ucode-js 的
# 特殊写法，反而弄坏样式；关掉压缩顺带去掉对 luasrcdiet 的 host 依赖。
LUCI_MINIFY_CSS:=
LUCI_MINIFY_JS:=
CONFIG_LUCI_CSSTIDY:=

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
