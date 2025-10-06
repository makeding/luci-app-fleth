"use strict";
"require view";
"require fs";
"require uci";
"require form";
"require ui";
"require tools.widgets as widgets";

// fix css paading (kusa
const fleth_style = document.createElement("style");
fleth_style.innerHTML = `.cbi-value-field { padding-top: 6px;}</style>`;
document.head.appendChild(fleth_style);

return view.extend({
  load: function () {
    return Promise.all([
      L.resolveDefault(fs.exec("/usr/sbin/fleth", ["get_area"]), { stdout: "" }),
      L.resolveDefault(fs.exec("/usr/sbin/fleth", ["mape_status"]), { stdout: "" }),
    ]).then(function (results) {
      const area = (results[0].stdout || "").trim();
      const mape_status = (results[1].stdout || "").split("\n");

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

    o = s.taboption("info", form.DummyValue, "area", _("Area"));
    o.cfgvalue = function () {
      return data.area;
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
      _("Auto Renew DHCPv6") + " (Deprecated)",
      _("If you subscribe the CROSS(10Gbps) plan, you may experience disconnections approximately once a day. Enabling this option may help alleviate the issue.") + " " + _("This option is deprecated and may be removed in future versions.")
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

    // Actions section in General Settings
    o = s.taboption("general", form.DummyValue, "_actions_description");
    o.title = _("Actions");
    o.description = _("Actions will automatically save current configuration before execution.");
    o.cfgvalue = function () {
      return "";
    };

    o = s.taboption("general", form.Button, "_setup_ipv6_slaac");
    o.title = "&#160;";
    o.inputtitle = _("Setup IPv6 SLAAC for NEXT(1Gbps) and without Hikari Denwa");
    o.inputstyle = "apply";
    o.onclick = L.bind(function (m) {
      return this.setupIPv6SLAAC(m);
    }, this, m);

    o = s.taboption("general", form.Button, "_setup_ipv6_pd");
    o.title = "&#160;";
    o.inputtitle = _("Setup IPv6 PD for CROSS(10Gbps) or with Hikari Denwa");
    o.inputstyle = "apply";
    o.onclick = L.bind(function (m) {
      return this.setupIPv6PD(m);
    }, this, m);

    return m.render();
  },

  setupIPv6SLAAC: function (mapObj) {
    return new Promise(function (resolve, reject) {
      // First save current configuration
      mapObj.save()
        .then(function () {
          // Show loading message
          ui.showModal(_('Setting up IPv6 SLAAC'), [
            E('p', { 'class': 'spinning' }, _('Applying IPv6 SLAAC configuration for NEXT(1Gbps) without Hikari Denwa...'))
          ]);

          // Execute the IPv6 SLAAC setup
          return fs.exec('/usr/sbin/fleth', ['setup_ipv6_slaac']);
        })
        .then(function (result) {
          ui.hideModal();

          if (result.code === 0 && result.stdout.trim() === 'SUCCESS') {
            ui.addNotification(null, E('p', _('IPv6 SLAAC configuration applied successfully!')), 'info');
          } else {
            ui.addNotification(null, E('div', [
              E('p', _('Failed to apply IPv6 SLAAC configuration:')),
              E('pre', result.stdout || result.stderr || 'Unknown error')
            ]), 'error');
          }

          resolve();
        })
        .catch(function (error) {
          ui.hideModal();
          ui.addNotification(null, E('div', [
            E('p', _('Error executing IPv6 SLAAC setup:')),
            E('pre', error.message || error)
          ]), 'error');
          reject(error);
        });
    });
  },

  setupIPv6PD: function (mapObj) {
    return new Promise(function (resolve, reject) {
      // First save current configuration
      mapObj.save()
        .then(function () {
          // Show loading message
          ui.showModal(_('Setting up IPv6 PD'), [
            E('p', { 'class': 'spinning' }, _('Applying IPv6 PD configuration for CROSS(10Gbps) or with Hikari Denwa...'))
          ]);

          // Execute the IPv6 PD setup
          return fs.exec('/usr/sbin/fleth', ['setup_ipv6_pd']);
        })
        .then(function (result) {
          ui.hideModal();

          if (result.code === 0 && result.stdout.trim() === 'SUCCESS') {
            ui.addNotification(null, E('p', _('IPv6 PD configuration applied successfully!')), 'info');
          } else {
            ui.addNotification(null, E('div', [
              E('p', _('Failed to apply IPv6 PD configuration:')),
              E('pre', result.stdout || result.stderr || 'Unknown error')
            ]), 'error');
          }

          resolve();
        })
        .catch(function (error) {
          ui.hideModal();
          ui.addNotification(null, E('div', [
            E('p', _('Error executing IPv6 PD setup:')),
            E('pre', error.message || error)
          ]), 'error');
          reject(error);
        });
    });
  },
});