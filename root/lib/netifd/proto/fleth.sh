#!/bin/sh
# fleth.sh - automatic DS-Lite / MAP-E IPv4-in-IPv6 tunnel backend

DNS_E=2404:1a8:7f01:a::3
DNS_W=2001:a7ff:5f01::a
DONT_SNAT_TO="${DONT_SNAT_TO:-0}"

[ -n "$INCLUDE_ONLY" ] || {
	. /lib/functions.sh
	. /lib/functions/network.sh
	[ -f /usr/share/fleth/common.sh ] && . /usr/share/fleth/common.sh
	. ../netifd-proto.sh
	init_proto "$@"
}

. /usr/share/fleth/ipoe-common.sh

fleth_iptables_chain() {
	echo "FLETH_${1}" | tr -c 'A-Za-z0-9_' '_' | cut -c 1-28
}

fleth_nft_table() {
	echo "fleth_mape_${1}" | tr -c 'A-Za-z0-9_' '_' | cut -c 1-63
}

fleth_delete_iptables_snat() {
	local cfg="$1"
	local chain

	command -v iptables >/dev/null 2>&1 || return 0
	chain=$(fleth_iptables_chain "$cfg")

	while iptables -t nat -D POSTROUTING -j "$chain" 2>/dev/null; do :; done
	iptables -t nat -F "$chain" 2>/dev/null
	iptables -t nat -X "$chain" 2>/dev/null
}

fleth_apply_iptables_snat() {
	local cfg="$1"
	local link="$2"
	local ipv4="$3"
	local portsets="$4"
	local chain portset startport endport proto

	command -v iptables >/dev/null 2>&1 || return 1
	chain=$(fleth_iptables_chain "$cfg")
	fleth_delete_iptables_snat "$cfg"

	iptables -t nat -N "$chain" 2>/dev/null || return 1
	iptables -t nat -A POSTROUTING -o "$link" -j "$chain" 2>/dev/null || return 1
	iptables -t nat -A "$chain" -p icmp -j SNAT --to-source "$ipv4" 2>/dev/null

	for portset in $portsets; do
		startport=$(echo "$portset" | cut -d'-' -f1)
		endport=$(echo "$portset" | cut -d'-' -f2)
		for proto in tcp udp; do
			iptables -t nat -A "$chain" -p "$proto" -j SNAT --to-source "$ipv4:$startport-$endport" 2>/dev/null
		done
	done
}

fleth_apply_nft_snat() {
	local cfg="$1"
	local link="$2"
	local ipv4="$3"
	local portsets="$4"
	local table
	local portcount=0
	local allports=""
	local portset startport endport x proto

	command -v nft >/dev/null 2>&1 || return 1
	table=$(fleth_nft_table "$cfg")

	for portset in $portsets; do
		startport=$(echo "$portset" | cut -d'-' -f1)
		endport=$(echo "$portset" | cut -d'-' -f2)
		for x in $(seq "$startport" "$endport"); do
			if ! echo "$DONT_SNAT_TO" | tr ' ' '\n' | grep -qw "$x"; then
				allports="$allports $portcount : $x , "
				portcount=$((portcount + 1))
			fi
		done
	done

	[ "$portcount" -gt 0 ] || return 0
	allports=${allports%??}

	nft list tables 2>/dev/null | grep -q "table inet $table" && nft delete table inet "$table"
	nft list tables 2>/dev/null | grep -q "table inet fleth_mape" && nft delete table inet fleth_mape
	nft add table inet "$table" || return 1
	nft add chain inet "$table" srcnat { type nat hook postrouting priority 0\; policy accept\; } || return 1

	for proto in icmp tcp udp; do
		nft add rule inet "$table" srcnat ip protocol "$proto" oifname "$link" \
			snat ip to "$ipv4" : numgen inc mod "$portcount" map { $allports } || return 1
	done
}

