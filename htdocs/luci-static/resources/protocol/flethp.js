// Flet'H IPoE passthrough: OpenWrt owns the IPv4-over-IPv6 tunnel while a
// single downstream router owns LAN, NAT and its firewall.
'use strict';
'require form';
'require network';
'require poll';
'require rpc';
'require fs';
'require tools.widgets as widgets';

network.registerPatternVirtual(/^flethp-.+$/);

var callInterfaceStatus = rpc.declare({
	object: 'network.interface',
	method: 'status',
	params: [ 'interface' ]
});

function readFormValue(section, sectionId, name, fallback) {
	var children = section.children || [];
	var option;
	var value;
	var i;

	for (i = 0; i < children.length; i++)
		if (children[i].option === name || children[i].name === name) {
			option = children[i];
			break;
		}

	if (!option)
		return fallback;
	if (typeof option.formvalue === 'function')
		value = option.formvalue(sectionId);
	if ((value === undefined || value === null) && typeof option.cfgvalue === 'function')
		value = option.cfgvalue(sectionId);

	return value === undefined || value === null || value === '' ? fallback : String(value);
}

function runtimeData(status) {
	var data = status && status.data ? status.data : {};

	return data.flethp || status.flethp || data;
}

function statusValue(value) {
	return value === undefined || value === null || value === '' ? _('Not available') : String(value);
}

function errorDescription(code, message) {
	if (message)
		return message;

	switch (code) {
	case 'INVALID_INTERFACE_NAME':
	case 'INVALID_DEVICE':
		return _('The selected interface or dedicated downstream device is invalid.');
	case 'INVALID_ROUTING_OPTIONS':
	case 'ROUTING_CONFLICT':
		return _('The policy-routing table or rule priority conflicts with an existing route or rule.');
	case 'INVALID_AFTR':
	case 'AFTR_RESOLVE_FAIL':
		return _('The AFTR endpoint is invalid or cannot be resolved over IPv6.');
	case 'MISSING_DEPENDENCY':
	case 'FW4_REQUIRED':
		return _('The required fw4/nftables component is unavailable.');
	case 'SHARED_DEVICE_HAS_IPV4':
		return _('The dedicated downstream device already has an IPv4 address.');
	case 'NO_LOCAL_IPV6':
	case 'INVALID_LOCAL_IPV6':
		return _('The selected IPv6 uplink has no usable local IPv6 address.');
	case 'NO_MAPE_OR_DSLITE_PROVIDER':
		return _('No MAP-E or DS-Lite provider was detected.');
	case 'INVALID_PSID':
	case 'INVALID_DOWNSTREAM_ADDRESS':
		return _('The calculated downstream IPv4 settings are invalid.');
	case 'SYSCTL_FAILED':
		return _('OpenWrt could not enable the required downstream ARP setting.');
	case 'NFT_SETUP_FAILED':
		return _('OpenWrt could not install the required nftables forwarding rules.');
	case 'TUNNEL_SETUP_FAILED':
		return _('OpenWrt could not create the IPv6 tunnel or local tunnel address.');
	case 'ROUTE_SETUP_FAILED':
		return _('OpenWrt could not install the dedicated downstream route or policy rule.');
	case 'STATE_WRITE_FAILED':
		return _('OpenWrt could not save the configured runtime state.');
	default:
		return _('The tunnel setup did not complete.');
	}
}

function getErrorCode(status, runtime) {
	var errors = (status && status.errors) || [];
	var i;

	for (i = 0; i < errors.length; i++)
		if (errors[i].subsystem === 'flethp' && errors[i].code)
			return errors[i].code;

	return runtime.error_code || runtime.error || status.error_code || status.error;
}

