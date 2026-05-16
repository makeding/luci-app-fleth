#!/bin/sh

[ -n "$INCLUDE_ONLY" ] || {
	. /lib/functions.sh
	. /lib/functions/network.sh
	. ../netifd-proto.sh
	init_proto "$@"
}

proto_ipip6hp_init_config() {
	available=1

	proto_config_add_string "peeraddr"
	proto_config_add_string "ip4ifaddr"
	proto_config_add_string "gateway4"
	proto_config_add_string "ip6addr"
	proto_config_add_string "interface_id"
	proto_config_add_string "tunlink"
	proto_config_add_int "mtu"
	proto_config_add_int "ttl"
	proto_config_add_string "encaplimit"
	proto_config_add_string "zone"
	proto_config_add_boolean "defaultroute"
	proto_config_add_int "metric"
}

proto_ipip6hp_setup() {
	local cfg="$1"
	local passthrough_device="$2"
	local link="ipip6hp-$cfg"

	local peeraddr ip4ifaddr gateway4 ip6addr interface_id tunlink mtu ttl encaplimit zone defaultroute metric
	json_get_vars peeraddr ip4ifaddr gateway4 ip6addr interface_id tunlink mtu ttl encaplimit zone defaultroute metric

	logger -t ipip6hp "[${cfg}] Starting passthrough setup"
	logger -t ipip6hp "[${cfg}]   device=$passthrough_device peeraddr=$peeraddr ip4ifaddr=$ip4ifaddr gateway4=$gateway4"
	logger -t ipip6hp "[${cfg}]   ip6addr=$ip6addr interface_id=$interface_id tunlink=$tunlink"

	[ -z "$passthrough_device" ] && {
		logger -t ipip6hp "[${cfg}] ERROR: Missing passthrough device"
		proto_notify_error "$cfg" "MISSING_DEVICE"
		proto_block_restart "$cfg"
		return
	}

	[ -z "$peeraddr" ] && {
		logger -t ipip6hp "[${cfg}] ERROR: Missing peer address"
		proto_notify_error "$cfg" "MISSING_PEER_ADDRESS"
		proto_block_restart "$cfg"
		return
	}

	[ -z "$ip4ifaddr" ] && {
		logger -t ipip6hp "[${cfg}] ERROR: Missing client IPv4 address"
		proto_notify_error "$cfg" "MISSING_CLIENT_IPV4"
		proto_block_restart "$cfg"
		return
	}

	[ -z "$gateway4" ] && {
		logger -t ipip6hp "[${cfg}] ERROR: Missing gateway IPv4 address"
		proto_notify_error "$cfg" "MISSING_GATEWAY_IPV4"
		proto_block_restart "$cfg"
		return
	}

	[ -z "$ip6addr" ] && [ -z "$interface_id" ] && {
		logger -t ipip6hp "[${cfg}] ERROR: Neither ip6addr nor interface_id is configured"
		proto_notify_error "$cfg" "MISSING_INTERFACE_ID"
		proto_block_restart "$cfg"
		return
	}

	( proto_add_host_dependency "$cfg" "::" "$tunlink" )

	logger -t ipip6hp "[${cfg}] Resolving peer address: $peeraddr"
	local remoteip6=$(resolveip -6 "$peeraddr")
	if [ -z "$remoteip6" ]; then
		sleep 3
		remoteip6=$(resolveip -6 "$peeraddr")
		[ -z "$remoteip6" ] && {
			logger -t ipip6hp "[${cfg}] ERROR: Failed to resolve peer address"
			proto_notify_error "$cfg" "PEER_RESOLVE_FAIL"
			return
		}
	fi

	for ip6 in $remoteip6; do
		peeraddr=$ip6
		break
	done
	logger -t ipip6hp "[${cfg}] Resolved to: $peeraddr"

	if [ -z "$ip6addr" ]; then
		if [ -n "$interface_id" ]; then
			local wan6_iface="${tunlink:-wan6}"
			local prefix_json=$(ubus call network.interface.${wan6_iface} status 2>/dev/null)

			if [ -z "$prefix_json" ]; then
				logger -t ipip6hp "[${cfg}] ERROR: Failed to get interface status from $wan6_iface"
				proto_notify_error "$cfg" "NO_INTERFACE_STATUS"
				return
			fi

			local wan6_prefix=$(echo "$prefix_json" | jsonfilter -e '@["ipv6-prefix"][0].address' 2>/dev/null)
			local prefix_len=$(echo "$prefix_json" | jsonfilter -e '@["ipv6-prefix"][0].mask' 2>/dev/null)

			if [ -z "$wan6_prefix" ]; then
				logger -t ipip6hp "[${cfg}] ERROR: No IPv6 prefix found on $wan6_iface"
				proto_notify_error "$cfg" "NO_IPV6_PREFIX"
				return
			fi

			if [ "$prefix_len" != "56" ] && [ "$prefix_len" != "64" ]; then
				local alignment_check=$(fleth check_alignment "$wan6_prefix" 2>/dev/null)
				local check_status="${alignment_check%%:*}"
				if [ "$check_status" != "ALIGNED" ] && [ "$check_status" != "SKIPPED" ]; then
					logger -t ipip6hp "[${cfg}] ERROR: Prefix not aligned for IPIP6 - $alignment_check"
					logger -t ipip6hp "[${cfg}] Current prefix: $wan6_prefix/$prefix_len"
					proto_notify_error "$cfg" "PREFIX_NOT_ALIGNED"
					proto_block_restart "$cfg"
					return
				fi
			fi

			local prefix_part=$(echo "$wan6_prefix" | cut -d: -f1-4)
			local clean_id=$(echo "$interface_id" | sed 's/^:*//;s/:*$//')
			ip6addr="${prefix_part}:${clean_id}"
			logger -t ipip6hp "[${cfg}] Constructed: $ip6addr (prefix: $wan6_prefix/$prefix_len)"
		else
			if [ -n "$tunlink" ]; then
				local tunlinkif=$(uci_get_state network "$tunlink" ifname)
				ip6addr=$(network_get_ipaddr6 "$tunlinkif")
			fi
			[ -z "$ip6addr" ] && {
				local wanif=$(uci_get_state network wan6 ifname)
				ip6addr=$(network_get_ipaddr6 "$wanif")
			}
			[ -n "$ip6addr" ] && logger -t ipip6hp "[${cfg}] Auto-detected: $ip6addr"
		fi
	fi

	[ -z "$ip6addr" ] && {
		logger -t ipip6hp "[${cfg}] ERROR: Failed to determine local IPv6 address"
		proto_notify_error "$cfg" "NO_LOCAL_IPV6"
		proto_block_restart "$cfg"
		return
	}

	: ${mtu:=1460}
	: ${ttl:=64}

	logger -t ipip6hp "[${cfg}] Config: local=$ip6addr remote=$peeraddr device=$passthrough_device mtu=$mtu"

	ip link set dev "$passthrough_device" up 2>/dev/null
	ip addr replace "${gateway4}/32" dev "$passthrough_device" 2>/dev/null
	ip route replace "${ip4ifaddr}/32" dev "$passthrough_device" src "$gateway4" 2>/dev/null

	proto_init_update "$link" 1

	: ${defaultroute:=1}
	[ "$defaultroute" -eq 1 ] && {
		: ${metric:=0}
		proto_add_ipv4_route "0.0.0.0" 0 "" "" "$metric"
	}

	proto_add_tunnel
	json_add_string mode ipip6
	json_add_int mtu "$mtu"
	json_add_int ttl "$ttl"
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
		logger -t ipip6hp "[${cfg}] Creating dynamic interface ${cfg}_ on @${parent_iface}"
		json_init
		json_add_string name "${cfg}_"
		json_add_string ifname "@${parent_iface}"
		json_add_string proto "static"
		json_add_array ip6addr
		json_add_string "" "${ip6addr}/128"
		json_close_array
		json_close_object
		ubus call network add_dynamic "$(json_dump)"
	fi

	logger -t ipip6hp "[${cfg}] Passthrough setup completed"
}

proto_ipip6hp_teardown() {
	local cfg="$1"
	local ip4ifaddr=$(uci get network.${cfg}.ip4ifaddr 2>/dev/null)
	local gateway4=$(uci get network.${cfg}.gateway4 2>/dev/null)

	local passthrough_device=$(uci get network.${cfg}.device 2>/dev/null)
	[ -n "$passthrough_device" ] && [ -n "$ip4ifaddr" ] && ip route del "${ip4ifaddr}/32" dev "$passthrough_device" 2>/dev/null
	[ -n "$passthrough_device" ] && [ -n "$gateway4" ] && ip addr del "${gateway4}/32" dev "$passthrough_device" 2>/dev/null

	ifdown "${cfg}_"
	logger -t ipip6hp "[${cfg}] Tearing down"
}

[ -n "$INCLUDE_ONLY" ] || {
	add_protocol ipip6hp
}
