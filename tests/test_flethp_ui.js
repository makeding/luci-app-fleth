'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('htdocs/luci-static/resources/protocol/flethp.js', 'utf8');

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise(function (res, rej) {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function flush() {
	return Promise.resolve().then(function () {
		return Promise.resolve();
	}).then(function () {
		return Promise.resolve();
	});
}

function textOf(node) {
	if (!node)
		return '';
	if (node.textContent)
		return node.textContent;
	return (node.children || []).map(textOf).join(' ');
}

function makeInput(value) {
	const listeners = {};
	return {
		value: value,
		attributes: {},
		addEventListener: function (event, handler) {
			listeners[event] = handler;
		},
		getAttribute: function (name) {
			return this.attributes[name];
		},
		setAttribute: function (name, value) {
			this.attributes[name] = value;
		},
		trigger: function (event) {
			listeners[event]();
		}
	};
}

function createHarness(options) {
	const inputs = {
		tunlink: makeInput('wan6'),
		aftr: makeInput(''),
		ip4prefixlen: makeInput(''),
		gateway4: makeInput('')
	};
	let protocol;
	const calls = [];
	const polls = [];
	const removedPolls = [];
	const context = {
		console: console,
		_: function (value) { return value; },
		L: {
			resolveDefault: function (value, fallback) {
				return Promise.resolve(value).then(function (result) {
					return result == null ? fallback : result;
				});
			}
		},
		E: function (tag, attrs, children) {
			const node = {
				tag: tag,
				attrs: attrs || {},
				children: Array.isArray(children) ? children : (children == null ? [] : [ children ]),
				textContent: typeof children === 'string' ? children : '',
				addEventListener: function (event, handler) {
					this.listeners = this.listeners || {};
					this.listeners[event] = handler;
				}
			};
			return node;
		},
		document: {
			querySelector: function (selector) {
				return Object.keys(inputs).map(function (name) {
					return selector.indexOf('.' + name + '\"]') !== -1 ? inputs[name] : null;
				}).find(Boolean) || null;
			}
		},
		setTimeout: function (handler) { handler(); },
		clearTimeout: function () {},
		form: { DummyValue: function () {}, Value: function () {} },
		widgets: { DeviceSelect: function () {}, NetworkSelect: function () {} },
		network: {
			registerPatternVirtual: function () {},
			registerProtocol: function (_name, value) {
				protocol = value;
				return value;
			},
			getIfnameOf: function (name) { return name; }
		},
		poll: {
			add: function (callback) { polls.push(callback); },
			remove: function (callback) { removedPolls.push(callback); }
		},
		rpc: {
			declare: function () {
				return function () { return Promise.resolve(options.runtime); };
			}
		},
		fs: {
			exec: function (_path, argv) {
				calls.push(argv);
				return options.exec(argv);
			}
		}
	};
	vm.runInNewContext('(function () {\n' + source + '\n})()', context, { filename: 'flethp.js' });

	const formOptions = {};
	const section = { section: 'pt', children: [] };
	protocol.renderFormOptions(Object.assign(section, {
		taboption: function (_tab, _type, name) {
			formOptions[name] = {
				option: name,
				formvalue: function () { return inputs[name] ? inputs[name].value : ''; },
				getUIElement: function () { return inputs[name] || null; }
			};
			section.children.push(formOptions[name]);
			return formOptions[name];
		}
	}));

	return {
		calls: calls,
		polls: polls,
		removedPolls: removedPolls,
		inputs: inputs,
		status: formOptions._flethp_status.render(),
		text: function () { return textOf(this.status); }
	};
}

async function testInitialAndChangedPreview() {
	const results = [
		{ mode: 'MAP-E', client_ipv4: '203.0.113.8', client_prefixlen: '31', gateway_ipv4: '203.0.113.9', peeraddr: '2001:db8::1', ports: '10000-10015', state: 'detected', internet_verified: false },
		{ mode: 'DS-Lite', client_ipv4: '192.0.0.2', client_prefixlen: '29', gateway_ipv4: '192.0.0.1', peeraddr: '2001:db8::2', ports: '', state: 'detected', internet_verified: false },
		{ mode: 'DS-Lite', client_ipv4: '192.0.0.2', client_prefixlen: '30', gateway_ipv4: '192.0.0.1', peeraddr: '2001:db8::2', ports: '', state: 'detected', internet_verified: false },
		{ mode: 'MAP-E', client_ipv4: '203.0.113.8', client_prefixlen: '30', gateway_ipv4: '203.0.113.9', peeraddr: '2001:db8::1', ports: '10000-10015', state: 'detected', internet_verified: false }
	];
	const harness = createHarness({
		runtime: { up: false, data: {} },
		exec: function () { return Promise.resolve({ stdout: JSON.stringify(results.shift()) }); }
	});

	await flush();
	assert.equal(harness.calls.length, 1, 'preview runs before the interface is up');
	assert.deepEqual(Array.from(harness.calls[0]), [ 'passthrough_detect', 'wan6', '', '', '' ]);
	assert.match(harness.text(), /203\.0\.113\.8/);
	assert.match(harness.text(), /not applied until this interface is saved and connected/);

	harness.inputs.aftr.value = 'aftr.example.net';
	harness.inputs.aftr.trigger('change');
	await flush();
	assert.equal(harness.calls.length, 2, 'relevant unsaved AFTR change refreshes preview');
	assert.deepEqual(Array.from(harness.calls[1]), [ 'passthrough_detect', 'wan6', 'aftr.example.net', '', '' ]);
	assert.match(harness.text(), /192\.0\.0\.2/);
	assert.match(harness.text(), /DS-Lite/);

	harness.inputs.ip4prefixlen.value = '30';
	await harness.polls[0]();
	await flush();
	assert.equal(harness.calls.length, 3, 'polling detects a changed unsaved override even without an input event');
	assert.deepEqual(Array.from(harness.calls[2]), [ 'passthrough_detect', 'wan6', 'aftr.example.net', '30', '' ]);

	harness.inputs.aftr.value = '';
	harness.inputs.aftr.trigger('change');
	await flush();
	assert.deepEqual(Array.from(harness.calls[3]), [ 'passthrough_detect', 'wan6', '', '30', '' ], 'clearing an unsaved AFTR is passed as an empty value');

	harness.status.isConnected = false;
	await harness.polls[0]();
	assert.equal(harness.removedPolls.length, 1, 'detached status stops its poller');
}

async function testStalePreviewIsDiscarded() {
	const first = deferred();
	const second = deferred();
	let call = 0;
	const harness = createHarness({
		runtime: { up: false, data: {} },
		exec: function () { return (++call === 1 ? first.promise : second.promise); }
	});

	harness.inputs.tunlink.value = 'wan6b';
	harness.inputs.tunlink.trigger('change');
	second.resolve({ stdout: JSON.stringify({ mode: 'DS-Lite', client_ipv4: '192.0.0.2', client_prefixlen: '29', gateway_ipv4: '192.0.0.1', state: 'detected' }) });
	await flush();
	first.resolve({ stdout: JSON.stringify({ mode: 'MAP-E', client_ipv4: '198.51.100.4', client_prefixlen: '31', gateway_ipv4: '198.51.100.5', state: 'detected' }) });
	await flush();
	assert.match(harness.text(), /192\.0\.0\.2/);
	assert.doesNotMatch(harness.text(), /198\.51\.100\.4/);
}

async function testNetifdErrorCode() {
	const harness = createHarness({
		runtime: { data: {}, errors: [ { subsystem: 'flethp', code: 'NO_LOCAL_IPV6' } ] },
		exec: function () { return Promise.resolve({ stdout: '{}' }); }
	});

	await flush();
	assert.match(harness.text(), /NO_LOCAL_IPV6/);
	assert.match(harness.text(), /no usable local IPv6 address/);
}

Promise.resolve()
	.then(testInitialAndChangedPreview)
	.then(testStalePreviewIsDiscarded)
	.then(testNetifdErrorCode)
	.then(function () {
		console.log('flethp LuCI preview tests passed');
	})
	.catch(function (error) {
		console.error(error.stack || error);
		process.exitCode = 1;
	});