function renderStatus(sectionId, section) {
	var values = {};
	var fields = [
		[ 'state', _('Applied tunnel state') ],
		[ 'mode', _('Detected protocol') ],
		[ 'client_ipv4', _('Downstream IPv4 address') ],
		[ 'client_prefixlen', _('Downstream IPv4 prefix length') ],
		[ 'gateway_ipv4', _('Downstream gateway') ],
		[ 'peeraddr', _('BR / AFTR address') ],
		[ 'ports', _('Available MAP-E ports') ],
		[ 'internet_verified', _('Internet connectivity') ]
	];
	var changeNotice = E('div', {
		'class': 'cbi-value-description',
		'style': 'min-height: 8em; line-height: 1.4; overflow-wrap: anywhere;',
		'aria-live': 'polite'
	}, _('Detecting downstream settings...'));
	var retryButton = E('button', {
		'class': 'cbi-button',
		'type': 'button',
		'style': 'margin-top: .35em;'
	}, _('Retry detection'));
	var rows = fields.map(function (field) {
		values[field[0]] = E('span', {
			'tabindex': field[0] === 'ports' ? '0' : '-1',
			'style': field[0] === 'ports' ? 'display: block; height: 5.4em; overflow: auto; white-space: pre-wrap; word-break: break-word;' : (field[0] === 'peeraddr' ? 'display: block; min-height: 4.2em; line-height: 1.4; word-break: break-word;' : 'word-break: break-word;')
		}, _('Not available'));
		return E('div', { 'style': 'display: grid; grid-template-columns: minmax(11em, 32%) 1fr; gap: .5em; margin: .2em 0;' }, [
			E('strong', {}, field[1]), values[field[0]]
		]);
	});
	var lastAddress = null;
	var runtime = {};
	var detected = null;
	var detectRequest = 0;
	var lastPreviewKey = null;
	var pendingPreviewKey = null;
	var detectTimer = null;
	var addressChanged = false;
	var lastRuntimeAddress = null;
	var lastPreviewAt = 0;
	var stopped = false;
	var hasConnected = false;
	var root;

	function renderValues() {
		var source = detected || runtime;
		var address;
		var error;
		var key;

		values.state.textContent = statusValue(runtime.state || _('Not configured'));
		for (key in values) {
			if (key === 'state')
				continue;
			if (key === 'internet_verified')
				values[key].textContent = runtime[key] === true || runtime[key] === '1' ? _('Verified') : _('Not verified');
			else
				values[key].textContent = statusValue(source[key]);
		}

		address = source.client_ipv4 ? [ source.client_ipv4, source.client_prefixlen || '', source.gateway_ipv4 || '' ].join('/') : '';
		error = runtime.error_code || runtime.error;
		if (runtime.state === 'configured' && detected && runtime.client_ipv4 === detected.client_ipv4 &&
			runtime.client_prefixlen === detected.client_prefixlen && runtime.gateway_ipv4 === detected.gateway_ipv4)
			addressChanged = false;
		if (error)
			changeNotice.textContent = _('Passthrough setup failed: ') + error + ' — ' + errorDescription(error, runtime.error_message) + '. ' + _('Check the dedicated device and IPv6 uplink, then reconnect the interface.');
		else if (detected && detected.error_code)
			changeNotice.textContent = _('Unable to detect downstream settings: ') + detected.error_code + ' — ' + errorDescription(detected.error_code) + '. ' + _('Update the IPv6 uplink or AFTR endpoint, then try again.');
		else if (addressChanged || (lastAddress !== null && address !== lastAddress)) {
			addressChanged = true;
			changeNotice.textContent = _('Downstream IPv4 settings changed. Update the downstream router static WAN address, mask, and gateway before reconnecting it.');
		}
		else if (detected)
			changeNotice.textContent = _('Downstream settings are detected for the current unsaved configuration. They are not applied until this interface is saved and connected.');
		else if (runtime.state === 'configured')
			changeNotice.textContent = runtime.internet_verified === true || runtime.internet_verified === '1' ?
				_('Tunnel configuration and downstream internet connectivity are verified.') :
				_('The tunnel is configured. Downstream internet connectivity has not been verified yet.');
		else
			changeNotice.textContent = _('Waiting for IPv6 uplink and tunnel detection. The interface will recover automatically when they are available.');

		if (address)
			lastAddress = address;
	}

	function updateRuntime() {
		if (root && root.isConnected === false) {
			if (!hasConnected)
				return;
			if (!stopped) {
				stopped = true;
				detectRequest++;
				if (detectTimer)
					clearTimeout(detectTimer);
				poll.remove(updateRuntime);
			}
			return false;
		}
		hasConnected = true;
		return L.resolveDefault(callInterfaceStatus(sectionId), null).then(function (status) {
			var runtimeAddress;
			if (!status) {
				runtime = {};
				renderValues();
				scheduleDetectionIfChanged();
				return;
			}

			runtime = runtimeData(status);
			runtime.error_code = getErrorCode(status, runtime);
			runtimeAddress = runtime.client_ipv4 ? [ runtime.client_ipv4, runtime.client_prefixlen || '', runtime.gateway_ipv4 || '' ].join('/') : '';
			if (runtimeAddress && runtimeAddress !== lastRuntimeAddress) {
				lastRuntimeAddress = runtimeAddress;
				detected = null;
				lastPreviewKey = null;
			}
			renderValues();
			scheduleDetectionIfChanged();
		}).catch(function () {});
	}

	function previewArguments() {
		return [
			readFormValue(section, sectionId, 'tunlink', 'wan6'),
			readFormValue(section, sectionId, 'aftr', ''),
			readFormValue(section, sectionId, 'ip4prefixlen', ''),
			readFormValue(section, sectionId, 'gateway4', '')
		];
	}

	function scheduleDetectionIfChanged() {
		var args = previewArguments();
		var key = args.join('\u0000');

		if ((key === lastPreviewKey && Date.now() - lastPreviewAt < 30000) || key === pendingPreviewKey)
			return;
		if (detectTimer)
			clearTimeout(detectTimer);
		detectRequest++;
		changeNotice.textContent = _('Detecting downstream settings...');
		pendingPreviewKey = key;
		detectTimer = setTimeout(function () {
			detectTimer = null;
			refreshDetection(args, key);
		}, 250);
	}

	function refreshDetection(args, key) {
		var request = ++detectRequest;

		changeNotice.textContent = _('Detecting downstream settings...');
		retryButton.disabled = true;
		return fs.exec('/usr/sbin/fleth', [ 'passthrough_detect' ].concat(args)).then(function (result) {
			var parsed;
			if (request !== detectRequest)
				return;
			try {
				parsed = JSON.parse(result.stdout || '{}');
				if ((result.code && result.code !== 0) || (!parsed.error_code && !parsed.client_ipv4))
					parsed = { error_code: 'SETUP_FAILED' };
			} catch (error) {
				parsed = { error_code: 'SETUP_FAILED' };
			}
			detected = parsed;
			lastPreviewKey = key;
			lastPreviewAt = Date.now();
			pendingPreviewKey = null;
			renderValues();
		}).catch(function () {
			if (request !== detectRequest)
				return;
			detected = { error_code: 'SETUP_FAILED' };
			lastPreviewKey = key;
			lastPreviewAt = Date.now();
			pendingPreviewKey = null;
			renderValues();
		}).then(function () {
			if (request === detectRequest)
				retryButton.disabled = false;
		});
	}

	function bindDetectionInputs() {
		[ 'tunlink', 'aftr', 'ip4prefixlen', 'gateway4' ].forEach(function (name) {
			var children = section.children || [];
			var option = children.filter(function (child) { return child.option === name || child.name === name; })[0];
			var input = option && option.getUIElement ? option.getUIElement(sectionId) : null;
			if (input && input.node && input.node.addEventListener)
				input = input.node;
			if (input && input.addEventListener)
				input.addEventListener('change', scheduleDetectionIfChanged);
		});
	}

	root = E('div', { 'class': 'cbi-value', 'style': 'align-items: start;' }, [
		E('label', { 'class': 'cbi-value-title' }, _('Passthrough status')),
		E('div', { 'class': 'cbi-value-field', 'style': 'min-width: 0;' }, rows.concat([ changeNotice, retryButton ]))
	]);
	poll.add(updateRuntime, 5);
	updateRuntime();
	setTimeout(function () {
		bindDetectionInputs();
		scheduleDetectionIfChanged();
	}, 0);
	retryButton.addEventListener('click', function () {
		lastPreviewKey = null;
		scheduleDetectionIfChanged();
	});

	return root;
}

