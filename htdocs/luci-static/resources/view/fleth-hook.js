// Encapsulate in IIFE to avoid global scope pollution
(function () {
  'use strict';

  let mape_status = [];
  const mac_regex = /([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}/;
  const callNetworkInterfaceStatus = L.rpc.declare({
    object: "network.interface",
    method: "status",
    params: ["interface"],
  });
  const callNetworkDeviceStatus = L.rpc.declare({
    object: "network.device",
    method: "status",
    params: ["name"],
  });

  function normalizeMacAddress(value) {
    const match = String(value || "").match(mac_regex);

    return match ? match[0].replace(/:/g, "").toLowerCase() : "";
  }

  function getInterfaceNameFromClientIdField(dom_clientid) {
    const field = dom_clientid.getAttribute("data-field") || "";
    const match = field.match(/^cbid\.network\.([^.]+)\.clientid$/);

    return match ? match[1] : "";
  }

  function getMacAddressFromModal(dom_clientid) {
    const dom_context = dom_clientid.closest("#modal_overlay") || dom_clientid.closest(".modal") || dom_clientid.parentNode;
    const input_nodes = dom_context ? dom_context.querySelectorAll("input") : [];
    for (let i = 0; i < input_nodes.length; i++) {
      const mac = normalizeMacAddress(input_nodes[i].value);
      if (mac) {
        return mac;
      }
    }

    return normalizeMacAddress(dom_context ? dom_context.textContent : "");
  }

  async function getMacAddressFromInterfaceStatus(interface_name) {
    const interface_status = await L.resolveDefault(callNetworkInterfaceStatus(interface_name), {});
    let device_name = interface_status.l3_device || interface_status.device || "";

    if (device_name.charAt(0) === "@") {
      const linked_status = await L.resolveDefault(callNetworkInterfaceStatus(device_name.substring(1)), {});
      device_name = linked_status.l3_device || linked_status.device || "";
    }

    if (!device_name) {
      return "";
    }

    const device_status = await L.resolveDefault(callNetworkDeviceStatus(device_name), {});

    return normalizeMacAddress(device_status.macaddr);
  }

  function hookClientIdField(dom_clientid) {
    const dom_clientid_input = dom_clientid.querySelector("input");
    const dom_clientid_field = dom_clientid.querySelector(".cbi-value-field");
    const interface_name = getInterfaceNameFromClientIdField(dom_clientid);
    if (!dom_clientid_input || !dom_clientid_field || !interface_name) {
      return;
    }

    dom_clientid.setAttribute("data-fleth-ngn-hooked", "1");

    const dom_fill_button = document.createElement("button");
    dom_fill_button.type = "button";
    dom_fill_button.className = "cbi-button";
    dom_fill_button.innerText = _("Fill with NGN format");
    dom_fill_button.style.marginTop = ".5rem";

    const dom_clientid_alert = document.createElement("div");
    dom_clientid_alert.className = "cbi-value-description";
    dom_clientid_alert.style.color = "#F44336";

    dom_fill_button.addEventListener("click", async () => {
      dom_clientid_alert.innerText = "";
      dom_fill_button.disabled = true;

      try {
        const mac = await getMacAddressFromInterfaceStatus(interface_name) || getMacAddressFromModal(dom_clientid);

        if (!/^[0-9a-f]{12}$/.test(mac)) {
          dom_clientid_alert.innerText = _("Unable to detect interface MAC address.");
          return;
        }

        dom_clientid_input.value = "00030001" + mac;
        dom_clientid_input.dispatchEvent(new Event("input", { bubbles: true }));
        dom_clientid_input.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (error) {
        dom_clientid_alert.innerText = _("Unable to detect interface MAC address.");
      } finally {
        dom_fill_button.disabled = false;
      }
    });

    dom_clientid_field.appendChild(dom_fill_button);
    dom_clientid_field.appendChild(dom_clientid_alert);
  }

  function InterfaceClientIdHook() {
    document.querySelectorAll('div[data-name="clientid"][data-field^="cbid.network."][data-field$=".clientid"]').forEach((dom_clientid) => {
      if (dom_clientid.getAttribute("data-fleth-ngn-hooked") !== "1") {
        hookClientIdField(dom_clientid);
      }
    });
  }

  function observeAddedNodes(selector, callback, attributeFilter) {
    const observe_target = document.querySelector("#modal_overlay") || document.body;
    const observer = new MutationObserver((mutationsList) => {
      mutationsList.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE &&
              (node.matches(selector) || node.querySelector(selector))) {
            callback();
          }
        });
      });
    });

    observer.observe(observe_target, {
      childList: true,
      attributes: true,
      subtree: true,
      attributeFilter: attributeFilter,
    });

    callback();
  }

  async function FWPFhook() {
    // Fetch MAP-E status if not already cached
    if (mape_status.length === 0) {
      mape_status = (
        (await L.fs.exec("/usr/sbin/fleth", ["mape_status"])).stdout || ""
      ).split("\n");
    }

    const dom_src_interface = document.querySelector('[data-name="src"]');
    if (!dom_src_interface) {
      return;
    }

    // Get available ports from MAP-E status, or all ports if not using MAP-E
    let ports =
      mape_status.length > 10
        ? mape_status[mape_status.length - 1].split(" ")
        : new Array(65535).fill(1).map((_, i) => (i + 1).toString());
    // Add port validation and random port button
    const dom_src_dport = document.querySelector('[data-name="src_dport"]');
    if (!dom_src_dport || dom_src_dport.getAttribute("data-fleth-port-hooked") === "1") {
      return;
    }

    const dom_src_dport_input = dom_src_dport.querySelector("input");
    if (!dom_src_dport_input) {
      return;
    }

    dom_src_dport.setAttribute("data-fleth-port-hooked", "1");

    // Create random port button
    const dom_random_button = document.createElement("button");
    dom_random_button.classList = "cbi-button";
    dom_random_button.innerText = _("Random Port");
    dom_random_button.style.marginTop = ".5rem";
    dom_random_button.addEventListener("click", () => {
      dom_src_dport_input.value = ports[Math.floor(Math.random() * ports.length)];
      dom_src_dport_input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    // Create port validation alert
    const dom_port_invalid_alert = document.createElement("div");
    dom_port_invalid_alert.classList = "cbi-value-description";
    dom_port_invalid_alert.style.color = "#F44336";

    // Debounced port validation (200ms delay)
    let debounce_timer = 0;
    dom_src_dport_input.addEventListener("input", () => {
      const current_time = Date.now();
      debounce_timer = current_time;

      setTimeout(() => {
        if (current_time === debounce_timer) {
          const current_port_list = dom_src_dport_input.value.split("-");
          if (current_port_list.find((port) => !ports.includes(port))) {
            dom_port_invalid_alert.innerText = _("You can't access this port from MAP-E interface");
            dom_src_dport_input.classList.add("cbi-input-invalid");
          } else {
            dom_port_invalid_alert.innerText = "";
            dom_src_dport_input.classList.remove("cbi-input-invalid");
          }
        }
      }, 200);
    });

    // Insert validation alert and button before existing description
    dom_src_dport
      .querySelector(".cbi-value-description")
      .before(dom_port_invalid_alert);
    dom_src_dport
      .querySelector(".cbi-value-description")
      .before(dom_random_button);
  }

  if (location.pathname === "/cgi-bin/luci/admin/network/firewall/forwards") {
    observeAddedNodes('div[data-name="src_dport"]', FWPFhook, ["data-name"]);
  }

  if (['/cgi-bin/luci/admin/network', '/cgi-bin/luci/admin/network/network',].includes(location.pathname)) {
    observeAddedNodes('div[data-name="clientid"][data-field^="cbid.network."][data-field$=".clientid"]', InterfaceClientIdHook, ["data-name", "data-field"]);
  }
})();
