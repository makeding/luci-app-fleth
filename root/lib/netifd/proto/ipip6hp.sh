#!/bin/sh

[ -n "$INCLUDE_ONLY" ] || {
	. /lib/functions.sh
	. /lib/functions/network.sh
	[ -f /usr/share/fleth/common.sh ] && . /usr/share/fleth/common.sh
	[ -f /usr/share/fleth/ipip6h-common.sh ] && . /usr/share/fleth/ipip6h-common.sh
	[ -f /usr/share/fleth/ipip6hp-hotplug.sh ] && . /usr/share/fleth/ipip6hp-hotplug.sh
	. ../netifd-proto.sh
	init_proto "$@"
}

proto_ipip6hp_init_config() {
	available=1

	fleth_ipip6_add_common_config 0
	proto_config_add_int "ip4prefixlen"
	proto_config_add_string "gateway4"
	proto_config_add_boolean "allow_shared_device"
	proto_config_add_boolean "proxy_arp"
	proto_config_add_string "ip4table"
	proto_config_add_int "ip4rule_priority"
}

ipip6hp_sysctl_path() {
	local device="$1"
	local name="$2"
	printf "/proc/sys/net/ipv4/conf/%s/%s" "$device" "$name"
}

ipip6hp_save_and_set_sysctl() {
	local cfg="$1"
	local device="$2"
	local name="$3"
	local value="$4"
	local path="$(ipip6hp_sysctl_path "$device" "$name")"
	local state_file="/var/run/ipip6hp-${cfg}.${name}"

	[ -f "$path" ] || return
	[ -f "$state_file" ] || cat "$path" > "$state_file" 2>/dev/null
	echo "$value" > "$path" 2>/dev/null
}

ipip6hp_restore_sysctl() {
	local cfg="$1"
	local device="$2"
	local name="$3"
	local path="$(ipip6hp_sysctl_path "$device" "$name")"
	local state_file="/var/run/ipip6hp-${cfg}.${name}"

	[ -f "$path" ] || return
	[ -f "$state_file" ] || return
	cat "$state_file" > "$path" 2>/dev/null
	rm -f "$state_file"
}

ipip6hp_delete_nft_rules() {
	local cfg="$1"
	local comment="fleth-ipip6hp-${cfg}"
	local chain handle

	command -v nft >/dev/null 2>&1 || return

	nft -a list table inet fw4 2>/dev/null | awk -v comment="$comment" '
		$1 == "chain" { chain = $2 }
		index($0, comment) {
			for (i = 1; i < NF; i++) {
				if ($i == "handle") {
					print chain, $(i + 1)
					break
				}
			}
		}
	' | while read -r chain handle; do
		[ -n "$chain" ] && [ -n "$handle" ] && nft delete rule inet fw4 "$chain" handle "$handle" 2>/dev/null
	done
}

ipip6hp_delete_policy_route() {
	local client4="$1"
	local table="$2"
	local priority="$3"
	local link="$4"

	ip rule del priority "$priority" from "${client4}/32" table "$table" 2>/dev/null
	ip rule del from "${client4}/32" table "$table" 2>/dev/null
	if [ -n "$link" ]; then
		ip route del default dev "$link" table "$table" 2>/dev/null
	else
		ip route del default table "$table" 2>/dev/null
	fi
}

ipip6hp_add_policy_route() {
	local cfg="$1"
	local link="$2"
	local client4="$3"
	local table="$4"
	local priority="$5"
	local metric="$6"

	ipip6hp_delete_policy_route "$client4" "$table" "$priority" "$link"
	ip route replace default dev "$link" table "$table" metric "${metric:-0}" 2>/dev/null || {
		logger -t ipip6hp "[${cfg}] ERROR: Failed to install policy default route in table $table"
		return 1
	}
	ip rule add priority "$priority" from "${client4}/32" table "$table" 2>/dev/null || {
		logger -t ipip6hp "[${cfg}] ERROR: Failed to install policy rule for $client4 table $table"
		return 1
	}
	logger -t ipip6hp "[${cfg}] Installed policy route: from $client4 lookup table $table via $link"
}

ipip6hp_has_other_ipv4() {
	local device="$1"
	local gateway4="$2"

	ip -4 addr show dev "$device" scope global 2>/dev/null | awk -v gateway="${gateway4}/32" '
		$1 == "inet" && $2 != gateway { found = 1 }
		END { exit found ? 0 : 1 }
	'
}

