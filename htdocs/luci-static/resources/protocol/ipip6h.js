// Based on OpenWrt luci-proto-ipv6/ipip6.js
// Source: https://github.com/openwrt/luci/tree/master/protocols/luci-proto-ipv6
// Modified for Fleth Custom IPIP6H protocol
'use strict';
'require form';
'require network';
'require tools.widgets as widgets';

network.registerPatternVirtual(/^(?:ipip6h|ip6h)-.+$/);

function getIpip6hDeviceName(sectionId) {
	var name = 'ipip6h-' + sectionId;

	if (name.length <= 15)
		return name;

	return 'ip6h-' + sectionId.substring(0, 5) + '-' + sectionId.substring(sectionId.length - 4);
}

function ipv4ToHex(ipv4) {
	if (!ipv4)
		return '';

	var octets = ipv4.split('.');
	var endsWithDot = ipv4.endsWith('.');

	if (endsWithDot && octets[octets.length - 1] === '')
		octets.pop();
	else if (!endsWithDot && octets.length < 4)
		octets.pop();

	var hexParts = [];
	for (var i = 0; i < 4; i++) {
		var num = parseInt(octets[i], 10);
		hexParts.push(isNaN(num) || num < 0 || num > 255 ? '00' : ('00' + num.toString(16)).slice(-2));
	}

	return '00' + hexParts[0] + ':' + hexParts[1] + hexParts[2] + ':' + hexParts[3] + '00:0000';
}

function fillInterfaceIdFromIPv4() {
	var ip4Input = document.querySelector('[data-name="ip4ifaddr"] input');
	var ifIdInput = document.querySelector('[data-name="interface_id"] input');

	if (!ip4Input || !ifIdInput)
		return;

	var hex = ipv4ToHex(ip4Input.value);
	if (hex) {
		ifIdInput.value = hex;
		ifIdInput.dispatchEvent(new Event('change', { bubbles: true }));
	}
}

function fillInterfaceIdWithOnes() {
	var ifIdInput = document.querySelector('[data-name="interface_id"] input');
	if (ifIdInput) {
		ifIdInput.value = '1111:1111:1111:1111';
		ifIdInput.dispatchEvent(new Event('change', { bubbles: true }));
	}
}

function renderInterfaceIdFillButtons() {
	var ipv4Button = E('button', {
		'class': 'cbi-button cbi-button-apply',
		'type': 'button',
		'style': 'margin-right: 0.75em;'
	}, _('Use IPv4 → Hex'));
	var onesButton = E('button', {
		'class': 'cbi-button cbi-button-apply',
		'type': 'button'
	}, _('1111:1111:1111:1111'));

	ipv4Button.addEventListener('click', fillInterfaceIdFromIPv4);
	onesButton.addEventListener('click', fillInterfaceIdWithOnes);

	return E('div', { 'class': 'cbi-value' }, [
		E('label', { 'class': 'cbi-value-title' }, '\u00a0'),
		E('div', { 'class': 'cbi-value-field' }, [
			ipv4Button,
			onesButton
		])
	]);
}

return network.registerProtocol('ipip6h', {
	getI18n: function () {
		return _("Flet'H Static IP");
	},

	getIfname: function () {
		return this._ubus('l3_device') || getIpip6hDeviceName(this.sid);
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

		o = s.taboption('general', form.Value, 'peeraddr', _('BR Address'));
		o.value('2404:9200:225:100::65', '2404:9200:225:100::65 (v6plus)');
		o.value('dgw.xpass.jp', 'dgw.xpass.jp (Xpass)');
		o.value('2400:2000:4:0:a000::1999', '2400:2000:4:0:a000::1999 (SoftBank 10G)');
		o.value('2400:2000:4:0:a000::2999', '2400:2000:4:0:a000::2999 (SoftBank 10G)');
		o.default = '2404:9200:225:100::65';
		o.datatype = 'or(hostname,ip6addr("nomask"))';
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'ip4ifaddr', _('Public IPv4 Address'));
		o.rmempty = false;
		o.datatype = 'ip4addr("nomask")';
		o.placeholder = '111.0.0.1';

		o = s.taboption('general', form.Value, 'interface_id', _('IPv6 Interface ID'));
		o.placeholder = '006f:0000:0100:0000';
		o.rmempty = false;
		o.validate = function (_section_id, value) {
			if (!value || value.length === 0)
				return _('IPv6 Interface ID is required');

			if (!/^([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$/.test(value))
				return _('Invalid IPv6 interface identifier format. Example: 0011:4514:1b00:0000');

			return true;
		};

		o = s.taboption('general', form.DummyValue, '_fill_interface_id');
		o.render = renderInterfaceIdFillButtons;

		o = s.taboption('general', form.Flag, 'activation_enabled', _('Activation request'),
			_('Run one HTTP request after the virtual interface is created'));
		o.default = o.disabled;

		o = s.taboption('general', form.Value, 'activation_url', _('Activation URL'),
			_('The backend will call this URL with curl after the ipip6h virtual interface is created'));
		o.placeholder = 'https://example.com/activate';
		o.depends('activation_enabled', '1');
		o.validate = function (_section_id, value) {
			if (!value)
				return true;

			if (!/^https?:\/\/\S+$/i.test(value))
				return _('Activation URL must start with http:// or https://');

			return true;
		};

		o = s.taboption('general', form.DummyValue, '_activation_curl_hint', _('curl package'));
		o.titleref = L.url('admin', 'system', 'package-manager');
		o.rawhtml = true;
		o.depends('activation_enabled', '1');
		o.cfgvalue = function () {
			return _('This option requires the curl package. Install curl from Software before enabling it.');
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
		o.datatype = 'range(1280,1500)';

		o = s.taboption('advanced', form.Flag, 'prefer_slaac', _('Prefer SLAAC Address'),
			_('Router outbound connections will prefer SLAAC addresses over MAP-E/ipip6h static addresses'));
		o.default = o.enabled;

		o = s.taboption('advanced', form.Flag, 'auto_activate', _('Auto Activate Tunnel'),
			_('Automatically send ping to activate tunnel. Without traffic, some tunnels may fail to establish connection properly.'));
		o.default = o.enabled;

	}
});
