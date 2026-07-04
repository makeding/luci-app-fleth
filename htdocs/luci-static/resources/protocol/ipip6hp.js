// Based on fleth ipip6h.js
// IPIP6H passthrough variant: bind a native device and hand IPv4 to a downstream host.
'use strict';
'require form';
'require network';
'require protocol.ipip6h-common as ipip6hCommon';

network.registerPatternVirtual(/^ipip6hp-.+$/);

return network.registerProtocol('ipip6hp', {
	getI18n: function () {
		return _("IPv4 over IPv6 passthrough (Flet'h)");
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

		ipip6hCommon.renderPeerAddress(s);
		ipip6hCommon.renderIPv4Address(s, _('Client IPv4 Address'), null, '111.0.0.2');

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

		ipip6hCommon.renderInterfaceId(s);
		ipip6hCommon.renderInterfaceIdButtons(s);
		ipip6hCommon.renderActivation(s, 'ipip6hp');
		ipip6hCommon.renderAdvancedBase(s);

		o = s.taboption('advanced', form.Value, 'ip4table', _('IPv4 routing table'),
			_('Routing table used by the source rule for the client IPv4 address'));
		o.placeholder = '100';
		o.datatype = 'or(uinteger,uciname)';
		o.depends('defaultroute', '1');

		o = s.taboption('advanced', form.Value, 'ip4rule_priority', _('IPv4 source rule priority'));
		o.placeholder = '10000';
		o.datatype = 'uinteger';
		o.depends('defaultroute', '1');

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
			var currentPeer = (ip4Input && prefixInput && prefixInput.value === '31') ? ipip6hCommon.ipv4Peer31(ip4Input.value) : '';
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
						var gateway = (prefixInput && prefixInput.value === '31') ? ipip6hCommon.ipv4Peer31(ip4Input.value) : '';
						if (gateway && (!gatewayInput.value || gatewayInput.value === lastAutoGateway)) {
							gatewayInput.value = gateway;
							lastAutoGateway = gateway;
							gatewayInput.dispatchEvent(new Event('change', { bubbles: true }));
						}
					}
				}

				if (prefixInput)
					prefixInput.addEventListener('input', updateAutoGateway);

				ipip6hCommon.installIPv4InterfaceIdAutofill(updateAutoGateway);
			}
		}, 100);
	}
});
