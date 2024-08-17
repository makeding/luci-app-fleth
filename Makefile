include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-fleth
LUCI_TITLE:=LuCI Support for Flet'h
LUCI_DESCRIPTION:=luci-app-fleth is a helper that can configure your IPv4 over IPv6 tunnel automatically.
PKG_VERSION:=0.2
PKG_RELEASE:=1

LUCI_PKGARCH:=all
LUCI_DEPENDS:=+luci-base +map +ds-lite +luci-proto-ipv6

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature