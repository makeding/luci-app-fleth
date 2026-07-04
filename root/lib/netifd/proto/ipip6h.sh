#!/bin/sh
# Based on OpenWrt dslite.sh - https://github.com/openwrt/openwrt/blob/master/package/network/ipv6/ds-lite/files/dslite.sh
# Modified for fleth

[ -n "$INCLUDE_ONLY" ] || {
	. /lib/functions.sh
	. /lib/functions/network.sh
	[ -f /usr/share/fleth/common.sh ] && . /usr/share/fleth/common.sh
	[ -f /usr/share/fleth/ipip6h-common.sh ] && . /usr/share/fleth/ipip6h-common.sh
	. ../netifd-proto.sh
	init_proto "$@"
}

proto_ipip6h_init_config() {
	no_device=1
	available=1

	proto_config_add_boolean "weakif"
	fleth_ipip6_add_common_config
}

proto_ipip6h_setup() {
	local cfg="$1"
	local iface="$2"
	local link="ipip6h-$cfg"

	local peeraddr ip4ifaddr ip6addr interface_id tunlink mtu ttl encaplimit zone defaultroute metric prefer_slaac auto_activate weakif activation_enabled activation_url
	json_get_vars peeraddr ip4ifaddr ip6addr interface_id tunlink mtu ttl encaplimit zone defaultroute metric prefer_slaac auto_activate weakif activation_enabled activation_url

	logger -t ipip6h "[${cfg}] Starting setup"
	logger -t ipip6h "[${cfg}]   peeraddr=$peeraddr ip4ifaddr=$ip4ifaddr"
	logger -t ipip6h "[${cfg}]   ip6addr=$ip6addr interface_id=$interface_id tunlink=$tunlink"

	[ -z "$peeraddr" ] && {
		logger -t ipip6h "[${cfg}] ERROR: Missing peer address"
		proto_notify_error "$cfg" "MISSING_PEER_ADDRESS"
		proto_block_restart "$cfg"
		return
	}

	[ -z "$ip4ifaddr" ] && {
		logger -t ipip6h "[${cfg}] ERROR: Missing Public IPv4 address"
		proto_notify_error "$cfg" "MISSING_PUBLIC_IPV4"
		proto_block_restart "$cfg"
		return
	}

	[ -z "$ip6addr" ] && [ -z "$interface_id" ] && {
		logger -t ipip6h "[${cfg}] ERROR: Neither ip6addr nor interface_id is configured"
		proto_notify_error "$cfg" "MISSING_INTERFACE_ID"
		proto_block_restart "$cfg"
		return
	}

	( proto_add_host_dependency "$cfg" "::" "$tunlink" )

	if ! fleth_ipip6_resolve_peer "$cfg" ipip6h "$peeraddr"; then
		proto_notify_error "$cfg" "${FLETH_IPIP6_ERROR:-PEER_RESOLVE_FAIL}"
		return
	fi
	peeraddr="$FLETH_IPIP6_REMOTE_ADDR"

	if ! fleth_ipip6_build_local_addr "$cfg" ipip6h "$ip6addr" "$interface_id" "$tunlink"; then
		logger -t ipip6h "[${cfg}] ERROR: Failed to determine local IPv6 address"
		proto_notify_error "$cfg" "${FLETH_IPIP6_ERROR:-NO_LOCAL_IPV6}"
		proto_block_restart "$cfg"
		return
	fi
	ip6addr="$FLETH_IPIP6_LOCAL_ADDR"

	logger -t ipip6h "[${cfg}] Config: local=$ip6addr remote=$peeraddr mtu=${mtu:-1460}"

	proto_init_update "$link" 1
	proto_add_ipv4_address "$ip4ifaddr" "255.255.255.255"

	: ${defaultroute:=1}
	[ "$defaultroute" -eq 1 ] && {
		: ${metric:=0}
		proto_add_ipv4_route "0.0.0.0" 0 "" "" "$metric"
	}

	fleth_ipip6_add_tunnel "$ip6addr" "$peeraddr" "$tunlink" "$mtu" "$ttl" "$encaplimit"

	proto_add_data
	[ -n "$zone" ] && json_add_string zone "$zone"
	proto_close_data

	proto_send_update "$cfg"
	: ${auto_activate:=1}
	[ "$auto_activate" = "1" ] && type fleth_schedule_ping_activation >/dev/null 2>&1 && fleth_schedule_ping_activation "$cfg" "$link"

	fleth_ipip6_add_dynamic_address "$cfg" ipip6h "$tunlink" "$interface_id" "$ip6addr" "$activation_enabled" "$activation_url" "$prefer_slaac"

	logger -t ipip6h "[${cfg}] Setup completed"
}

proto_ipip6h_teardown() {
	local cfg="$1"
	type fleth_cancel_ping_activation >/dev/null 2>&1 && fleth_cancel_ping_activation "$cfg"
	ifdown "${cfg}_"
	logger -t ipip6h "[${cfg}] Tearing down"
}

[ -n "$INCLUDE_ONLY" ] || {
	add_protocol ipip6h
}
