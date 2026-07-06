// Encapsulate in IIFE to avoid global scope pollution.
(function () {
	'use strict';

	if (window.flethHookLoaded)
		return;

	window.flethHookLoaded = true;

	var mapeStatus = [];
	var macRegex = /([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/;
	var callNetworkInterfaceStatus = L.rpc.declare({
		object: 'network.interface',
		method: 'status',
		params: [ 'interface' ]
	});
	var callNetworkDeviceStatus = L.rpc.declare({
		object: 'network.device',
		method: 'status',
		params: [ 'name' ]
	});

	function normalizeMacAddress(value) {
		var match = String(value || '').match(macRegex);

		return match ? match[0].replace(/:/g, '').toLowerCase() : '';
	}

	function getInterfaceNameFromClientIdField(clientIdNode) {
		var field = clientIdNode.getAttribute('data-field') || '';
		var match = field.match(/^cbid\.network\.([^.]+)\.clientid$/);

		return match ? match[1] : '';
	}

	function getMacAddressFromModal(clientIdNode) {
		var context = clientIdNode.closest('#modal_overlay') || clientIdNode.closest('.modal') || clientIdNode.parentNode;
		var inputNodes = context ? context.querySelectorAll('input') : [];
		var mac;
		var i;

		for (i = 0; i < inputNodes.length; i++) {
			mac = normalizeMacAddress(inputNodes[i].value);
			if (mac)
				return mac;
		}

		return normalizeMacAddress(context ? context.textContent : '');
	}

	function getMacAddressFromInterfaceStatus(interfaceName) {
		return L.resolveDefault(callNetworkInterfaceStatus(interfaceName), {}).then(function (interfaceStatus) {
			var deviceName = interfaceStatus.l3_device || interfaceStatus.device || '';

			if (deviceName.charAt(0) === '@') {
				return L.resolveDefault(callNetworkInterfaceStatus(deviceName.substring(1)), {}).then(function (linkedStatus) {
					deviceName = linkedStatus.l3_device || linkedStatus.device || '';
					return deviceName;
				});
			}

			return deviceName;
		}).then(function (deviceName) {
			if (!deviceName)
				return '';

			return L.resolveDefault(callNetworkDeviceStatus(deviceName), {}).then(function (deviceStatus) {
				return normalizeMacAddress(deviceStatus.macaddr);
			});
		});
	}

	function hookClientIdField(clientIdNode) {
		var clientIdInput = clientIdNode.querySelector('input');
		var clientIdField = clientIdNode.querySelector('.cbi-value-field');
		var interfaceName = getInterfaceNameFromClientIdField(clientIdNode);
		var fillButton;
		var clientIdAlert;

		if (!clientIdInput || !clientIdField || !interfaceName)
			return;

		clientIdNode.setAttribute('data-fleth-ngn-hooked', '1');

		fillButton = document.createElement('button');
		fillButton.type = 'button';
		fillButton.className = 'cbi-button';
		fillButton.innerText = _('Fill with NGN format');
		fillButton.style.marginTop = '.5rem';

		clientIdAlert = document.createElement('div');
		clientIdAlert.className = 'cbi-value-description';
		clientIdAlert.style.color = '#F44336';

		fillButton.addEventListener('click', function () {
			clientIdAlert.innerText = '';
			fillButton.disabled = true;

			return getMacAddressFromInterfaceStatus(interfaceName).then(function (mac) {
				mac = mac || getMacAddressFromModal(clientIdNode);

				if (!/^[0-9a-f]{12}$/.test(mac)) {
					clientIdAlert.innerText = _('Unable to detect interface MAC address.');
					return;
				}

				clientIdInput.value = '00030001' + mac;
				clientIdInput.dispatchEvent(new Event('input', { bubbles: true }));
				clientIdInput.dispatchEvent(new Event('change', { bubbles: true }));
			}).catch(function () {
				clientIdAlert.innerText = _('Unable to detect interface MAC address.');
			}).then(function () {
				fillButton.disabled = false;
			});
		});

		clientIdField.appendChild(fillButton);
		clientIdField.appendChild(clientIdAlert);
	}

	function hookInterfaceClientIdFields() {
		var nodes = document.querySelectorAll('div[data-name="clientid"][data-field^="cbid.network."][data-field$=".clientid"]');
		var i;

		for (i = 0; i < nodes.length; i++) {
			if (nodes[i].getAttribute('data-fleth-ngn-hooked') !== '1')
				hookClientIdField(nodes[i]);
		}
	}

	function observeAddedNodes(selector, callback, attributeFilter) {
		var observeTarget = document.querySelector('#modal_overlay') || document.body;
		var observer = new MutationObserver(function (mutationsList) {
			mutationsList.forEach(function (mutation) {
				mutation.addedNodes.forEach(function (node) {
					if (node.nodeType === Node.ELEMENT_NODE &&
					    (node.matches(selector) || node.querySelector(selector)))
						callback();
				});
			});
		});

		observer.observe(observeTarget, {
			childList: true,
			attributes: true,
			subtree: true,
			attributeFilter: attributeFilter
		});

		callback();
	}

	function hookFirewallPortForward() {
		var srcInterfaceNode = document.querySelector('[data-name="src"]');
		var srcDportNode;
		var srcDportInput;
		var ports;
		var randomButton;
		var portInvalidAlert;
		var descriptionNode;
		var debounceTimer = 0;

		if (!srcInterfaceNode)
			return Promise.resolve();

		return Promise.resolve().then(function () {
			if (mapeStatus.length > 0)
				return mapeStatus;

			return L.resolveDefault(L.fs.exec('/usr/sbin/fleth', [ 'mape_status' ]), { stdout: '' }).then(function (result) {
				mapeStatus = (result.stdout || '').split('\n');
				return mapeStatus;
			});
		}).then(function () {
			srcDportNode = document.querySelector('[data-name="src_dport"]');
			if (!srcDportNode || srcDportNode.getAttribute('data-fleth-port-hooked') === '1')
				return;

			srcDportInput = srcDportNode.querySelector('input');
			if (!srcDportInput)
				return;

			srcDportNode.setAttribute('data-fleth-port-hooked', '1');
			ports = mapeStatus.length > 10
				? mapeStatus[mapeStatus.length - 1].split(' ')
				: Array.apply(null, Array(65535)).map(function (_, i) { return String(i + 1); });

			randomButton = document.createElement('button');
			randomButton.className = 'cbi-button';
			randomButton.innerText = _('Random Port');
			randomButton.style.marginTop = '.5rem';
			randomButton.addEventListener('click', function () {
				srcDportInput.value = ports[Math.floor(Math.random() * ports.length)];
				srcDportInput.dispatchEvent(new Event('input', { bubbles: true }));
			});

			portInvalidAlert = document.createElement('div');
			portInvalidAlert.className = 'cbi-value-description';
			portInvalidAlert.style.color = '#F44336';

			srcDportInput.addEventListener('input', function () {
				var currentTime = Date.now();
				debounceTimer = currentTime;

				setTimeout(function () {
					var currentPortList;
					var i;

					if (currentTime !== debounceTimer)
						return;

					currentPortList = srcDportInput.value.split('-');
					for (i = 0; i < currentPortList.length; i++) {
						if (ports.indexOf(currentPortList[i]) === -1) {
							portInvalidAlert.innerText = _("You can't access this port from MAP-E interface");
							srcDportInput.classList.add('cbi-input-invalid');
							return;
						}
					}

					portInvalidAlert.innerText = '';
					srcDportInput.classList.remove('cbi-input-invalid');
				}, 200);
			});

			descriptionNode = srcDportNode.querySelector('.cbi-value-description');
			if (descriptionNode) {
				descriptionNode.parentNode.insertBefore(portInvalidAlert, descriptionNode);
				descriptionNode.parentNode.insertBefore(randomButton, descriptionNode);
			} else {
				srcDportNode.appendChild(randomButton);
				srcDportNode.appendChild(portInvalidAlert);
			}
		});
	}

	if (location.pathname === '/cgi-bin/luci/admin/network/firewall/forwards')
		observeAddedNodes('div[data-name="src_dport"]', hookFirewallPortForward, [ 'data-name' ]);

	if ([ '/cgi-bin/luci/admin/network', '/cgi-bin/luci/admin/network/network' ].indexOf(location.pathname) !== -1)
		observeAddedNodes('div[data-name="clientid"][data-field^="cbid.network."][data-field$=".clientid"]', hookInterfaceClientIdFields, [ 'data-name', 'data-field' ]);
})();
