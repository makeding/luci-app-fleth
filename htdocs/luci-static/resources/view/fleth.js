"use strict";
"require view";
"require fs";
"require uci";
"require form";
"require ui";
"require tools.widgets as widgets";

// fix css paading (kusa
const fleth_style = document.createElement("style");
fleth_style.innerHTML = `
  .cbi-value-field { padding-top: 6px; }
  .port-highlight {
    background-color: rgb(207, 226, 255);
    padding: 1px 4px;
    border-radius: 3px;
    font-weight: 500;
  }
`;
document.head.appendChild(fleth_style);

return view.extend({
  // Cache for port highlight calculations
  _portHighlightCache: {},

  // Check if a port number is "special" (memorable/interesting)
  _isSpecialPort: function(port) {
    const len = port.length;

    // Use cached result if available
    if (this._portHighlightCache[port] !== undefined) {
      return this._portHighlightCache[port];
    }

    const half = len / 2;
    const reversed = port.split('').reverse().join('');
    const counts = {};
    for (let c of port) counts[c] = (counts[c] || 0) + 1;

    // Check special patterns
    const isSpecial = /(\d)\1{2,}/.test(port) ||  // consecutive repeats (e.g. 111, 222)
      port.endsWith('0') ||  // ends with 0
      (len >= 2 && len % 2 === 0 && port.substring(0, half) === port.substring(half)) ||  // ABAB pattern
      (len >= 3 && port === reversed) ||  // palindrome (e.g. 12321)
      Object.values(counts).some(n => n >= 3);  // digit appears 3+ times

    // Cache the result
    this._portHighlightCache[port] = isSpecial;
    return isSpecial;
  },

  load: function () {
    return Promise.all([
      L.resolveDefault(fs.exec("/usr/sbin/fleth", ["get_area"]), { stdout: "" }),
      L.resolveDefault(fs.exec("/usr/sbin/fleth", ["mape_status"]), { stdout: "" }),
      L.resolveDefault(fs.exec("/usr/sbin/fleth", ["get_prefix_length"]), { stdout: "" }),
      L.resolveDefault(fs.exec("/usr/sbin/fleth", ["mapsh_status"]), { stdout: "" }),
    ]).then(function (results) {
      const area = (results[0].stdout || "").trim();
      const mape_status = (results[1].stdout || "").split("\n");
      const prefix_length = (results[2].stdout || "").trim();
      const mapsh_status = (results[3].stdout || "").trim();
      let areaValue = area || "UNKNOWN";
      const mapeIsUnknown = mape_status.length <= 1 || mape_status[0] === "UNKNOWN";

      // Base return object with common fields
      const baseData = {
        mape_status: mape_status,
        prefix_length: prefix_length || "UNKNOWN",
        mapIsPatched: mapsh_status === "patched",
      };

      if (mape_status[0] === "NURO") areaValue = "UNKNOWN(NURO)";

      if (mapeIsUnknown) {
        return L.resolveDefault(fs.exec("/usr/sbin/fleth", ["pending_status"]), { stdout: "" })
          .then(function (pendingResult) {
            const pendingStatus = (pendingResult.stdout || "").trim();
            if (pendingStatus.endsWith("_pending")) {
              return { ...baseData, area: pendingStatus.split('_')[0], dslite_provider: "UNKNOWN", isPending: true };
            }
            return L.resolveDefault(fs.exec("/usr/sbin/fleth", ["get_dslite_provider"]), { stdout: "" })
              .then(function (dsliteResult) {
                return { ...baseData, area: areaValue, dslite_provider: (dsliteResult.stdout || "").trim() || "UNKNOWN", isPending: false };
              });
          });
      }
      return { ...baseData, area: areaValue, dslite_provider: "UNKNOWN", isPending: false };
    });
  },

  render: async function (data) {
    let m, s, o;

    // Show notification for pending service status (fiber construction completed but ISP setup not ready)
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
      "dslite_provider",
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

        // Special rendering for Available ports with highlighting
        if (fieldName === "mape_map_ports") {
          o.rawhtml = true;
          o.cfgvalue = function () {
            const portsString = data.mape_status[i + 1] || "";
            if (!portsString) return "";

            // Split ports into individual numbers and highlight special ones
            const ports = portsString.split(/\s+/).filter(p => p);
            const viewContext = this;  // Save reference for use in arrow function
            const highlightedPorts = ports.map(port => {
              return viewContext._isSpecialPort(port) ?
                '<span class="port-highlight">' + port + '</span>' :
                port;
            });

            return highlightedPorts.join(' ');
          }.bind(this);
          // Override render to display as div instead of input
          o.render = function () {
            const value = this.cfgvalue();
            const contentDiv = E('div', { 'style': 'line-height: 1.8; word-wrap: break-word;' });
            contentDiv.innerHTML = value;
            return E('div', { 'class': 'cbi-value' }, [
              E('label', { 'class': 'cbi-value-title' }, _(fieldLabel)),
              E('div', { 'class': 'cbi-value-field' }, contentDiv)
            ]);
          }.bind(o);
        } else {
          o.cfgvalue = function () {
            return data.mape_status[i + 1] || "";
          };
        }
      });
    }


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
      widgets.NetworkSelect,
      "interface",
      _("Tunnel Interface")
    );
    o.nocreate = false;
    o.default = "wan";

    o = s.taboption(
      "general",
      widgets.NetworkSelect,
      "interface6",
      _("IPv6 Interface"),
      _("Uplink interface")
    );
    o.nocreate = false;
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
    o.datatype = "range(1280,1500)";
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

    // map.sh Management section in Tools tab
    o = s.taboption("tools", form.DummyValue, "_mapsh_description");
    o.title = _("map.sh Management");
    o.cfgvalue = function () {
      return _("OpenWrt's map.sh has bugs: only the first port group works and ICMP is broken. Click below to replace with the fixed version.") +
        ' <a href="https://github.com/fakemanhk/openwrt-jp-ipoe/tree/main" target="_blank" style="color: #0088cc;">(' + _("See more") + ')</a>';
    };
    o.rawhtml = true;

    o = s.taboption("tools", form.DummyValue, "_mapsh_status");
    o.title = "&#160;";
    o.cfgvalue = function () {
      let icon = "";
      let text = "";

      if (data.mapIsPatched) {
        icon = "✓";
        text = _("Patched version");
      } else {
        icon = "⚠";
        text = _("Original version");
      }

      return '<span style="color: #0088cc; font-weight: bold;">' + icon + ' ' + text + '</span>';
    };
    o.rawhtml = true;

    o = s.taboption("tools", form.Button, "_patch_mapsh");
    o.title = "&#160;";
    o.inputtitle = _("Patch");
    o.inputstyle = data.mapIsPatched ? "cbi-button-action" : "cbi-button-apply";
    o.onclick = L.bind(function (m) {
      return this.patchMapSh(m);
    }, this, m);

    o = s.taboption("tools", form.Button, "_restore_mapsh");
    o.title = "&#160;";
    o.inputtitle = _("Restore");
    o.inputstyle = "cbi-button-action";
    o.onclick = L.bind(function (m) {
      return this.restoreMapSh(m);
    }, this, m);
    o.depends("_patch_mapsh", "");

    const renderedNode = await m.render();

    // Hide footer when tools tab is active
    setTimeout(function () {
      const footer = document.querySelector('.cbi-page-actions');

      const toggleFooter = function () {
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
        tabItems.forEach(function (tabItem) {
          tabItem.addEventListener('click', function () {
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

  manageMapSh: function (mapObj, action) {
    const actionConfig = {
      patch: { verb: _('Patching'), gerund: _('Downloading...') },
      restore: { verb: _('Restoring'), gerund: _('Restoring...') }
    };

    const config = actionConfig[action];
    const actionLower = action.toLowerCase();

    return new Promise(function (resolve, reject) {
      mapObj.save()
        .then(function () {
          ui.showModal(config.verb, [
            E('p', { 'class': 'spinning' }, config.gerund)
          ]);

          return fs.exec('/usr/sbin/fleth', [action + '_map.sh']);
        })
        .then(function (result) {
          ui.hideModal();

          if (result.code === 0 && result.stdout.trim() === 'SUCCESS') {
            ui.addNotification(null, E('p', _('Operation completed successfully! Please restart the network interface manually.')), 'info');

            setTimeout(function () {
              window.location.reload();
            }, 5000);
          } else {
            ui.addNotification(null, E('div', [
              E('p', _('Failed to ' + actionLower + ':')),
              E('pre', result.stdout || result.stderr || 'Unknown error')
            ]), 'error');
          }

          resolve();
        })
        .catch(function (error) {
          ui.hideModal();
          ui.addNotification(null, E('div', [
            E('p', _('Error ' + config.gerund.toLowerCase() + ':')),
            E('pre', error.message || error)
          ]), 'error');
          reject(error);
        });
    });
  },

  patchMapSh: function (mapObj) {
    return this.manageMapSh(mapObj, 'patch');
  },

  restoreMapSh: function (mapObj) {
    return this.manageMapSh(mapObj, 'restore');
  },
});