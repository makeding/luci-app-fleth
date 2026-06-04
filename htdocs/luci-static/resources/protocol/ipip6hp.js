// Based on fleth ipip6h.js
// IPIP6H passthrough variant: bind a native device and hand IPv4 to a downstream host.
'use strict';
'require form';
'require network';
'require tools.widgets as widgets';

network.registerPatternVirtual(/^ipip6hp-.+$/);

return network.registerProtocol('ipip6hp', {
	getI18n: function () {
		return _('IPv4 over IPv6 passthrough (fleth edition)');
	},

	getIfname: function () {
		return this._ubus('l3_device') || 'ipip6hp-%s'.format(this.sid);
	},

	getPackageName: function () {
		return 'luci-proto-ipip6hp';
	},

	getIPAddr: function () {
		return this.get('ip4ifaddr') || null;
	},

	getIPAddrs: function () {
		var ip4ifaddr = this.get('ip4ifaddr');
		return ip4ifaddr ? [ip4ifaddr + '/32'] : [];
	},

	getNetmask: function () {
		return this.get('ip4ifaddr') ? '255.255.255.255' : null;
	},

	isFloating: function () {
		return false;
	},

	isVirtual: function () {
		return false;
	},

	containsDevice: function (ifname) {
		var device = this.getDevice ? this.getDevice() : null;
		var deviceName = device ? device.getName() : null;
		ifname = network.getIfnameOf(ifname);
		return (ifname == this.getIfname() || ifname == deviceName);
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

		function ipv4Peer31(ipv4) {
			if (!ipv4) return '';

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

		o = s.taboption('general', form.Value, 'peeraddr', _('BR Address'),
			_('Border Relay IPv6 address'));
		o.value('2404:9200:225:100::65', '2404:9200:225:100::65 (v6plus)');
		o.value('2400:2000:4:0:a000::1999', '2400:2000:4:0:a000::1999 (SoftBank 10G)');
		o.default = '2404:9200:225:100::65';
		o.datatype = 'or(hostname,ip6addr("nomask"))';
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'ip4ifaddr', _('Client IPv4 Address'));
		o.rmempty = false;
		o.datatype = 'ip4addr("nomask")';
		o.placeholder = '111.0.0.2';

		o = s.taboption('general', form.Value, 'ip4prefixlen', _('Client IPv4 CIDR prefix length'),
			_('Suggested prefix length for the downstream client static IPv4 configuration'));
		o.default = '31';
		o.placeholder = '31';
		o.datatype = 'range(1,32)';

		o = s.taboption('general', form.Value, 'gateway4', _('Client Gateway IPv4 Address'),
			_('Address used by the downstream client as its default gateway; the router answers ARP for this address'));
		o.rmempty = false;
		o.datatype = 'ip4addr("nomask")';
		o.placeholder = '111.0.0.3';

		o = s.taboption('general', form.Value, 'interface_id', _('IPv6 Interface ID'));
		o.placeholder = '006f:0000:0100:0000';
		o.optional = true;
		o.validate = function (_section_id, value) {
			var peerInput = document.querySelector('[data-name="peeraddr"] input[type="hidden"]');
			var peeraddr = peerInput ? peerInput.value : '';
			var requiresInterfaceId = (peeraddr === '2404:9200:225:100::65' || peeraddr === '2400:2000:4:0:a000::1999');

			if (requiresInterfaceId && (!value || value.length === 0))
				return _('IPv6 Interface ID is required for v6plus and SoftBank 10G');

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

		o = s.taboption('general', form.Flag, 'activation_enabled', _('Activation request'),
			_('Run one HTTP request after the virtual interface is created'));
		o.default = o.disabled;

		o = s.taboption('general', form.Value, 'activation_url', _('Activation URL'),
			_('The backend will call this URL with curl after the ipip6hp virtual interface is created'));
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

		o = s.taboption('advanced', form.Value, 'ip4table', _('IPv4 routing table'),
			_('Routing table used by the source rule for the client IPv4 address'));
		o.placeholder = '100';
		o.datatype = 'or(uinteger,uciname)';
		o.depends('defaultroute', '1');

		o = s.taboption('advanced', form.Value, 'ip4rule_priority', _('IPv4 source rule priority'));
		o.placeholder = '10000';
		o.datatype = 'uinteger';
		o.depends('defaultroute', '1');

		o = s.taboption('advanced', form.Value, 'mtu', _('Use MTU on tunnel interface'));
		o.placeholder = '1460';
		o.datatype = 'range(1280,1500)';

		o = s.taboption('advanced', form.Flag, 'allow_shared_device', _('Allow shared passthrough device'),
			_('Allow the selected device to already have another IPv4 address'));
		o.default = o.disabled;

		o = s.taboption('advanced', form.Flag, 'proxy_arp', _('Proxy ARP'),
			_('Reply to downstream ARP requests for routed IPv4 destinations'));
		o.default = o.enabled;

		setTimeout(function () {
			var ip4Input = document.querySelector('[data-name="ip4ifaddr"] input');
			var prefixInput = document.querySelector('[data-name="ip4prefixlen"] input');
			var gatewayInput = document.querySelector('[data-name="gateway4"] input');
			var ifIdInput = document.querySelector('[data-name="interface_id"] input');
			var currentPeer = (ip4Input && prefixInput && prefixInput.value === '31') ? ipv4Peer31(ip4Input.value) : '';
			var lastAutoGateway = (gatewayInput && gatewayInput.value === currentPeer) ? gatewayInput.value : '';

			if (ip4Input && ifIdInput) {
				if (gatewayInput) {
					gatewayInput.addEventListener('input', function () {
						if (gatewayInput.value !== lastAutoGateway)
							lastAutoGateway = '';
					});
				}

				function updateAutoGateway() {
					if (gatewayInput) {
						var gateway = (prefixInput && prefixInput.value === '31') ? ipv4Peer31(ip4Input.value) : '';
						if (gateway && (!gatewayInput.value || gatewayInput.value === lastAutoGateway)) {
							gatewayInput.value = gateway;
							lastAutoGateway = gateway;
							gatewayInput.dispatchEvent(new Event('change', { bubbles: true }));
						}
					}
				}

				ip4Input.addEventListener('input', function () {
					updateAutoGateway();
					var peerInput = document.querySelector('[data-name="peeraddr"] input[type="hidden"]');
					if (peerInput && peerInput.value === '2404:9200:225:100::65') {
						var hex = ipv4ToHex(ip4Input.value);
						if (hex) {
							ifIdInput.value = hex;
							ifIdInput.dispatchEvent(new Event('change', { bubbles: true }));
						}
					}
				});

				if (prefixInput)
					prefixInput.addEventListener('input', updateAutoGateway);
			}
		}, 100);
	}
});
