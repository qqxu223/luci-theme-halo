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

PKG_VERSION:=1.0.0
PKG_RELEASE:=1

PKG_LICENSE:=Apache-2.0
PKG_LICENSE_FILES:=LICENSE
PKG_MAINTAINER:=Jian

# 资源是手写并已调优的：csstidy / 压缩会改写 color-mix() 与 :is()，反而弄坏样式。
LUCI_MINIFY_CSS:=
CONFIG_LUCI_CSSTIDY:=

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
