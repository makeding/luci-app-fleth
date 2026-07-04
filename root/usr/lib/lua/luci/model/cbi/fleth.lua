local m, s, o

m = SimpleForm("fleth", translate("Flet'H Tools"),
	translate("Flet'H provides diagnostics and helper tools for IPv4 over IPv6 tunnels."))
m.reset = false
m.submit = false

s = m:section(SimpleSection)

o = s:option(DummyValue, "_protocol_setup", translate("Protocol Setup"))
o.rawhtml = true
function o.cfgvalue()
	return "<p>" .. translate("Automatic tunnel configuration has been removed from this page.") .. "</p>" ..
		"<p>" .. translate("Open Network → Interfaces, edit the target interface, then choose the required Flet'H family protocol: Flet'H IPoE, Flet'H Static IP, or Flet'H Static IP (Passthrough).") .. "</p>"
end

return m
