// Based on OpenWrt luci-proto-ipv6/ipip6.js
// Source: https://github.com/openwrt/luci/tree/master/protocols/luci-proto-ipv6
// Modified for Fleth Custom IPIP6H protocol
'use strict';
'require network';
'require protocol.ipip6h-common as ipip6hCommon';

network.registerPatternVirtual(/^ipip6h-.+$/);

return network.registerProtocol('ipip6h', {
	getI18n: function () {
		return _("IPv4 over IPv6 (Flet'h)");
	},

	getIfname: function () {
		return this._ubus('l3_device') || 'ipip6h-%s'.format(this.sid);
	},

	getPackageName: function () {
		return 'luci-proto-ipip6h';
	},

	isFloating: function () {
		return true;
	},

	isVirtual: function () {
		return true;
	},

	getDevices: function () {
		return null;
	},

	containsDevice: function (ifname) {
		return (network.getIfnameOf(ifname) == this.getIfname());
	},

	renderFormOptions: function (s) {
		ipip6hCommon.renderPeerAddress(s);
		ipip6hCommon.renderIPv4Address(s, _('Public IPv4 Address'), _('Your public IPv4 address for the tunnel interface'), '111.0.0.1');
		ipip6hCommon.renderInterfaceId(s);
		ipip6hCommon.renderInterfaceIdButtons(s);
		ipip6hCommon.renderActivation(s, 'ipip6h');
		ipip6hCommon.renderAdvancedBase(s);
		ipip6hCommon.installIPv4InterfaceIdAutofill();
	}
});