return network.registerProtocol('flethp', {
	getI18n: function () {
		return _("Flet'H IPoE (Passthrough)");
	},

	getIfname: function () {
		return this._ubus('l3_device') || ('flethp-' + this.sid);
	},

	getPackageName: function () {
		return 'luci-proto-fleth';
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
		return ifname === this.getIfname() || ifname === deviceName;
	},

	renderFormOptions: function (s) {
		var o;

		o = s.taboption('general', form.DummyValue, '_flethp_status');
		o.render = function () {
			return renderStatus(s.section, s);
		};

		o = s.taboption('general', widgets.DeviceSelect, 'device', _('Downstream device'),
			_('Required. Select one dedicated physical port or VLAN for one downstream router.'));
		o.rmempty = false;
		o.nocreate = true;

		o = s.taboption('general', widgets.NetworkSelect, 'tunlink', _('IPv6 uplink'));
		o.default = 'wan6';
		o.exclude = s.section;
		o.rmempty = false;

		o = s.taboption('general', form.Value, 'aftr', _('AFTR endpoint'),
			_('Optional. Leave empty to detect MAP-E first and DS-Lite second.'));
		o.datatype = 'or(hostname,ip6addr("nomask"))';
		o.placeholder = 'aftr.example.net';

		o = s.taboption('general', form.DummyValue, '_downstream_setup', _('Downstream static WAN configuration'));
		o.rawhtml = true;
		o.cfgvalue = function () {
			return '<p>' + _('Use the detected address, prefix length, and gateway above to configure the downstream router WAN as static IPv4 before saving this interface.') + '</p>' +
				'<p>' + _('Set downstream DNS manually to public DNS servers. Do not use this OpenWrt router as the downstream DNS server.') + '</p>' +
				'<p>' + _('This dedicated device needs no firewall zone. The passthrough protocol limits forwarding to this device and downstream address.') + '</p>';
		};

		o = s.taboption('general', form.Value, 'mtu', _('MTU'));
		o.default = '1460';
		o.placeholder = '1460';
		o.datatype = 'range(1280,1500)';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'ip4prefixlen', _('Downstream IPv4 prefix length'),
			_('Optional override for downstream devices that cannot use the detected prefix length.'));
		o.datatype = 'range(1,31)';
		o.placeholder = '31';

		o = s.taboption('advanced', form.Value, 'gateway4', _('Downstream gateway'),
			_('Optional override for the downstream router default gateway. OpenWrt answers ARP for this address.'));
		o.datatype = 'ip4addr("nomask")';
		o.placeholder = '192.0.0.1';

		o = s.taboption('advanced', form.Value, 'ip4table', _('IPv4 routing table'),
			_('A dedicated policy-routing table. It must not conflict with an existing table.'));
		o.default = '110';
		o.placeholder = '110';
		o.datatype = 'range(1,252)';
		o.rmempty = false;

		o = s.taboption('advanced', form.Value, 'ip4rule_priority', _('IPv4 source rule priority'),
			_('A dedicated source-rule priority. It must not conflict with an existing rule.'));
		o.default = '11000';
		o.placeholder = '11000';
		o.datatype = 'range(1,32765)';
		o.rmempty = false;

		o = s.taboption('firewall', form.DummyValue, '_firewall_zone_warning');
		o.render = function () {
			return E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, '\u00a0'),
				E('div', { 'class': 'cbi-value-field' }, [
					E('div', { 'class': 'cbi-value-description' }, [
						E('strong', {}, _('Do not assign a firewall zone to Flet\'H IPoE (Passthrough).'))
					])
				])
			]);
		};
	}
});
