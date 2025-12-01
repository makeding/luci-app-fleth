// Based on OpenWrt luci-proto-ipv6/ipip6.js
// Source: https://github.com/openwrt/luci/tree/master/protocols/luci-proto-ipv6
// Modified for Fleth Custom IPIP6H protocol
'use strict';
'require form';
'require network';
'require tools.widgets as widgets';

network.registerPatternVirtual(/^ipip6h-.+$/);
if (location.pathname === '/cgi-bin/luci/admin/network/firewall/forwards') {
	try {
		const script = document.createElement('script');
		script.src = '/luci-static/resources/view/fleth-hook.js';
		document.head.appendChild(script);
	} catch (error) {
		console.warn(error);
	}
}
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

		function ipv4ToHex(ipv4) {
			if (!ipv4) return '';

			var octets = ipv4.split('.');
			var endsWithDot = ipv4.endsWith('.');

			if (endsWithDot && octets[octets.length - 1] === '') octets.pop();
			else if (!endsWithDot && octets.length < 4) octets.pop();

			var hexParts = [];
			for (var i = 0; i < 4; i++) {
				var num = parseInt(octets[i], 10);
				hexParts.push(isNaN(num) || num < 0 || num > 255 ? '00' : ('00' + num.toString(16)).slice(-2));
			}

			return '00' + hexParts[0] + ':' + hexParts[1] + hexParts[2] + ':' + hexParts[3] + '00:0000';
		}

		// BR Address
		o = s.taboption('general', form.Value, 'peeraddr', _('BR Address'),
			_('Border Relay IPv6 address'));
		o.value('2404:9200:225:100::65', '2404:9200:225:100::65 (v6plus)');
		// o.value('2001:f60:0:205::2', '2001:f60:0:205::2 (Xpass)');
		o.value('2400:2000:4:0:a000::1999', '2400:2000:4:0:a000::1999 (SoftBank 10G)');
		o.default = '2404:9200:225:100::65';
		o.datatype = 'or(hostname,ip6addr("nomask"))';
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'ip4ifaddr', _('Public IPv4 Address'),
			_('Your public IPv4 address for the tunnel interface'));
		o.rmempty = false;
		o.datatype = 'ip4addr("nomask")';
		o.placeholder = '111.0.0.1';

		o = s.taboption('general', form.Value, 'interface_id', _('IPv6 Interface ID'));
		o.placeholder = '006f:0000:0100:0000';
		o.optional = true;
		o.validate = function (_section_id, value) {
			// Get current peeraddr value
			var peerInput = document.querySelector('[data-name="peeraddr"] input[type="hidden"]');
			var peeraddr = peerInput ? peerInput.value : '';

			// Interface ID is required for v6plus and SoftBank 10G
			var requiresInterfaceId = (peeraddr === '2404:9200:225:100::65' || peeraddr === '2400:2000:4:0:a000::1999');

			if (requiresInterfaceId && (!value || value.length === 0)) {
				return _('IPv6 Interface ID is required for v6plus and SoftBank 10G');
			}

			// Validate format if value is provided
			if (value && value.length > 0) {
				if (!/^([0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$/.test(value))
					return _('Invalid IPv6 interface identifier format. Example: 0011:4514:1b00:0000');
			}

			return true;
		};

		o = s.taboption('general', form.Button, '_fill_from_ipv4', _('Fill from IPv4'));
		o.inputtitle = _('Use IPv4 → Hex');
		o.inputstyle = 'apply';
		o.onclick = function () {
			var ip4Input = document.querySelector('[data-name="ip4ifaddr"] input');
			var ifIdInput = document.querySelector('[data-name="interface_id"] input');
			if (ip4Input && ifIdInput) {
				var hex = ipv4ToHex(ip4Input.value);
				if (hex) {
					ifIdInput.value = hex;
					ifIdInput.dispatchEvent(new Event('change', { bubbles: true }));
				}
			}
		};

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


		setTimeout(function () {
			var ip4Input = document.querySelector('[data-name="ip4ifaddr"] input');
			var ifIdInput = document.querySelector('[data-name="interface_id"] input');

			if (ip4Input && ifIdInput) {
				ip4Input.addEventListener('input', function () {
					var peerInput = document.querySelector('[data-name="peeraddr"] input[type="hidden"]');
					if (peerInput && peerInput.value === '2404:9200:225:100::65') {
						var hex = ipv4ToHex(ip4Input.value);
						if (hex) {
							ifIdInput.value = hex;
							ifIdInput.dispatchEvent(new Event('change', { bubbles: true }));
						}
					}
				});
			}
		}, 100);
	}
});
