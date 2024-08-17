'use strict';
'require view';
'require fs';
'require uci';
'require form';
'require tools.widgets as widgets';
return view.extend({
    // ¿
    load: async function(){
        return {
            // area : (await fs.exec("/usr/sbin/fleth",['get_area'])).stdout,
            // dslite_privider: (await fs.exec("/usr/sbin/fleth",['get_dslite_provider'])).stdout,
            status: ((await fs.exec("/usr/sbin/fleth",['status'])).stdout || []).split('\n'),
        }
    },
    // handleLinkStart:async function(m , ev) {
    //     try {
    //         await fs.exec("/etc/hotplug.d/iface/25-fleth-ipprefix",['manual']);
    //     } catch (error) {
    //         console.warn(error);
    //     }
    //     try {
    //         await fs.exec("/usr/sbin/fleth",['auto']);
    //     } catch (error) {
    //         console.warn(error);
    //     }
    //     L.bind(m.render, m);
	// },
	render: async function (data) {
		let m, s, o;

		m = new form.Map('fleth', _('Flet\'h Configuration'),
        _('Flet\'h is a helper that can configure your IPv4 over IPv6 tunnel automatically'));

        s = m.section(form.NamedSection, 'global', 'fleth');
        s.tab('info', _('Information'));
        s.tab('general', _('General Settings'));

        o = s.taboption('info', form.DummyValue, 'area', _('Area'));
		o.cfgvalue = function() {
			return data.status[0];
		};

        o = s.taboption('info', form.DummyValue, 'dslite_privider', _('DS-Lite Provider'));
		o.cfgvalue = function() {
			return data.status[1];
		};

        o = s.taboption('general', form.Flag, 'enabled', _('Auto Configure tunnel Interface'));
		o.rmempty = false;
        o.default = '0';
        
        o = s.taboption('general', form.Flag, 'ip6prefix_enabled', _('Auto Configure IPv6 PD in IPv6 Interface'));
		o.rmempty = false;
        o.default = '0';

        o = s.taboption('general', form.ListValue, 'type', _('Tunnel Type'), _('Now only support DS-Lite'))
        o.value('auto', _('Auto'))
        o.value('ds-lite', _('DS-Lite'))
        // o.value('map-e', _('MAP-E'))
        o.default = 'auto'

        o = s.taboption('general', widgets.DeviceSelect, 'interface6', _('IPv6 Interface'), _('Uplink interface'));
		o.noaliases = true;
        o.default = 'wan6';

        
        o = s.taboption('general', widgets.DeviceSelect, 'interface', _('Tunnel Interface'));
		o.noaliases = true;
        o.default = 'wan';

        // https://jp.finalfantasyxiv.com/lodestone/character/2621487/blog/3512706/
        o = s.taboption('general', form.Value, 'mtu', _('Tunnel MTU'));
		o.noaliases = true;
        o.default = '1460';
        o.desctiption = _('general.mtu.descriptn')
        

        // o = s.taboption('general', form.Button, '_restart');
		// o.title      = '&#160;';
		// o.inputtitle = _('Link Start');
		// o.inputstyle = 'apply';
		// o.onclick = L.bind(this.handleLinkStart, this, m);
        return m.render();
        
        
	},
    handleSaveApply: async function(ev) {
        // await this.super('handleSaveApply', [ev])
        await this.__base__.handleSaveApply(ev);
        // console.log('triggered save & apply button');
        try {
            await fs.exec("/etc/hotplug.d/iface/25-fleth-ipprefix",['manual']);
        } catch (error) {
            console.warn(error);
        }
        try {
            await fs.exec("/usr/sbin/fleth",['auto']);
        } catch (error) {
            console.warn(error);
        }
    }
});