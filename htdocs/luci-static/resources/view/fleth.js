'use strict';
'require view';
'require fs';
'require uci';
'require form';
'require tools.widgets as widgets';
const fleth_style = document.createElement('style');
fleth_style.innerHTML = `.cbi-value-field { padding-top: 6px;}</style>`
document.head.appendChild(fleth_style);
return view.extend({
    // ¿
    load: async function(){
        return {
            // area : (await fs.exec("/usr/sbin/fleth",['get_area'])).stdout,
            // dslite_privider: (await fs.exec("/usr/sbin/fleth",['get_dslite_provider'])).stdout,
            status: ((await fs.exec("/usr/sbin/fleth",['status'])).stdout || []).split('\n'),
            mape_status: ((await fs.exec("/usr/sbin/fleth",['mape_status'])).stdout || []).split('\n'),
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
        if(data.mape_status.length > 1){
            if (data.mape_status[0] !== 'UNKNOWN') {
                const mapeFields = [
                    ['mape_provider', 'MAP-E Provider'],
                    ['mape_ipaddr', 'IP Address'],
                    ['mape_peeraddr', 'Peer Address'],
                    ['mape_ip4prefix', 'IPv4 prefix'],
                    ['mape_ip4prefixlen', 'IPv4 Prefix Length'],
                    ['mape_ip6prefix', 'IPv6 Prefix'],
                    ['mape_ip6prefixlen', 'IPv6 Prefix Length'],
                    ['mape_ealen', 'EA Length'],
                    ['mape_psidlen', 'PSID Length'],
                    ['mape_offset', 'Offset'],
                    ['mape_map_ports', 'Available ports']
                ];
                mapeFields.forEach((field,i) =>{
                    if (i === 0) return;
                    let o = s.taboption('info', form.DummyValue, field[0], _(field[1]));
                    o.cfgvalue = function() {
                        return data.mape_status[i];
                    };
                });                
            }
        } else {
            o = s.taboption('info', form.DummyValue, 'mape_provider', _('MAP-E Provider'));
            o.cfgvalue =  function() {
                return 'UNKNOWN';
            };
        }

        o = s.taboption('general', form.Flag, 'enabled', _('Auto Configure tunnel Interface'));
		o.rmempty = false;
        o.default = '0';
        
        o = s.taboption('general', form.Flag, 'ip6prefix_enabled', _('Auto Configure IPv6 PD in IPv6 Interface'), _('general.ipprefix_enabled.description'));
		o.rmempty = false;
        o.default = '0';

        // o = s.taboption('general', form.Flag, 'ip6relay_enabled', _('Auto Configure IPv6 with relay mode'));
		// o.rmempty = false;
        // o.default = '0';

        // o = s.taboption('general', form.ListValue, 'type', _('Tunnel Type'), _('Now only support DS-Lite'))
        // o.value('auto', _('Auto'))
        // o.value('ds-lite', _('DS-Lite'))
        // o.value('map-e', _('MAP-E'))
        // o.default = 'auto'

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