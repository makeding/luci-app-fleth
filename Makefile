include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-fleth
LUCI_TITLE:=LuCI Support for Flet'H
LUCI_DESCRIPTION:=LuCI protocol collection for IPv4 over IPv6 tunnels in Japan.
PKG_VERSION:=0.24
PKG_RELEASE:=1

LUCI_PKGARCH:=all
LUCI_DEPENDS:=+luci-base +lua +luci-proto-ipv6 \
	+kmod-ip6-tunnel \
	+resolveip \
	+jsonfilter


PKG_CONFIG_DEPENDS:= \
	CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_LUA_UI \
	CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_IPIP6H \
	CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_IPIP6HP

define Package/luci-app-fleth/config
	config PACKAGE_$(PKG_NAME)_INCLUDE_LUA_UI
		bool "Include legacy LuCI Lua UI"
		default n
		help
		  Include a minimal Lua CBI fallback page for old LuCI versions
		  that cannot render JavaScript views.

	config PACKAGE_$(PKG_NAME)_INCLUDE_IPIP6H
		bool "Include luci-proto-ipip6h"
		default y
		help
		  Include custom IPv4 over IPv6 tunnel protocol support.
		  This adds the ipip6h protocol handler and LuCI interface.

	config PACKAGE_$(PKG_NAME)_INCLUDE_IPIP6HP
		bool "Include luci-proto-ipip6hp"
		default y
		help
		  Include custom IPv4 over IPv6 passthrough protocol support.
		  This adds the ipip6hp protocol handler and LuCI interface.
endef

include $(TOPDIR)/feeds/luci/luci.mk


define Build/Compile
	$(call Build/Compile/Default)
ifdef CONFIG_PACKAGE_luci-app-fleth_INCLUDE_LUA_UI
	# Legacy LuCI Lua UI is included
else
	# Remove legacy LuCI Lua UI if not selected
	rm -f $(PKG_BUILD_DIR)/root/usr/lib/lua/luci/controller/fleth.lua
	rm -f $(PKG_BUILD_DIR)/root/usr/lib/lua/luci/model/cbi/fleth.lua
endif
ifdef CONFIG_PACKAGE_luci-app-fleth_INCLUDE_IPIP6H
	# IPIP6H support is included
else
	# Remove IPIP6H files if not selected
	rm -f $(PKG_BUILD_DIR)/htdocs/luci-static/resources/protocol/ipip6h.js
	rm -f $(PKG_BUILD_DIR)/root/lib/netifd/proto/ipip6h.sh
endif
ifdef CONFIG_PACKAGE_luci-app-fleth_INCLUDE_IPIP6HP
	# IPIP6HP support is included
else
	# Remove IPIP6HP files if not selected
	rm -f $(PKG_BUILD_DIR)/htdocs/luci-static/resources/protocol/ipip6hp.js
	rm -f $(PKG_BUILD_DIR)/root/lib/netifd/proto/ipip6hp.sh
	rm -f $(PKG_BUILD_DIR)/root/usr/share/fleth/ipip6hp-hotplug.sh
	rm -f $(PKG_BUILD_DIR)/root/usr/share/fleth/firewall.include
endif
endef

# call BuildPackage - OpenWrt buildroot signature