proto_fleth_setup_mape() {
	local cfg="$1"
	local link="fleth-$cfg"
	local portsets local_ipv6

	portsets=$(fleth_map_portsets_from_psid "$FLETH_PSID" "$FLETH_PSIDLEN" "$FLETH_OFFSET")
	[ -n "$portsets" ] || {
		proto_notify_error "$cfg" "INVALID_PSID"
		proto_block_restart "$cfg"
		return
	}
	local_ipv6="${FLETH_LOCAL_IPV6:-$FLETH_IPV6ADDR}"
	[ -n "$local_ipv6" ] || {
		proto_notify_error "$cfg" "INVALID_LOCAL_IPV6"
		proto_block_restart "$cfg"
		return
	}

	echo "type=map-e provider=$FLETH_PROVIDER peeraddr=$FLETH_PEERADDR ipv4=$FLETH_IPV4ADDR local=$local_ipv6 ports='$portsets'" > "/tmp/fleth-$cfg.rules"

	proto_init_update "$link" 1
	proto_add_ipv4_address "$FLETH_IPV4ADDR" "" "" ""
	: ${defaultroute:=1}
	[ "$defaultroute" -eq 1 ] && {
		: ${metric:=0}
		proto_add_ipv4_route "0.0.0.0" 0 "" "" "$metric"
	}

	fleth_ipip6_add_tunnel "$local_ipv6" "$FLETH_PEERADDR" "$tunlink" "$mtu" "$ttl" "$encaplimit"

	proto_add_data
	[ -n "$zone" ] && json_add_string zone "$zone"
	proto_close_data
	proto_send_update "$cfg"

	if fleth_local_ipv6_exists "$local_ipv6"; then
		logger -t fleth "[${cfg}] IPv6 address $local_ipv6 already exists; skipping dynamic interface ${cfg}_"
		type fleth_prefer_slaac_address >/dev/null 2>&1 && fleth_prefer_slaac_address "$cfg" "${tunlink:-wan6}" "$local_ipv6" "$prefer_slaac"
	else
		json_init
		json_add_string name "${cfg}_"
		json_add_string ifname "@${tunlink:-wan6}"
		json_add_string proto "static"
		json_add_array ip6addr
		json_add_string "" "${local_ipv6}/128"
		json_close_array
		json_close_object
		if ubus call network add_dynamic "$(json_dump)" >/dev/null 2>&1; then
			type fleth_prefer_slaac_address >/dev/null 2>&1 && fleth_prefer_slaac_address "$cfg" "${tunlink:-wan6}" "$local_ipv6" "$prefer_slaac"
		else
			logger -t fleth "[${cfg}] ERROR: Failed to create dynamic interface ${cfg}_"
		fi
	fi
	: ${auto_activate:=1}
	[ "$auto_activate" = "1" ] && type fleth_schedule_ping_activation >/dev/null 2>&1 && fleth_schedule_ping_activation "$cfg" "$link"

	if ! fleth_apply_nft_snat "$cfg" "$link" "$FLETH_IPV4ADDR" "$portsets"; then
		if ! fleth_apply_iptables_snat "$cfg" "$link" "$FLETH_IPV4ADDR" "$portsets"; then
			logger -t fleth "[${cfg}] failed to install MAP-E SNAT rules"
			proto_notify_error "$cfg" "SNAT_SETUP_FAILED"
		fi
	fi
}

proto_fleth_setup_dslite() {
	local cfg="$1"
	local link="fleth-$cfg"
	local remoteip6 ip6
	local local_ip6
	local ip4addr="192.0.0.2"
	local ip4gateway="192.0.0.1"

	remoteip6=$(resolveip -6 "$FLETH_AFTR_DOMAIN" 2>/dev/null)
	[ -z "$remoteip6" ] && remoteip6="$FLETH_AFTR"
	for ip6 in $remoteip6; do
		FLETH_AFTR="$ip6"
		break
	done

	[ -n "$FLETH_AFTR" ] || {
		proto_notify_error "$cfg" "AFTR_RESOLVE_FAIL"
		return
	}

	if ! network_get_ipaddr6 local_ip6 "$tunlink"; then
		[ -n "$weakif" ] || weakif="lan"
		network_get_ipaddr6 local_ip6 "$weakif"
	fi
	[ -n "$local_ip6" ] || local_ip6="$FLETH_IPV6ADDR"
	[ -n "$local_ip6" ] || {
		proto_notify_error "$cfg" "NO_LOCAL_IPV6"
		return
	}

	proto_init_update "$link" 1
	: ${defaultroute:=1}
	[ "$defaultroute" -eq 1 ] && {
		: ${metric:=0}
		proto_add_ipv4_route "0.0.0.0" 0 "" "" "$metric"
	}
	proto_add_ipv4_address "$ip4addr" "" "" "$ip4gateway"

	fleth_ipip6_add_tunnel "$local_ip6" "$FLETH_AFTR" "$tunlink" "$mtu" "$ttl" "$encaplimit"

	proto_add_data
	[ -n "$zone" ] && json_add_string zone "$zone"
	json_add_array firewall
		json_add_object ""
			json_add_string type nat
			json_add_string target ACCEPT
		json_close_object
	json_close_array
	proto_close_data
	proto_send_update "$cfg"
	: ${auto_activate:=1}
	[ "$auto_activate" = "1" ] && type fleth_schedule_ping_activation >/dev/null 2>&1 && fleth_schedule_ping_activation "$cfg" "$link"

	echo "type=dslite aftr=$FLETH_AFTR_DOMAIN remote=$FLETH_AFTR" > "/tmp/fleth-$cfg.rules"
}

