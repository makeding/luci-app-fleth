// Encapsulate in IIFE to avoid global scope pollution
(function() {
  'use strict';

  let mape_status = [];

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
    let ports = [];
    if (mape_status.length > 10) {
      // Parse port ranges (format: "1024-1088 2048-2112")
      const portRanges = mape_status[mape_status.length - 1].split(" ");
      portRanges.forEach(range => {
        const parts = range.split("-");
        if (parts.length === 2) {
          const start = parseInt(parts[0]);
          const end = parseInt(parts[1]);
          for (let port = start; port <= end; port++) {
            ports.push(port.toString());
          }
        } else if (parts.length === 1 && parts[0]) {
          // Single port number
          ports.push(parts[0]);
        }
      });
    } else {
      // No MAP-E, all ports available
      ports = new Array(65535).fill(1).map((_, i) => (i + 1).toString());
    }
    // Add port validation and random port button
    const dom_src_dport = document.querySelector('[data-name="src_dport"]');
    const dom_src_dport_input = dom_src_dport.querySelector("input");

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

  // Only activate on port forwarding page
  if (location.pathname === "/cgi-bin/luci/admin/network/firewall/forwards") {
    // Watch for dynamically added port forward forms
    const observer = new MutationObserver((mutationsList) => {
      mutationsList.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) {
            const matchingNodes = node.querySelectorAll('div[data-name="src_dport"]');
            if (matchingNodes.length > 0) {
              FWPFhook();
            }
          }
        });
      });
    });

    observer.observe(document.querySelector("#modal_overlay"), {
      childList: true,
      attributes: true,
      subtree: true,
      attributeFilter: ["data-name"],
    });

    // Initial hook
    FWPFhook();
  }
})();
