"use strict";
"require view";
"require fs";
"require uci";
"require form";
"require ui";
"require tools.widgets as widgets";

// fix css paading (kusa
const fleth_style = document.createElement("style");
fleth_style.innerHTML = `.cbi-value-field { padding-top: 6px; }`;
document.head.appendChild(fleth_style);

return view.extend({
  load: function () {
    return Promise.all([
      L.resolveDefault(fs.exec("/usr/sbin/fleth", ["get_area"]), { stdout: "" }),
      L.resolveDefault(fs.exec("/usr/sbin/fleth", ["mape_status"]), { stdout: "" }),
      L.resolveDefault(fs.exec("/usr/sbin/fleth", ["get_prefix_length"]), { stdout: "" }),
    ]).then(function (results) {
      const area = (results[0].stdout || "").trim();
      const mape_status = (results[1].stdout || "").split("\n");
      const prefix_length = (results[2].stdout || "").trim();

      let areaValue = area || "UNKNOWN";
      const mapeIsUnknown = mape_status.length <= 1 || mape_status[0] === "UNKNOWN";

      // Special handling for NURO
      if (mape_status[0] === "NURO") {
        areaValue = "UNKNOWN(NURO)";
      }
      // If MAP-E is UNKNOWN, check pending status first
      if (mapeIsUnknown) {
        return L.resolveDefault(fs.exec("/usr/sbin/fleth", ["pending_status"]), { stdout: "" })
          .then(function (pendingResult) {
            const pendingStatus = (pendingResult.stdout || "").trim();
            // If pending status detected, return with pending flag
            if (pendingStatus.endsWith("_pending")) {
              const detectedArea = pendingStatus.split('_')[0];
              return {
                area: detectedArea,
                dslite_provider: "UNKNOWN",
                mape_status: mape_status,
                prefix_length: prefix_length || "UNKNOWN",
                isPending: true,
              };
            }
            // No pending status, check DS-Lite provider
            return L.resolveDefault(fs.exec("/usr/sbin/fleth", ["get_dslite_provider"]), { stdout: "" })
              .then(function (dsliteResult) {
                const dslite_provider = (dsliteResult.stdout || "").trim();
                return {
                  area: areaValue,
                  dslite_provider: dslite_provider || "UNKNOWN",
                  mape_status: mape_status,
                  prefix_length: prefix_length || "UNKNOWN",
                  isPending: false,
                };
              });
          });
      } else {
        // MAP-E detected, no need to check DS-Lite or pending
        return {
          area: areaValue,
          dslite_provider: "UNKNOWN",
          mape_status: mape_status,
          prefix_length: prefix_length || "UNKNOWN",
          isPending: false,
        };
      }
    });
  },

  render: async function (data) {
    let m, s, o;

    // Show pending construction popup if detected
    if (data.isPending) {
      ui.addNotification(_('Service Status'), E('div', [
        E('p', _('Optical line construction completed, provider configuration in progress. Please wait patiently.')),
        E('p', { style: 'color: #fdfdfd; font-size: 0.9em;' }, _('Service typically becomes available in the evening after construction is completed.'))
      ]), 'info');
    }

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
    s.tab("tools", _("Tools"));

    o = s.taboption("info", form.DummyValue, "area", _("Area"));
    o.cfgvalue = function () {
      return data.area;
    };

    o = s.taboption("info", form.DummyValue, "prefix_length", _("IPv6 Prefix Length"));
    o.cfgvalue = function () {
      const prefix = data.prefix_length;
      if (prefix && prefix !== "UNKNOWN") {
        const mode = prefix === "/56" ? "PD" : (prefix === "/64" ? "SLAAC" : "");
        return mode ? prefix + " → " + mode : prefix;
      }
      return prefix || "UNKNOWN";
    };

    o = s.taboption(
      "info",
      form.DummyValue,
      "dslite_privider",
      _("DS-Lite Provider")
    );
    o.cfgvalue = function () {
      return data.dslite_provider;
    };

    // Check if MAP-E data is available
    const hasMapeData = data.mape_status[0] !== "UNKNOWN" && data.mape_status.length > 1;

    // Always show MAP-E Provider
    o = s.taboption("info", form.DummyValue, "mape_provider", _("MAP-E Provider"));
    o.cfgvalue = function () {
      return data.mape_status[0] || _("UNKNOWN");
    };

    // Only show detailed MAP-E fields if we have valid data
    if (hasMapeData) {
      const mapeDetailFields = [
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

      mapeDetailFields.forEach((field, i) => {
        const [fieldName, fieldLabel] = field;
        o = s.taboption("info", form.DummyValue, fieldName, _(fieldLabel));
        o.cfgvalue = function () {
          return data.mape_status[i + 1] || "";
        };
      });
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
      "interface",
      _("Tunnel Interface")
    );
    o.noaliases = true;
    o.default = "wan";

    o = s.taboption(
      "general",
      widgets.DeviceSelect,
      "interface6",
      _("IPv6 Interface"),
      _("Uplink interface")
    );
    o.noaliases = true;
    o.default = "wan6"

    // https://jp.finalfantasyxiv.com/lodestone/character/2621487/blog/3512706/
    // = 1460
    o = s.taboption(
      "general",
      form.Value,
      "mtu",
      _("Tunnel Interface MTU"),
      _("We recommend setting MTU to 1460.")
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

    // LAN IPv6 Configuration section in Tools tab
    o = s.taboption("tools", form.DummyValue, "_lan_ipv6_recommendation");
    o.title = _("LAN IPv6 Configuration");
    o.cfgvalue = function () {
      const prefix = data.prefix_length;
      let icon = "";
      let text = "";

      if (prefix === "/64") {
        icon = "✓";
        text = _("Detected") + " /64 (" + _("SLAAC") + ")";
      } else if (prefix === "/56") {
        icon = "✓";
        text = _("Detected") + " /56 (" + _("PD") + ")";
      } else {
        icon = "⚠";
        text = _("Unable to detect IPv6 prefix");
      }

      return '<span style="color: #0088cc; font-weight: bold;">' + icon + ' ' + text + '</span>';
    };
    o.rawhtml = true;

    o = s.taboption("tools", form.Button, "_setup_ipv6_slaac");
    o.title = "&#160;";
    o.inputtitle = _("Configure SLAAC (/64)");
    o.inputstyle = data.prefix_length === "/64" ? "cbi-button-apply" : "cbi-button-action";
    o.onclick = L.bind(function (m) {
      return this.setupIPv6SLAAC(m);
    }, this, m);

    o = s.taboption("tools", form.Button, "_setup_ipv6_pd");
    o.title = "&#160;";
    o.inputtitle = _("Configure PD (/56)");
    o.inputstyle = data.prefix_length === "/56" ? "cbi-button-apply" : "cbi-button-action";
    o.onclick = L.bind(function (m) {
      return this.setupIPv6PD(m);
    }, this, m);

    const renderedNode = await m.render();

    // Hide footer when tools tab is active
    setTimeout(function() {
      const footer = document.querySelector('.cbi-page-actions');

      const toggleFooter = function() {
        // Check if tools tab is active
        const toolsActive = document.querySelector('.cbi-tab[data-tab="tools"]');
        if (footer) {
          footer.style.display = toolsActive ? 'none' : '';
        }
      };

      // Initial check on page load
      toggleFooter();

      // Listen to tab menu clicks
      const tabMenu = document.querySelector('.cbi-tabmenu');
      if (tabMenu) {
        const tabItems = tabMenu.querySelectorAll('li[data-tab]');
        tabItems.forEach(function(tabItem) {
          tabItem.addEventListener('click', function() {
            setTimeout(toggleFooter, 10);
          });
        });
      }
    }, 0);

    return renderedNode;
  },

  setupIPv6Config: function (mapObj, mode) {
    const modeText = mode === 'slaac' ? 'SLAAC' : 'PD';
    const command = mode === 'slaac' ? 'setup_ipv6_slaac' : 'setup_ipv6_pd';

    return new Promise(function (resolve, reject) {
      // First save current configuration
      mapObj.save()
        .then(function () {
          // Show loading message
          ui.showModal(_('Configuring LAN IPv6'), [
            E('p', { 'class': 'spinning' }, _('Applying ' + modeText + ' configuration...'))
          ]);

          // Execute the IPv6 setup
          return fs.exec('/usr/sbin/fleth', [command]);
        })
        .then(function (result) {
          ui.hideModal();

          if (result.code === 0 && result.stdout.trim() === 'SUCCESS') {
            ui.addNotification(null, E('p', _('Configuration applied successfully!')), 'info');
          } else {
            ui.addNotification(null, E('div', [
              E('p', _('Failed to apply configuration:')),
              E('pre', result.stdout || result.stderr || 'Unknown error')
            ]), 'error');
          }

          resolve();
        })
        .catch(function (error) {
          ui.hideModal();
          ui.addNotification(null, E('div', [
            E('p', _('Error executing configuration:')),
            E('pre', error.message || error)
          ]), 'error');
          reject(error);
        });
    });
  },

  setupIPv6SLAAC: function (mapObj) {
    return this.setupIPv6Config(mapObj, 'slaac');
  },

  setupIPv6PD: function (mapObj) {
    return this.setupIPv6Config(mapObj, 'pd');
  },
});