proto_ipip6hp_setup() {
	local cfg="$1"
	local passthrough_device="$2"
	local link="$(fleth_ipip6hp_device_name "$cfg")"

	local peeraddr ip4ifaddr ip4prefixlen gateway4 allow_shared_device proxy_arp ip4table ip4rule_priority ip6addr interface_id tunlink mtu ttl encaplimit zone defaultroute metric prefer_slaac activation_enabled activation_url
	json_get_vars peeraddr ip4ifaddr ip4prefixlen gateway4 allow_shared_device proxy_arp ip4table ip4rule_priority ip6addr interface_id tunlink mtu ttl encaplimit zone defaultroute metric prefer_slaac activation_enabled activation_url

	logger -t ipip6hp "[${cfg}] Starting passthrough setup"
	[ -z "$passthrough_device" ] && passthrough_device=$(uci get network.${cfg}.device 2>/dev/null)
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

	if ! fleth_ipip6_resolve_peer "$cfg" ipip6hp "$peeraddr"; then
		proto_notify_error "$cfg" "${FLETH_IPIP6_ERROR:-PEER_RESOLVE_FAIL}"
		return
	fi
	peeraddr="$FLETH_IPIP6_REMOTE_ADDR"

	if ! fleth_ipip6_build_local_addr "$cfg" ipip6hp "$ip6addr" "$interface_id" "$tunlink"; then
		logger -t ipip6hp "[${cfg}] ERROR: Failed to determine local IPv6 address"
		proto_notify_error "$cfg" "${FLETH_IPIP6_ERROR:-NO_LOCAL_IPV6}"
		proto_block_restart "$cfg"
		return
	fi
	ip6addr="$FLETH_IPIP6_LOCAL_ADDR"

	: ${mtu:=1460}
	: ${ttl:=64}
	: ${ip4prefixlen:=31}
	: ${allow_shared_device:=0}
	: ${proxy_arp:=1}
	: ${ip4table:=100}
	: ${ip4rule_priority:=10000}

	logger -t ipip6hp "[${cfg}] Config: local=$ip6addr remote=$peeraddr device=$passthrough_device mtu=$mtu"

	ip link set dev "$passthrough_device" up 2>/dev/null
	if [ "$allow_shared_device" != "1" ] && ipip6hp_has_other_ipv4 "$passthrough_device" "$gateway4"; then
		logger -t ipip6hp "[${cfg}] ERROR: $passthrough_device already has another IPv4 address; passthrough device must be dedicated"
		ip -4 addr show dev "$passthrough_device" scope global 2>/dev/null | logger -t ipip6hp
		proto_notify_error "$cfg" "SHARED_DEVICE_HAS_IPV4"
		proto_block_restart "$cfg"
		return
	fi
	ip addr del "${gateway4}/32" dev "$passthrough_device" 2>/dev/null
	ip neigh replace proxy "$gateway4" dev "$passthrough_device" 2>/dev/null || ip neigh add proxy "$gateway4" dev "$passthrough_device" 2>/dev/null
	ip route replace "${ip4ifaddr}/32" dev "$passthrough_device" scope link table main 2>/dev/null
	[ "$proxy_arp" = "1" ] && {
		ipip6hp_save_and_set_sysctl "$cfg" "$passthrough_device" proxy_arp 1
		ipip6hp_save_and_set_sysctl "$cfg" "$passthrough_device" proxy_arp_pvlan 1
	}

	proto_init_update "$link" 1

	: ${defaultroute:=1}

	fleth_ipip6_add_tunnel "$ip6addr" "$peeraddr" "$tunlink" "$mtu" "$ttl" "$encaplimit"

	proto_add_data
	[ -n "$zone" ] && json_add_string zone "$zone"
	json_add_string passthrough_device "$passthrough_device"
	json_add_string client_ipv4 "$ip4ifaddr"
	json_add_int client_prefixlen "$ip4prefixlen"
	json_add_string gateway_ipv4 "$gateway4"
	json_add_string ip4table "$ip4table"
	json_add_int ip4rule_priority "$ip4rule_priority"
	proto_close_data

	proto_send_update "$cfg"
	[ "$defaultroute" -eq 1 ] && {
		: ${metric:=0}
		ipip6hp_add_policy_route "$cfg" "$link" "$ip4ifaddr" "$ip4table" "$ip4rule_priority" "$metric"
	}

	fleth_ipip6_add_dynamic_address "$cfg" ipip6hp "$tunlink" "$interface_id" "$ip6addr" "$activation_enabled" "$activation_url" "$prefer_slaac"
	type fleth_apply_ipip6hp_rules >/dev/null 2>&1 && fleth_apply_ipip6hp_rules "$cfg"

	logger -t ipip6hp "[${cfg}] Passthrough setup completed"
}

proto_ipip6hp_teardown() {
	local cfg="$1"
	local ip4ifaddr=$(uci get network.${cfg}.ip4ifaddr 2>/dev/null)
	local gateway4=$(uci get network.${cfg}.gateway4 2>/dev/null)
	local ip4table=$(uci get network.${cfg}.ip4table 2>/dev/null)
	local ip4rule_priority=$(uci get network.${cfg}.ip4rule_priority 2>/dev/null)
	local link="$(fleth_ipip6hp_device_name "$cfg")"
	: ${ip4table:=100}
	: ${ip4rule_priority:=10000}

	type fleth_cancel_ping_activation >/dev/null 2>&1 && fleth_cancel_ping_activation "$cfg"
	local passthrough_device=$(uci get network.${cfg}.device 2>/dev/null)
	if type fleth_remove_ipip6hp_rules >/dev/null 2>&1; then
		fleth_remove_ipip6hp_rules "$cfg"
	else
		ipip6hp_delete_nft_rules "$cfg"
	fi
	[ -n "$ip4ifaddr" ] && ipip6hp_delete_policy_route "$ip4ifaddr" "$ip4table" "$ip4rule_priority" "$link"
	[ -n "$passthrough_device" ] && [ -n "$ip4ifaddr" ] && ip route del "${ip4ifaddr}/32" dev "$passthrough_device" 2>/dev/null
	[ -n "$passthrough_device" ] && [ -n "$gateway4" ] && {
		ip neigh del proxy "$gateway4" dev "$passthrough_device" 2>/dev/null
		ip addr del "${gateway4}/32" dev "$passthrough_device" 2>/dev/null
	}
	[ -n "$passthrough_device" ] && {
		ipip6hp_restore_sysctl "$cfg" "$passthrough_device" proxy_arp
		ipip6hp_restore_sysctl "$cfg" "$passthrough_device" proxy_arp_pvlan
	}

	ifdown "${cfg}_"
	logger -t ipip6hp "[${cfg}] Tearing down"
}

[ -n "$INCLUDE_ONLY" ] || {
	add_protocol ipip6hp
}
