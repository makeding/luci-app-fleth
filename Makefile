include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-fleth
PKG_VERSION:=1.0
PKG_RELEASE:=1

PKG_LICENSE:=MIT
PKG_MAINTAINER:=Huggy <huggy@fleth.link>

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)
	SECTION:=luci
	CATEGORY:=LuCI
	SUBMENU:=3. Applications
	TITLE:=Transitional package for luci-proto-fleth
	DEPENDS:=+luci-proto-fleth
	PKGARCH:=all
endef

define Package/$(PKG_NAME)/description
	Empty transitional package depending on luci-proto-fleth.
	This package can be removed after luci-proto-fleth is installed.
endef

define Build/Compile
endef

define Package/$(PKG_NAME)/install
	true
endef

$(eval $(call BuildPackage,$(PKG_NAME)))