proto_fleth_setup() {
	local cfg="$1"
	local iface="$2"

	json_get_vars tunlink mtu ttl encaplimit zone defaultroute metric prefer_slaac auto_activate weakif custom_aftr_enabled custom_aftr_preset custom_aftr
	[ "$zone" = "-" ] && zone=""
	tunlink="${tunlink:-wan6}"

	( proto_add_host_dependency "$cfg" "::" "$tunlink" )

	if fleth_has_custom_dslite_provider; then
		if fleth_get_custom_dslite_provider; then
			logger -t fleth "[${cfg}] using custom DS-Lite provider $FLETH_AFTR_DOMAIN"
			proto_fleth_setup_dslite "$cfg" "$iface"
		else
			logger -t fleth "[${cfg}] failed to resolve custom DS-Lite provider"
			proto_notify_error "$cfg" "AFTR_RESOLVE_FAIL"
		fi
		return
	fi

	FLETH_IPV6ADDR=$(fleth_get_uplink_ipv6 "$tunlink")
	if [ -n "$FLETH_IPV6ADDR" ] && fleth_detect_mape "$FLETH_IPV6ADDR"; then
		logger -t fleth "[${cfg}] detected MAP-E provider $FLETH_PROVIDER"
		proto_fleth_setup_mape "$cfg" "$iface"
		return
	fi

	if fleth_get_dslite_provider; then
		logger -t fleth "[${cfg}] detected DS-Lite provider $FLETH_AFTR_DOMAIN"
		proto_fleth_setup_dslite "$cfg" "$iface"
		return
	fi

	proto_notify_error "$cfg" "NO_MAPE_OR_DSLITE_PROVIDER"
	proto_block_restart "$cfg"
}

proto_fleth_teardown() {
	local cfg="$1"
	local table

	type fleth_cancel_ping_activation >/dev/null 2>&1 && fleth_cancel_ping_activation "$cfg"
	ifdown "${cfg}_"
	if command -v nft >/dev/null 2>&1; then
		table=$(fleth_nft_table "$cfg")
		nft list tables 2>/dev/null | grep -q "table inet $table" && nft delete table inet "$table"
		nft list tables 2>/dev/null | grep -q "table inet fleth_mape" && nft delete table inet fleth_mape
	fi
	fleth_delete_iptables_snat "$cfg"
	rm -f "/tmp/fleth-$cfg.rules"
}

proto_fleth_init_config() {
	no_device=1
	available=1

	proto_config_add_string "tunlink"
	proto_config_add_int "mtu"
	proto_config_add_int "ttl"
	proto_config_add_string "zone"
	proto_config_add_string "encaplimit"
	proto_config_add_boolean "defaultroute"
	proto_config_add_int "metric"
	proto_config_add_boolean "prefer_slaac"
	proto_config_add_boolean "auto_activate"
	proto_config_add_string "weakif"
	proto_config_add_boolean "custom_aftr_enabled"
	proto_config_add_string "custom_aftr_preset"
	proto_config_add_string "custom_aftr"
}

[ -n "$INCLUDE_ONLY" ] || {
	add_protocol fleth
}
