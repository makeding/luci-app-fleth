let mape_status = [];

async function FWPFhook() {
  if (mape_status.length === 0) {
    mape_status = (
      (await L.fs.exec("/usr/sbin/fleth", ["mape_status"])).stdout || ""
    ).split("\n");
  }
  let dom_src_interface = document.querySelector('[data-name="src"]');
  if (!dom_src_interface) {
    return;
  }
  // WIP match mape interface
  let ports =
    mape_status.length > 10
      ? mape_status[mape_status.length - 1].split(" ")
      : new Array(65535).fill(1).map((_, i) => (i + 1).toString());
  // let dom_src_zone_list = dom_src_interface.querySelectorAll('.dropdown > li');
  // let dom_src_interface_list = null
  // let src_interface_list = []
  // function get_src_interface_list(){
  //     src_interface_list = []
  //     dom_src_interface.querySelector('li[selected]').querySelectorAll('.ifacebadge').forEach(d=>{
  //         src_interface_list.push(d.innerText.split(':')[0])
  //     })
  // }
  // for (let i = 0; i < dom_src_interface_list.length; i++) {
  //     dom_src_interface_list[i].addEventListener('click',()=>{
  //         get_src_interface_list();
  //     })
  // }
  // WIP filter used ports
  const dom_src_dport = document.querySelector('[data-name="src_dport"]');
  const dom_src_dport_input = dom_src_dport.querySelector("input");
  const dom_random_button = document.createElement("button");
  dom_random_button.classList = "cbi-button";
  dom_random_button.innerText = _("Random Port");
  dom_random_button.style.marginTop = ".5rem";
  dom_random_button.addEventListener("click", () => {
    dom_src_dport_input.value = ports[Math.floor(Math.random() * ports.length)];
    dom_src_dport_input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const dom_port_invaild_alert = document.createElement("div");
  dom_port_invaild_alert.classList = "cbi-value-description";
  dom_port_invaild_alert.style.color = "#F44336";
  let old_t = 0;
  dom_src_dport_input.addEventListener("input", () => {
    const t = +new Date();
    old_t = t;
    setTimeout(() => {
      if (t === old_t) {
        const current_port_list = dom_src_dport_input.value.split("-");
        if (current_port_list.find((port) => !ports.includes(port))) {
          dom_port_invaild_alert.innerText = _("You can't access this port from MAP-E interface");
          dom_src_dport_input.classList.add("cbi-input-invalid");
        } else {
          dom_port_invaild_alert.innerText = "";
          dom_src_dport_input.classList.remove("cbi-input-invalid");
        }
      }
    }, 200);
  });
  dom_src_dport
    .querySelector(".cbi-value-description")
    .before(dom_port_invaild_alert);
  dom_src_dport
    .querySelector(".cbi-value-description")
    .before(dom_random_button);
}
if (location.pathname === "/cgi-bin/luci/admin/network/firewall/forwards") {
  const observer = new MutationObserver((mutationsList) => {
    mutationsList.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const matchingNodes = node.querySelectorAll(
            'div[data-name="src_dport"]'
          );
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
  FWPFhook();
}
