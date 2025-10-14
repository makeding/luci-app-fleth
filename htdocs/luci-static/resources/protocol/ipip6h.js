// Based on OpenWrt luci-proto-ipv6/ipip6.js
// Source: https://github.com/openwrt/luci/tree/master/protocols/luci-proto-ipv6
// Modified for Fleth Custom IPIP6H protocol
'use strict';
'require form';
'require network';
'require tools.widgets as widgets';

network.registerPatternVirtual(/^ipip6h-.+$/);

return network.registerProtocol('ipip6h', {
	getI18n: function () {
		return _('IPv4 over IPv6 (fleth edition)');
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
		var o;

		// BR Address
		o = s.taboption('general', form.Value, 'peeraddr', _('BR Address'),
			_('Border Relay IPv6 address'));
		o.value('2404:9200:225:100::65', '2404:9200:225:100::65 (v6plus)');
		o.value('2001:f60:0:205::2', '2001:f60:0:205::2 (Xpass)');
		o.value('2400:2000:4:0:a000::1999', '2400:2000:4:0:a000::1999 (SoftBank 10G)');
		o.default = '2404:9200:225:100::65';
		o.datatype = 'or(hostname,ip6addr("nomask"))';
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'ip4ifaddr', _('Public IPv4 Address'),
			_('Your public IPv4 address for the tunnel interface'));
		o.rmempty = false;
		o.datatype = 'ip4addr("nomask")';
		o.placeholder = '111.0.0.1';

		o = s.taboption('general', form.Value, 'interface_id', _('IPv6 Interface ID'),
			_('IPv6 interface identifier (last 64 bits). Will be combined with WAN6 prefix to create a virtual IPv6 address. Example: 0011:4514:1b00:0000'));
		o.placeholder = '0011:4514:1b00:0000';
		o.rmempty = false;
		o.validate = function (_section_id, value) {
			if (!value || value.length === 0)
				return _('IPv6 Interface ID is required');
			// Validate IPv6 interface ID format (1-7 groups of 1-4 hex digits separated by colons)
			if (!/^([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$/.test(value))
				return _('Invalid IPv6 interface identifier format. Example: 0011:4514:1b00:0000');
			return true;
		};

		o = s.taboption('advanced', widgets.NetworkSelect, 'tunlink', _('Tunnel Link'));
		o.default = 'wan6';
		o.exclude = s.section;

		o = s.taboption('advanced', form.ListValue, 'encaplimit', _('Encapsulation limit'));
		o.rmempty = false;
		o.default = 'ignore';
		o.datatype = 'or("ignore",range(0,255))';
		o.value('ignore', _('ignore'));
		for (var i = 0; i < 256; i++)
			o.value(i);

		o = s.taboption('advanced', form.Flag, 'defaultroute', _('Default gateway'), _('If unchecked, no default route is configured'));
		o.default = o.enabled;

		o = s.taboption('advanced', form.Value, 'metric', _('Use gateway metric'));
		o.placeholder = '0';
		o.datatype = 'uinteger';
		o.depends('defaultroute', '1');

		o = s.taboption('advanced', form.Value, 'mtu', _('Use MTU on tunnel interface'));
		o.placeholder = '1460';
		o.datatype = 'max(1500)';
	}
});
