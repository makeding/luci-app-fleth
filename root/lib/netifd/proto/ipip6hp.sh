#!/bin/sh

[ -n "$INCLUDE_ONLY" ] || {
	. /lib/functions.sh
	. /lib/functions/network.sh
	. /lib/netifd/netifd-proto.sh
	init_proto "$@"
}

proto_ipip6hp_init_config() {
	available=1

	proto_config_add_string "peeraddr"
	proto_config_add_string "ip4ifaddr"
	proto_config_add_int "ip4prefixlen"
	proto_config_add_string "gateway4"
	proto_config_add_boolean "allow_shared_device"
	proto_config_add_boolean "proxy_arp"
	proto_config_add_string "ip4table"
	proto_config_add_int "ip4rule_priority"
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

	for chain in dstnat input forward srcnat; do
		nft -a list chain inet fw4 "$chain" 2>/dev/null | grep "$comment" | sed -n 's/.* handle \([0-9][0-9]*\)$/\1/p' | while read -r handle; do
			[ -n "$handle" ] && nft delete rule inet fw4 "$chain" handle "$handle" 2>/dev/null
		done
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
	local link="ipip6hp-$cfg"

	local peeraddr ip4ifaddr ip4prefixlen gateway4 allow_shared_device proxy_arp ip4table ip4rule_priority ip6addr interface_id tunlink mtu ttl encaplimit zone defaultroute metric
	json_get_vars peeraddr ip4ifaddr ip4prefixlen gateway4 allow_shared_device proxy_arp ip4table ip4rule_priority ip6addr interface_id tunlink mtu ttl encaplimit zone defaultroute metric

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
	ip route replace "${ip4ifaddr}/32" dev "$passthrough_device" 2>/dev/null
	[ "$proxy_arp" = "1" ] && {
		ipip6hp_save_and_set_sysctl "$cfg" "$passthrough_device" proxy_arp 1
		ipip6hp_save_and_set_sysctl "$cfg" "$passthrough_device" proxy_arp_pvlan 1
	}

	proto_init_update "$link" 1

	: ${defaultroute:=1}

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
	local ip4table=$(uci get network.${cfg}.ip4table 2>/dev/null)
	local ip4rule_priority=$(uci get network.${cfg}.ip4rule_priority 2>/dev/null)
	local link="ipip6hp-$cfg"
	: ${ip4table:=100}
	: ${ip4rule_priority:=10000}

	local passthrough_device=$(uci get network.${cfg}.device 2>/dev/null)
	ipip6hp_delete_nft_rules "$cfg"
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
