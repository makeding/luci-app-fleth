// Native automatic Flet'h protocol.
'use strict';
'require form';
'require network';
'require tools.widgets as widgets';

network.registerPatternVirtual(/^fleth-.+$/);

return network.registerProtocol('fleth', {
	getI18n: function () {
		return _("Flet'h automatic IPv4 over IPv6");
	},

	getIfname: function () {
		return this._ubus('l3_device') || 'fleth-%s'.format(this.sid);
	},

	getPackageName: function () {
		return 'luci-proto-fleth';
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

		o = s.taboption('general', widgets.NetworkSelect, 'tunlink', _('Tunnel Link'));
		o.default = 'wan6';
		o.exclude = s.section;
		o.rmempty = false;

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
		o.datatype = 'range(1280,1500)';
	}
});
