include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-fleth
LUCI_TITLE:=LuCI Support for Flet'h
LUCI_DESCRIPTION:=luci-app-fleth is a helper that can configure IPv4 over IPv6 tunnel automatically in Japan.
PKG_VERSION:=0.12
PKG_RELEASE:=1

LUCI_PKGARCH:=all
LUCI_DEPENDS:=+luci-base +lua +luci-proto-ipv6 \
	+PACKAGE_$(PKG_NAME)_INCLUDE_MAP:map \
	+PACKAGE_$(PKG_NAME)_INCLUDE_DSLITE:ds-lite \
	+PACKAGE_$(PKG_NAME)_INCLUDE_IPIP:ipip \
	+PACKAGE_$(PKG_NAME)_INCLUDE_IPIP:luci-proto-ipip

PKG_CONFIG_DEPENDS:= \
	CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_MAP \
	CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_DSLITE \
	CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_IPIP

define Package/luci-app-fleth/config
	config PACKAGE_$(PKG_NAME)_INCLUDE_MAP
		bool "Include MAP-E support"
		default y
		help
		  Include MAP-E tunnel protocol support.

	config PACKAGE_$(PKG_NAME)_INCLUDE_DSLITE
		bool "Include DS-Lite support"
		default y
		help
		  Include DS-Lite tunnel protocol support.

	config PACKAGE_$(PKG_NAME)_INCLUDE_IPIP
		bool "Include IPIP support"
		default y
		help
		  Include IPIP tunnel protocol support.
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature