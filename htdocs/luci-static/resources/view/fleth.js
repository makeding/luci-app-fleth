"use strict";
"require view";
"require fs";
"require form";
"require ui";

// fix css paading (kusa
const fleth_style = document.createElement("style");
fleth_style.innerHTML = `
  .cbi-value-title { padding-top: 6px !important; }
  .port-highlight {
    background-color: rgb(207, 226, 255);
    color: #1f2937;
    padding: 1px 4px;
    border-radius: 3px;
    font-weight: 500;
  }

  @media (prefers-color-scheme: dark) {
    .port-highlight {
      background-color: rgb(59, 130, 246);
      color: #f8fafc;
    }
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
    ]).then(function (results) {
      const area = (results[0].stdout || "").trim();
      const mape_status = (results[1].stdout || "").split("\n");
      const prefix_length = (results[2].stdout || "").trim();
      let areaValue = area || "UNKNOWN";
      const mapeIsUnknown = mape_status.length <= 1 || mape_status[0] === "UNKNOWN";

      // Base return object with common fields
      const baseData = {
        mape_status: mape_status,
        prefix_length: prefix_length || "UNKNOWN",
      };

      if (mape_status[0] === "NURO") areaValue = "UNKNOWN(NURO)";

      // Check prefix alignment for non-/56,/64 with MAP-E
      const needsAlignmentCheck = !mapeIsUnknown &&
        !["/56", "/64", "UNKNOWN"].includes(prefix_length);

      const alignmentCheckPromise = needsAlignmentCheck
        ? L.resolveDefault(fs.exec("/usr/sbin/fleth", ["check_alignment"]), { stdout: "" })
        : Promise.resolve({ stdout: "" });

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

      return alignmentCheckPromise.then(function (alignmentResult) {
        const alignment_check = (alignmentResult.stdout || "").trim();
        return { ...baseData, area: areaValue, dslite_provider: "UNKNOWN", isPending: false, alignment_check: alignment_check };
      });
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

    // Show warning for prefix alignment issues
    if (data.alignment_check && data.alignment_check.startsWith('NOT_ALIGNED:')) {
      const hextet = data.alignment_check.split(':')[1];
      const alignedHextet = hextet.substring(0, 2) + '00';
      ui.addNotification(_('Prefix Alignment Warning'), E('div', [
        E('p', _('The detected IPv6 prefix is not aligned for MAP-E or Independent IP.')),
        E('p', { style: 'font-size: 0.9em;' },
          _('The 4th hextet is') + ' ' + hextet + ', ' +
          _('but these tunnel types require a /64 network whose 4th hextet ends with "00".') + ' ' +
          _('Example:') + ' ' + alignedHextet + '::/64'
        ),
        E('p', { style: 'font-size: 0.9em;' },
          _('When using MAP-E or Independent IP, IPv4 over IPv6 connectivity may not work properly.') + ' ' +
          _('Please check your upstream router\'s prefix delegation settings.')
        )
      ]), 'warning');
    }

    m = new form.JSONMap(
      { global: {} },
      _("Flet'h Configuration"),
      _(
        "Flet'h provides LuCI protocol helpers for IPv4 over IPv6 tunnels."
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
              E('div', { 'class': 'cbi-value-field' }, [
                E('div', { 'class': 'cbi-value-description' }, _('Highlighted ports are easier to remember.')),
                contentDiv
              ])
            ]);
          }.bind(o);
        } else {
          o.cfgvalue = function () {
            return data.mape_status[i + 1] || "";
          };
        }
      });
    }


    o = s.taboption("general", form.DummyValue, "_protocol_setup", _("Protocol Setup"));
    o.rawhtml = true;
    o.cfgvalue = function () {
      return '<p>' + _("Automatic tunnel configuration has been removed from this page.") + '</p>' +
        '<p>' + _("Open Network → Interfaces, edit the target interface, then choose the required protocol: Flet'h automatic IPv4 over IPv6, IPv4 over IPv6 (Flet'h), or IPv4 over IPv6 passthrough (Flet'h).") + '</p>';
    };

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

    // Uplink Client ID Fix section in Tools tab
    o = s.taboption("tools", form.DummyValue, "_wan6_clientid_fix_desc");
    o.title = _("Uplink Client ID Fix");
    o.cfgvalue = function () {
      return _("OpenWrt 25.12 and later use the Default DUID as a randomized DHCPv6 client identifier. This does not meet NGN requirements.");
    };

    o = s.taboption("tools", form.Button, "_apply_wan6_clientid_fix");
    o.title = "&#160;";
    o.inputtitle = _("Fix");
    o.inputstyle = "cbi-button-apply";
    o.onclick = L.bind(function (m) {
      return this.applyWan6ClientIdFix(m);
    }, this, m);

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
      ui.showModal(_('Configuring LAN IPv6'), [
        E('p', { 'class': 'spinning' }, _('Applying ' + modeText + ' configuration...'))
      ]);

      fs.exec('/usr/sbin/fleth', [command])
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

  applyWan6ClientIdFix: function (mapObj) {
    return new Promise(function (resolve, reject) {
      ui.showModal(_('Applying Fix'), [
        E('p', { 'class': 'spinning' }, _('Setting Uplink Client ID...'))
      ]);

      fs.exec('/usr/sbin/fleth', ['set_wan6_clientid'])
        .then(function (result) {
          ui.hideModal();

          if (result.code === 0 && result.stdout.trim() === 'SUCCESS') {
            ui.addNotification(null, E('p', _('Fix applied successfully. Uplink has been restarted.')), 'info');
          } else {
            ui.addNotification(null, E('div', [
              E('p', _('Failed to apply fix:')),
              E('pre', result.stdout || result.stderr || 'Unknown error')
            ]), 'error');
          }

          resolve();
        })
        .catch(function (error) {
          ui.hideModal();
          ui.addNotification(null, E('div', [
            E('p', _('Error applying fix:')),
            E('pre', error.message || error)
          ]), 'error');
          reject(error);
        });
    });
  },

});
