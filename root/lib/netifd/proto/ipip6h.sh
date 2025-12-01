#!/bin/sh
# Based on OpenWrt dslite.sh - https://github.com/openwrt/openwrt/blob/master/package/network/ipv6/ds-lite/files/dslite.sh
# Modified for fleth

[ -n "$INCLUDE_ONLY" ] || {
	. /lib/functions.sh
	. /lib/functions/network.sh
	. ../netifd-proto.sh
	init_proto "$@"
}

proto_ipip6h_init_config() {
	no_device=1
	available=1

	proto_config_add_string "peeraddr"
	proto_config_add_string "ip4ifaddr"
	proto_config_add_string "ip6addr"
	proto_config_add_string "interface_id"
	proto_config_add_string "tunlink"
	proto_config_add_int "mtu"
	proto_config_add_int "ttl"
	proto_config_add_string "encaplimit"
	proto_config_add_string "zone"
	proto_config_add_boolean "defaultroute"
	proto_config_add_int "metric"
	proto_config_add_boolean "weakif"
}

proto_ipip6h_setup() {
	local cfg="$1"
	local iface="$2"
	local link="ipip6h-$cfg"

	local peeraddr ip4ifaddr ip6addr interface_id tunlink mtu ttl encaplimit zone defaultroute metric weakif
	json_get_vars peeraddr ip4ifaddr ip6addr interface_id tunlink mtu ttl encaplimit zone defaultroute metric weakif

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

	logger -t ipip6h "[${cfg}] Resolving peer address: $peeraddr"
	local remoteip6=$(resolveip -6 "$peeraddr")
	if [ -z "$remoteip6" ]; then
		sleep 3
		remoteip6=$(resolveip -6 "$peeraddr")
		[ -z "$remoteip6" ] && {
			logger -t ipip6h "[${cfg}] ERROR: Failed to resolve peer address"
			proto_notify_error "$cfg" "PEER_RESOLVE_FAIL"
			return
		}
	fi

	for ip6 in $remoteip6; do
		peeraddr=$ip6
		break
	done
	logger -t ipip6h "[${cfg}] Resolved to: $peeraddr"

	if [ -z "$ip6addr" ]; then
		if [ -n "$interface_id" ]; then
			local wan6_iface="${tunlink:-wan6}"
			local prefix_json=$(ubus call network.interface.${wan6_iface} status 2>/dev/null)

			if [ -z "$prefix_json" ]; then
				logger -t ipip6h "[${cfg}] ERROR: Failed to get interface status from $wan6_iface"
				proto_notify_error "$cfg" "NO_INTERFACE_STATUS"
				return
			fi

			local wan6_prefix=$(echo "$prefix_json" | jsonfilter -e '@["ipv6-prefix"][0].address' 2>/dev/null)
			local prefix_len=$(echo "$prefix_json" | jsonfilter -e '@["ipv6-prefix"][0].mask' 2>/dev/null)

			if [ -z "$wan6_prefix" ]; then
				logger -t ipip6h "[${cfg}] ERROR: No IPv6 prefix found on $wan6_iface"
				proto_notify_error "$cfg" "NO_IPV6_PREFIX"
				return
			fi

			# Check prefix alignment for non-/56,/64 prefixes (e.g., /60, /62)
			# /56 (ISP-assigned) and /64 (SLAAC) are always aligned
			if [ "$prefix_len" != "56" ] && [ "$prefix_len" != "64" ]; then
				local alignment_check=$(fleth check_alignment "$wan6_prefix" 2>/dev/null)
				local check_status="${alignment_check%%:*}"
				if [ "$check_status" != "ALIGNED" ] && [ "$check_status" != "SKIPPED" ]; then
					logger -t ipip6h "[${cfg}] ERROR: Prefix not aligned for IPIP6 - $alignment_check"
					logger -t ipip6h "[${cfg}] The 4th hextet of your prefix must end with '00' for MAP-E/IPIP6"
					logger -t ipip6h "[${cfg}] Current prefix: $wan6_prefix/$prefix_len"
					proto_notify_error "$cfg" "PREFIX_NOT_ALIGNED"
					proto_block_restart "$cfg"
					return
				fi
			fi

			local prefix_part=$(echo "$wan6_prefix" | cut -d: -f1-4)
			local clean_id=$(echo "$interface_id" | sed 's/^:*//;s/:*$//')
			ip6addr="${prefix_part}:${clean_id}"
			logger -t ipip6h "[${cfg}] Constructed: $ip6addr (prefix: $wan6_prefix/$prefix_len)"
		else
			if [ -n "$tunlink" ]; then
				local tunlinkif=$(uci_get_state network "$tunlink" ifname)
				ip6addr=$(network_get_ipaddr6 "$tunlinkif")
			fi
			[ -z "$ip6addr" ] && {
				local wanif=$(uci_get_state network wan6 ifname)
				ip6addr=$(network_get_ipaddr6 "$wanif")
			}
			[ -n "$ip6addr" ] && logger -t ipip6h "[${cfg}] Auto-detected: $ip6addr"
		fi
	fi

	[ -z "$ip6addr" ] && {
		logger -t ipip6h "[${cfg}] ERROR: Failed to determine local IPv6 address"
		proto_notify_error "$cfg" "NO_LOCAL_IPV6"
		proto_block_restart "$cfg"
		return
	}

	logger -t ipip6h "[${cfg}] Config: local=$ip6addr remote=$peeraddr mtu=${mtu:-1460}"

	proto_init_update "$link" 1
	proto_add_ipv4_address "$ip4ifaddr" "255.255.255.255"

	: ${defaultroute:=1}
	[ "$defaultroute" -eq 1 ] && {
		: ${metric:=0}
		proto_add_ipv4_route "0.0.0.0" 0 "" "" "$metric"
	}

	proto_add_tunnel
	json_add_string mode ipip6
	json_add_int mtu "${mtu:-1460}"
	json_add_int ttl "${ttl:-64}"
	json_add_string local "$ip6addr"
	json_add_string remote "$peeraddr"
	[ -n "$tunlink" ] && json_add_string link "$tunlink"
	json_add_object "data"
	  [ -n "$encaplimit" ] && json_add_string encaplimit "$encaplimit"
	json_close_object
	proto_close_tunnel

	proto_add_data
	[ -n "$zone" ] && json_add_string zone "$zone"
	proto_close_data

	proto_send_update "$cfg"

	if [ -n "$interface_id" ] && [ -n "$ip6addr" ]; then
		local parent_iface="${tunlink:-wan6}"
		logger -t ipip6h "[${cfg}] Creating dynamic interface ${cfg}_ on @${parent_iface}"
		json_init
		json_add_string name "${cfg}_"
		json_add_string ifname "@${parent_iface}"
		json_add_string proto "static"
		json_add_array ip6addr
		json_add_string "" "${ip6addr}/128"
		json_close_array
		json_close_object
		ubus call network add_dynamic "$(json_dump)"

		# Deprecate static address if prefer_slaac is enabled
		local prefer_slaac=$(uci get fleth.global.prefer_slaac 2>/dev/null)
		if [ "$prefer_slaac" = "1" ]; then
			local parent_device=$(ifstatus ${parent_iface} 2>/dev/null | jsonfilter -e '@.device' 2>/dev/null)
			if [ -n "$parent_device" ]; then
				ip -6 addr change "${ip6addr}"/128 dev "$parent_device" preferred_lft 0 2>/dev/null
				logger -t ipip6h "[${cfg}] Deprecated static address ${ip6addr} to prefer SLAAC"
			fi
		fi
	fi

	logger -t ipip6h "[${cfg}] Setup completed"
}

proto_ipip6h_teardown() {
	local cfg="$1"
	ifdown "${cfg}_"
	logger -t ipip6h "[${cfg}] Tearing down"
}

[ -n "$INCLUDE_ONLY" ] || {
	add_protocol ipip6h
}
