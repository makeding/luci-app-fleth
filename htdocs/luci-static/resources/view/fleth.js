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
    // Return empty data immediately to allow page to render
    return {
      status: [_("Loading..."), _("Loading...")],
      mape_status: [_("Loading...")],
    };
  },
  
  // Function to execute command with timeout
  execWithTimeout: function(cmd, args, timeout) {
    return Promise.race([
      fs.exec(cmd, args),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Command timeout')), timeout)
      )
    ]).catch(err => {
      console.warn(`Command failed: ${cmd} ${args.join(' ')}`, err);
      return { stdout: "" };
    });
  },
  
  // Load status data asynchronously after page render
  loadStatusAsync: async function() {
    try {
      // Execute both commands in parallel with timeout
      const [statusResult, mapeResult] = await Promise.all([
        this.execWithTimeout("/usr/sbin/fleth", ["status"], 5000),
        this.execWithTimeout("/usr/sbin/fleth", ["mape_status"], 5000)
      ]);
      
      const status = (statusResult.stdout || "").split("\n");
      const mape_status = (mapeResult.stdout || "").split("\n");
      
      // Update area field
      const areaElem = document.querySelector('[data-name="area"] .cbi-value-field');
      let areaValue = status[0] || "UNKNOWN";
      if (areaElem && status[0]) {
        areaElem.textContent = _(status[0] || "UNKNOWN");
      }
      
      // Update DS-Lite provider field
      const dsliteElem = document.querySelector('[data-name="dslite_privider"] .cbi-value-field');
      let dsliteValue = status[1] || "UNKNOWN";
      if (dsliteElem && status[1]) {
        dsliteElem.textContent = _(status[1] || "UNKNOWN");
      }
      
      // Update MAP-E fields
      let mapeIsUnknown = true;
      if (mape_status.length > 1 && mape_status[0] !== "UNKNOWN") {
        mapeIsUnknown = false;
        const mapeFields = [
          "mape_provider", "mape_ipaddr", "mape_peeraddr", 
          "mape_ip4prefix", "mape_ip4prefixlen", "mape_ip6prefix",
          "mape_ip6prefixlen", "mape_ealen", "mape_psidlen",
          "mape_offset", "mape_map_ports"
        ];
        
        mapeFields.forEach((field, i) => {
          const elem = document.querySelector(`[data-name="${field}"] .cbi-value-field`);
          if (elem && mape_status[i]) {
            elem.textContent = mape_status[i];
          }
        });
      } else {
        // Update MAP-E Provider to UNKNOWN when not available
        const mapeProviderElem = document.querySelector('[data-name="mape_provider"] .cbi-value-field');
        if (mapeProviderElem) {
          mapeProviderElem.textContent = _("UNKNOWN");
        }
      }
      
      // Check pending status when area is not UNKNOWN but both DSLite and MAP-E are UNKNOWN
      if (areaValue !== "UNKNOWN" && dsliteValue === "UNKNOWN" && mapeIsUnknown) {
        try {
          const pendingResult = await this.execWithTimeout("/usr/sbin/fleth", ["pending_status"], 5000);
          const pendingStatus = (pendingResult.stdout || "").trim();
          
          if (pendingStatus === "_pending") {
            // Update area field to show pending status
            if (areaElem) {
              areaElem.textContent = _(areaValue) + " " + _("(Service Pending)");
            }
          }
        } catch (error) {
          console.warn("Failed to check pending status:", error);
        }
      }
    } catch (error) {
      console.error("Failed to load status data:", error);
      
      // Set error state for fields
      const areaElem = document.querySelector('[data-name="area"] .cbi-value-field');
      if (areaElem) {
        areaElem.textContent = _("Failed to load");
      }
      
      const dsliteElem = document.querySelector('[data-name="dslite_privider"] .cbi-value-field');
      if (dsliteElem) {
        dsliteElem.textContent = _("Failed to load");
      }
    }
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
    if (data.mape_status.length > 1 && data.mape_status[0] !== "UNKNOWN" && data.mape_status[0] !== _("Loading...")) {
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
        return data.mape_status[0] === _("Loading...") ? _("Loading...") : _("UNKNOWN");
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
      _("If you subscribe the CROSS(10Gbps) plan, you may experience disconnections approximately once a day. Enabling this option may help alleviate the issue.")
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

    // Start async loading of status data after render
    setTimeout(() => this.loadStatusAsync(), 100);
    
    return m.render();
  },
});
