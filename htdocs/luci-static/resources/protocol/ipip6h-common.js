'use strict';
'require form';
'require tools.widgets as widgets';

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

function ipv4Peer31(ipv4) {
	if (!ipv4)
		return '';

	var octets = ipv4.split('.');
	if (octets.length !== 4)
		return '';

	var peer = [];
	for (var i = 0; i < 4; i++) {
		if (!/^\d+$/.test(octets[i]))
			return '';

		var num = parseInt(octets[i], 10);
		if (num < 0 || num > 255)
			return '';

		peer.push(num);
	}

	peer[3] = peer[3] ^ 1;
	return peer.join('.');
}

function getPeerValue() {
	var peerInput = document.querySelector('[data-name="peeraddr"] input[type="hidden"]');
	return peerInput ? peerInput.value : '';
}

function peerRequiresInterfaceId(peeraddr) {
	return peeraddr === '2404:9200:225:100::65' || peeraddr === '2400:2000:4:0:a000::1999';
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

return {
	ipv4ToHex: ipv4ToHex,
	ipv4Peer31: ipv4Peer31,

	renderPeerAddress: function (s) {
		var o = s.taboption('general', form.Value, 'peeraddr', _('BR Address'),
			_('Border Relay IPv6 address'));
		o.value('2404:9200:225:100::65', '2404:9200:225:100::65 (v6plus)');
		o.value('2400:2000:4:0:a000::1999', '2400:2000:4:0:a000::1999 (SoftBank 10G)');
		o.default = '2404:9200:225:100::65';
		o.datatype = 'or(hostname,ip6addr("nomask"))';
		o.rmempty = false;
		return o;
	},

	renderIPv4Address: function (s, title, description, placeholder) {
		var o = s.taboption('general', form.Value, 'ip4ifaddr', title, description);
		o.rmempty = false;
		o.datatype = 'ip4addr("nomask")';
		o.placeholder = placeholder;
		return o;
	},

	renderInterfaceId: function (s) {
		var o = s.taboption('general', form.Value, 'interface_id', _('IPv6 Interface ID'));
		o.placeholder = '006f:0000:0100:0000';
		o.optional = true;
		o.validate = function (_section_id, value) {
			if (peerRequiresInterfaceId(getPeerValue()) && (!value || value.length === 0))
				return _('IPv6 Interface ID is required for v6plus and SoftBank 10G');

			if (value && value.length > 0) {
				if (!/^([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$/.test(value))
					return _('Invalid IPv6 interface identifier format. Example: 0011:4514:1b00:0000');
			}

			return true;
		};
		return o;
	},

	renderInterfaceIdButtons: function (s) {
		var o;

		o = s.taboption('general', form.Button, '_fill_from_ipv4', _('Fill from IPv4'));
		o.inputtitle = _('Use IPv4 → Hex');
		o.inputstyle = 'apply';
		o.onclick = fillInterfaceIdFromIPv4;

		o = s.taboption('general', form.Button, '_fill_ones', _('Fill with 1 (Softbank)'));
		o.inputtitle = _('1111:1111:1111:1111');
		o.inputstyle = 'apply';
		o.onclick = function () {
			var ifIdInput = document.querySelector('[data-name="interface_id"] input');
			if (ifIdInput) {
				ifIdInput.value = '1111:1111:1111:1111';
				ifIdInput.dispatchEvent(new Event('change', { bubbles: true }));
			}
		};
	},

	renderActivation: function (s, protocolName) {
		var o;

		o = s.taboption('general', form.Flag, 'activation_enabled', _('Activation request'),
			_('Run one HTTP request after the virtual interface is created'));
		o.default = o.disabled;

		o = s.taboption('general', form.Value, 'activation_url', _('Activation URL'),
			_('The backend will call this URL with curl after the %s virtual interface is created').format(protocolName));
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
	},

	renderAdvancedBase: function (s) {
		var o;

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
	},

	installIPv4InterfaceIdAutofill: function (beforeFill) {
		setTimeout(function () {
			var ip4Input = document.querySelector('[data-name="ip4ifaddr"] input');
			var ifIdInput = document.querySelector('[data-name="interface_id"] input');

			if (!ip4Input || !ifIdInput)
				return;

			ip4Input.addEventListener('input', function () {
				if (beforeFill)
					beforeFill();

				if (peerRequiresInterfaceId(getPeerValue()))
					fillInterfaceIdFromIPv4();
			});
		}, 100);
	}
};
