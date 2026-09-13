include $(TOPDIR)/rules.mk

PKG_NAME:=luci-proto-fleth
LUCI_TITLE:=LuCI Support for Flet'H
LUCI_DESCRIPTION:=LuCI protocol collection for IPv4 over IPv6 tunnels in Japan.
PKG_VERSION:=1.1
PKG_RELEASE:=1

LUCI_PKGARCH:=all
LUCI_DEPENDS:=+luci-base +lua +luci-proto-ipv6 \
	+kmod-ip6-tunnel \
	+resolveip \
	+jsonfilter \
	+PACKAGE_$(PKG_NAME)_INCLUDE_FLETHP:ip-full \
	+PACKAGE_$(PKG_NAME)_INCLUDE_FLETHP:conntrack \
	+PACKAGE_$(PKG_NAME)_INCLUDE_FLETHP:flock \
	+PACKAGE_$(PKG_NAME)_INCLUDE_FLETHP:firewall4


PKG_CONFIG_DEPENDS:= \
	CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_LUA_UI \
	CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_IPIP6H \
	CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_IPIP6HP \
	CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_FLETHP

define Package/$(PKG_NAME)/config
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
	config PACKAGE_$(PKG_NAME)_INCLUDE_FLETHP
		bool "Include Flet'H IPoE passthrough"
		default y
		help
		  Dedicated downstream MAP-E/DS-Lite passthrough using fw4.
endef

include $(TOPDIR)/feeds/luci/luci.mk


define Build/Compile
	$(call Build/Compile/Default)
ifeq ($(CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_LUA_UI),y)
	# Legacy LuCI Lua UI is included
else
	# Remove legacy LuCI Lua UI if not selected
	rm -f $(PKG_BUILD_DIR)/root/usr/lib/lua/luci/controller/fleth.lua
	rm -f $(PKG_BUILD_DIR)/root/usr/lib/lua/luci/model/cbi/fleth.lua
endif
ifeq ($(CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_IPIP6H),y)
	# IPIP6H support is included
else
	# Remove IPIP6H files if not selected
	rm -f $(PKG_BUILD_DIR)/htdocs/luci-static/resources/protocol/ipip6h.js
	rm -f $(PKG_BUILD_DIR)/root/lib/netifd/proto/ipip6h.sh
endif
ifeq ($(CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_IPIP6HP),y)
	# IPIP6HP support is included
else
	# Remove IPIP6HP files if not selected
	rm -f $(PKG_BUILD_DIR)/htdocs/luci-static/resources/protocol/ipip6hp.js
	rm -f $(PKG_BUILD_DIR)/root/lib/netifd/proto/ipip6hp.sh
	rm -f $(PKG_BUILD_DIR)/root/usr/share/fleth/ipip6hp-hotplug.sh
	rm -f $(PKG_BUILD_DIR)/root/usr/share/fleth/firewall.include
endif
ifeq ($(CONFIG_PACKAGE_$(PKG_NAME)_INCLUDE_FLETHP),y)
	# FLETHP support is included independently of IPIP6HP
else
	rm -f $(PKG_BUILD_DIR)/htdocs/luci-static/resources/protocol/flethp.js
	rm -f $(PKG_BUILD_DIR)/root/lib/netifd/proto/flethp.sh
	rm -f $(PKG_BUILD_DIR)/root/usr/share/fleth/flethp-common.sh
	rm -f $(PKG_BUILD_DIR)/root/usr/share/fleth/flethp-firewall.include
	rm -f $(PKG_BUILD_DIR)/root/etc/hotplug.d/iface/75-flethp
endif
endef

# call BuildPackage - OpenWrt buildroot signature
