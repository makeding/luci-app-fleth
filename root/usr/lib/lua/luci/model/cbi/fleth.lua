local m, s, o

m = SimpleForm("fleth", translate("Flet'h Configuration"),
	translate("Flet'h provides LuCI protocol helpers for IPv4 over IPv6 tunnels."))
m.reset = false
m.submit = false

s = m:section(SimpleSection)

o = s:option(DummyValue, "_protocol_setup", translate("Protocol Setup"))
o.rawhtml = true
function o.cfgvalue()
	return "<p>" .. translate("Automatic tunnel configuration has been removed from this page.") .. "</p>" ..
		"<p>" .. translate("Open Network → Interfaces, edit the target interface, then choose the required protocol: Flet'h automatic IPv4 over IPv6, IPv4 over IPv6 (Flet'h), or IPv4 over IPv6 passthrough (Flet'h).") .. "</p>"
end

return m
