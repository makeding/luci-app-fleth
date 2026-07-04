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
		"<p>" .. translate("Open Network → Interfaces, edit the target interface, then choose one of these Flet'H family protocols:") .. "</p>" ..
		"<ul style=\"margin: 0.4em 0 0 1.5em;\">" ..
			"<li>" .. translate("Flet'H IPoE") .. "</li>" ..
			"<li>" .. translate("Flet'H Static IP") .. "</li>" ..
			"<li>" .. translate("Flet'H Static IP (Passthrough)") .. "</li>" ..
		"</ul>"
end

return m
