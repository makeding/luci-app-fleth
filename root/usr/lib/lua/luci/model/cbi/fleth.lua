local m, s, o

m = Map("fleth", translate("Flet'h Configuration"),
	translate("Flet'h is a helper that can configure your IPv4 over IPv6 tunnel automatically."))

s = m:section(NamedSection, "global", "fleth")
s.anonymous = true

o = s:option(Flag, "enabled", translate("Auto Configure tunnel Interface"))
o.rmempty = false

o = s:option(Value, "interface", translate("Tunnel Interface"))
o.default = "wan"
o.rmempty = false

o = s:option(Value, "interface6", translate("IPv6 Interface"), translate("Uplink interface"))
o.default = "wan6"
o.rmempty = false

o = s:option(Value, "mtu", translate("Tunnel Interface MTU"), translate("We recommend setting MTU to 1460."))
o.default = "1460"
o.datatype = "range(1280,1500)"

o = s:option(Value, "interface_zone", translate("Tunnel Interface Firewall Zone"))
o.default = "wan"
o.rmempty = false

o = s:option(Flag, "prefer_slaac", translate("Prefer SLAAC Address"),
	translate("Router outbound connections will prefer SLAAC addresses over MAP-E/ipip6h static addresses"))
o.default = "1"
o.rmempty = false

o = s:option(Flag, "tunnel_activation", translate("Auto Activate Tunnel"),
	translate("Automatically send ping to activate tunnel. Without traffic, some tunnels may fail to establish connection properly."))
o.default = "1"
o.rmempty = false

return m
