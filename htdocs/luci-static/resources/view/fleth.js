"use strict";
"require view";
"require fs";
"require uci";
"require form";
"require tools.widgets as widgets";

// fix css paading (kusa
const fleth_style = document.createElement("style");
fleth_style.innerHTML = `.cbi-value-field { padding-top: 6px;}</style>`;
document.head.appendChild(fleth_style);

return view.extend({
  // ¿
  load: async function () {
    return {
      status: (
        (await fs.exec("/usr/sbin/fleth", ["status"])).stdout || ""
      ).split("\n"),
      mape_status: (
        (await fs.exec("/usr/sbin/fleth", ["mape_status"])).stdout || ""
      ).split("\n"),
    };
  },
  render: async function (data) {
    let m, s, o;

    m = new form.Map(
      "fleth",
      _("Flet'h Configuration"),
      _(
        "Flet'h is a helper that can configure your IPv4 over IPv6 tunnel automatically."
      )
    );

    s = m.section(form.NamedSection, "global");
    s.tab("info", _("Information"));
    s.tab("general", _("General Settings"));

    o = s.taboption("info", form.DummyValue, "area", _("Area"));
    o.cfgvalue = function () {
      return _(data.status[0]);
    };

    o = s.taboption(
      "info",
      form.DummyValue,
      "dslite_privider",
      _("DS-Lite Provider")
    );
    o.cfgvalue = function () {
      return _(data.status[1]);
    };
    if (data.mape_status.length > 1 && data.mape_status[0] !== "UNKNOWN") {
      const mapeFields = [
        ["mape_provider", "MAP-E Provider"],
        ["mape_ipaddr", "IP Address"],
        ["mape_peeraddr", "Peer Address"],
        ["mape_ip4prefix", "IPv4 prefix"],
        ["mape_ip4prefixlen", "IPv4 Prefix Length"],
        ["mape_ip6prefix", "IPv6 Prefix"],
        ["mape_ip6prefixlen", "IPv6 Prefix Length"],
        ["mape_ealen", "EA Length"],
        ["mape_psidlen", "PSID Length"],
        ["mape_offset", "Offset"],
        ["mape_map_ports", "Available ports"],
      ];
      mapeFields.forEach((field, i) => {
        let o = s.taboption("info", form.DummyValue, field[0], _(field[1]));
        o.cfgvalue = function () {
          return data.mape_status[i];
        };
      });
    } else {
      o = s.taboption(
        "info",
        form.DummyValue,
        "mape_provider",
        _("MAP-E Provider")
      );
      o.cfgvalue = function () {
        return _("UNKNOWN");
      };
    }

    // o = s.taboption('general', form.Button, '_hook_luci-firewall-port-forward');
    // o.title      = '&#160;';
    // o.inputtitle = _('Hook Port Forward in firewall');
    // o.inputstyle = 'apply';
    // o.onclick = L.bind(this.hookFW, this, m);

    o = s.taboption(
      "general",
      form.Flag,
      "enabled",
      _("Auto Configure tunnel Interface")
    );
    o.rmempty = false;
    o.default = "0";

    o = s.taboption(
      "general",
      form.Flag,
      "ip6prefix_enabled",
      _("Auto Add IPv6 PD in IPv6 Interface"),
      _("We recommend enabling it in MAP-E and when not using Hikari Denwa.")
    );
    o.rmempty = false;
    o.default = "0";

    o = s.taboption(
      "general",
      form.Flag,
      "cron_dhcpv6_renew_enabled",
      _("Auto Renew DHCPv6"),
      _("We recommend enabling it when using CROSS(10Gbps) plan.")
    );
    o.rmempty = false;
    o.default = "0";

    // o = s.taboption(
    //   "general",
    //   form.Flag,
    //   "ip6relay_enabled",
    //   _("Auto Configure lan side IPv6"),
    //   _("You can hold both ISP and ULA address simultaneously.")
    // );
    // o.rmempty = false;
    // o.default = "0";

    o = s.taboption(
      "general",
      widgets.DeviceSelect,
      "interface6",
      _("IPv6 Interface"),
      _("Uplink interface")
    );
    o.noaliases = true;
    o.default = "wan6";

    o = s.taboption(
      "general",
      widgets.DeviceSelect,
      "interface",
      _("Tunnel Interface")
    );
    o.noaliases = true;
    o.default = "wan";

    // https://jp.finalfantasyxiv.com/lodestone/character/2621487/blog/3512706/
    // = 1460
    o = s.taboption(
      "general",
      form.Value,
      "mtu",
      _("Tunnel Interface MTU"),
      _("We recommend setting MTU to 1460 in MAP-E and DS-Lite.")
    );
    o.noaliases = true;
    o.default = "1460";

    o = s.taboption(
      "general",
      widgets.ZoneSelect,
      "interface_zone",
      _("Tunnel Interface Firewall Zone")
    );
    o.nocreate = true;
    o.default = "wan";

    return m.render();
  },
});
