// Native automatic Flet'H IPoE protocol.
"use strict";
"require form";
"require network";
"require tools.widgets as widgets";

network.registerPatternVirtual(/^fleth-.+$/);

return network.registerProtocol("fleth", {
  getI18n: function () {
    return _("Flet'H IPoE");
  },

  getIfname: function () {
    return this._ubus("l3_device") || "fleth-%s".format(this.sid);
  },

  getPackageName: function () {
    return "luci-proto-fleth";
  },

  isFloating: function () {
    return true;
  },

  isVirtual: function () {
    return true;
  },

  getDevices: function () {
    return null;
  },

  containsDevice: function (ifname) {
    return network.getIfnameOf(ifname) == this.getIfname();
  },

  renderFormOptions: function (s) {
    var o;

    o = s.taboption(
      "general",
      widgets.NetworkSelect,
      "tunlink",
      _("Tunnel Link"),
    );
    o.default = "wan6";
    o.exclude = s.section;
    o.rmempty = false;

    o = s.taboption(
      "general",
      form.Value,
      "custom_aftr",
      _("AFTR endpoint"),
      _("Optional. Leave empty to use automatic detection."),
    );
    o.value("", _("None"));
    o.value("wtd01-aftr01-ngnintf.i.open.ad.jp", "SDCC - 1 (wtd01-aftr01-ngnintf.i.open.ad.jp)");
    o.value("ksk01-aftr01-ngnintf.i.open.ad.jp", "SDCC - Port Forward (ksk01-aftr01-ngnintf.i.open.ad.jp)");
    o.placeholder = "aftr.example.net";
    o.datatype = 'or(hostname,ip6addr("nomask"))';

    o = s.taboption(
      "general",
      form.DummyValue,
      "_dslite_test_help",
      "&#160;",
    );
    o.rawhtml = true;
    o.cfgvalue = function () {
      return '<a href="https://wiki.s.sdconw.com/68adeceb59b31226a3736ddb" target="_blank" rel="noreferrer noopener">' + _("Learn more") + '</a>';
    };

    o = s.taboption(
      "advanced",
      form.ListValue,
      "encaplimit",
      _("Encapsulation limit"),
    );
    o.rmempty = false;
    o.default = "ignore";
    o.datatype = 'or("ignore",range(0,255))';
    o.value("ignore", _("ignore"));
    for (var i = 0; i < 256; i++) o.value(i);

    o = s.taboption(
      "advanced",
      form.Flag,
      "defaultroute",
      _("Default gateway"),
      _("If unchecked, no default route is configured"),
    );
    o.default = o.enabled;

    o = s.taboption("advanced", form.Value, "metric", _("Use gateway metric"));
    o.placeholder = "0";
    o.datatype = "uinteger";
    o.depends("defaultroute", "1");

    o = s.taboption(
      "advanced",
      form.Value,
      "mtu",
      _("Use MTU on tunnel interface"),
    );
    o.placeholder = "1460";
    o.datatype = "range(1280,1500)";

    o = s.taboption(
      "advanced",
      form.Flag,
      "prefer_slaac",
      _("Prefer SLAAC Address"),
      _("Router outbound connections will prefer SLAAC addresses over MAP-E/ipip6h static addresses"),
    );
    o.default = o.enabled;
  },
});
