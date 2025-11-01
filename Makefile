include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-fleth
LUCI_TITLE:=LuCI Support for Flet'h
LUCI_DESCRIPTION:=luci-app-fleth is a helper that can configure IPv4 over IPv6 tunnel automatically in Japan.
PKG_VERSION:=0.15
PKG_RELEASE:=1

LUCI_PKGARCH:=all
LUCI_DEPENDS:=+luci-base +lua +luci-proto-ipv6 \
	+PACKAGE_$(PKG_NAME)_INCLUDE_MAP:map \
	+PACKAGE_$(PKG_NAME)_INCLUDE_DSLITE:ds-lite


PKG_CONFIG_DEPENDS:= \
	CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_MAP \
	CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_DSLITE \
	CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_IPIP6H

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

	config PACKAGE_$(PKG_NAME)_INCLUDE_IPIP6H
		bool "Include luci-proto-ipip6h"
		default y
		help
		  Include custom IPv4 over IPv6 tunnel protocol support.
		  This adds the ipip6h protocol handler and LuCI interface.
endef

include $(TOPDIR)/feeds/luci/luci.mk


define Build/Compile
	$(call Build/Compile/Default)
ifdef CONFIG_PACKAGE_luci-app-fleth_INCLUDE_IPIP6H
	# IPIP6H support is included
else
	# Remove IPIP6H files if not selected
	rm -f $(PKG_BUILD_DIR)/htdocs/luci-static/resources/protocol/ipip6h.js
	rm -f $(PKG_BUILD_DIR)/root/lib/netifd/proto/ipip6h.sh
endif
endef

# call BuildPackage - OpenWrt buildroot signature