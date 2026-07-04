module("luci.controller.fleth", package.seeall)

function index()
	entry({"admin", "network", "fleth"}, cbi("fleth"), _("Flet'H Configuration"), 90).dependent = false
end
