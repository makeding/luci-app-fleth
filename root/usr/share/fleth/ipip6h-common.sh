#!/bin/sh

fleth_ipip6_add_common_config() {
	local include_auto_activate="${1:-1}"

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
	proto_config_add_boolean "prefer_slaac"
	[ "$include_auto_activate" = "1" ] && proto_config_add_boolean "auto_activate"
	proto_config_add_boolean "activation_enabled"
	proto_config_add_string "activation_url"
}

fleth_ipip6_resolve_peer() {
	local cfg="$1"
	local tag="$2"
	local peeraddr="$3"
	local remoteip6 ip6

	FLETH_IPIP6_REMOTE_ADDR=""
	FLETH_IPIP6_ERROR=""

	logger -t "$tag" "[${cfg}] Resolving peer address: $peeraddr"
	remoteip6=$(resolveip -6 "$peeraddr")
	if [ -z "$remoteip6" ]; then
		sleep 3
		remoteip6=$(resolveip -6 "$peeraddr")
	fi

	[ -n "$remoteip6" ] || {
		logger -t "$tag" "[${cfg}] ERROR: Failed to resolve peer address"
		FLETH_IPIP6_ERROR="PEER_RESOLVE_FAIL"
		return 1
	}

	for ip6 in $remoteip6; do
		logger -t "$tag" "[${cfg}] Resolved to: $ip6"
		FLETH_IPIP6_REMOTE_ADDR="$ip6"
		return 0
	done

	FLETH_IPIP6_ERROR="PEER_RESOLVE_FAIL"
	return 1
}

fleth_ipip6_build_local_addr() {
	local cfg="$1"
	local tag="$2"
	local ip6addr="$3"
	local interface_id="$4"
	local tunlink="$5"
	local wan6_iface prefix_json wan6_prefix prefix_len alignment_check check_status prefix_part clean_id tunlinkif wanif

	FLETH_IPIP6_LOCAL_ADDR=""
	FLETH_IPIP6_ERROR=""

	if [ -n "$ip6addr" ]; then
		FLETH_IPIP6_LOCAL_ADDR="$ip6addr"
		return 0
	fi

	if [ -n "$interface_id" ]; then
		wan6_iface="${tunlink:-wan6}"
		prefix_json=$(ubus call network.interface.${wan6_iface} status 2>/dev/null)

		[ -n "$prefix_json" ] || {
			logger -t "$tag" "[${cfg}] ERROR: Failed to get interface status from $wan6_iface"
			FLETH_IPIP6_ERROR="NO_INTERFACE_STATUS"
			return 1
		}

		wan6_prefix=$(echo "$prefix_json" | jsonfilter -e '@["ipv6-prefix"][0].address' 2>/dev/null)
		prefix_len=$(echo "$prefix_json" | jsonfilter -e '@["ipv6-prefix"][0].mask' 2>/dev/null)

		[ -n "$wan6_prefix" ] || {
			logger -t "$tag" "[${cfg}] ERROR: No IPv6 prefix found on $wan6_iface"
			FLETH_IPIP6_ERROR="NO_IPV6_PREFIX"
			return 1
		}

		if [ "$prefix_len" != "56" ] && [ "$prefix_len" != "64" ]; then
			alignment_check=$(fleth check_alignment "$wan6_prefix" "$prefix_len" 2>/dev/null)
			check_status="${alignment_check%%:*}"
			if [ "$check_status" != "ALIGNED" ] && [ "$check_status" != "SKIPPED" ]; then
				logger -t "$tag" "[${cfg}] ERROR: Prefix not aligned for IPIP6 - $alignment_check"
				logger -t "$tag" "[${cfg}] Current prefix: $wan6_prefix/$prefix_len"
				FLETH_IPIP6_ERROR="PREFIX_NOT_ALIGNED"
				return 1
			fi
		fi

		prefix_part=$(echo "$wan6_prefix" | cut -d: -f1-4)
		clean_id=$(echo "$interface_id" | sed 's/^:*//;s/:*$//')
		ip6addr="${prefix_part}:${clean_id}"
		logger -t "$tag" "[${cfg}] Constructed: $ip6addr (prefix: $wan6_prefix/$prefix_len)"
		FLETH_IPIP6_LOCAL_ADDR="$ip6addr"
		return 0
	fi

	if [ -n "$tunlink" ]; then
		tunlinkif=$(uci_get_state network "$tunlink" ifname)
		ip6addr=$(network_get_ipaddr6 "$tunlinkif")
	fi

	if [ -z "$ip6addr" ]; then
		wanif=$(uci_get_state network wan6 ifname)
		ip6addr=$(network_get_ipaddr6 "$wanif")
	fi

	[ -n "$ip6addr" ] && logger -t "$tag" "[${cfg}] Auto-detected: $ip6addr"
	if [ -n "$ip6addr" ]; then
		FLETH_IPIP6_LOCAL_ADDR="$ip6addr"
		return 0
	fi

	FLETH_IPIP6_ERROR="NO_LOCAL_IPV6"
	return 1
}

fleth_ipip6_add_tunnel() {
	local ip6addr="$1"
	local peeraddr="$2"
	local tunlink="$3"
	local mtu="$4"
	local ttl="$5"
	local encaplimit="$6"

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
}

fleth_ipip6_schedule_activation() {
	local cfg="$1"
	local tag="$2"
	local enabled="$3"
	local url="$4"
	local ip6addr="$5"

	[ "$enabled" = "1" ] || return 0

	if [ -z "$url" ]; then
		logger -t "$tag" "[${cfg}] Activation request enabled but activation URL is empty"
		return 0
	fi

	case "$url" in
		http://*|https://*) ;;
		*)
			logger -t "$tag" "[${cfg}] Activation URL must start with http:// or https://"
			return 0
			;;
	esac

	if ! command -v curl >/dev/null 2>&1; then
		logger -t "$tag" "[${cfg}] Activation request skipped: curl package is not installed"
		return 0
	fi

	(
		sleep 2
		attempt=1
		max_attempts=5
		while [ "$attempt" -le "$max_attempts" ]; do
			curl_output=$(curl --fail --silent --show-error --max-time 15 --interface "$ip6addr" "$url" -o /dev/null 2>&1)
			if [ "$?" -eq 0 ]; then
				logger -t "$tag" "[${cfg}] Activation request completed"
				exit 0
			fi

			logger -t "$tag" "[${cfg}] Activation request failed, attempt ${attempt}/${max_attempts}: $curl_output"
			attempt=$((attempt + 1))
			[ "$attempt" -le "$max_attempts" ] && sleep 3
		done
	) &
}

fleth_ipip6_add_dynamic_address() {
	local cfg="$1"
	local tag="$2"
	local tunlink="$3"
	local interface_id="$4"
	local ip6addr="$5"
	local activation_enabled="$6"
	local activation_url="$7"
	local prefer_slaac="$8"
	local parent_iface

	[ -n "$interface_id" ] && [ -n "$ip6addr" ] || return 0

	parent_iface="${tunlink:-wan6}"
	if fleth_local_ipv6_exists "$ip6addr"; then
		logger -t "$tag" "[${cfg}] IPv6 address $ip6addr already exists; skipping dynamic interface ${cfg}_"
		fleth_ipip6_schedule_activation "$cfg" "$tag" "$activation_enabled" "$activation_url" "$ip6addr"
		type fleth_prefer_slaac_address >/dev/null 2>&1 && fleth_prefer_slaac_address "$cfg" "$parent_iface" "$ip6addr" "$prefer_slaac"
		return 0
	fi

	logger -t "$tag" "[${cfg}] Creating dynamic interface ${cfg}_ on @${parent_iface}"
	json_init
	json_add_string name "${cfg}_"
	json_add_string ifname "@${parent_iface}"
	json_add_string proto "static"
	json_add_array ip6addr
	json_add_string "" "${ip6addr}/128"
	json_close_array
	json_close_object

	if ubus call network add_dynamic "$(json_dump)" >/dev/null 2>&1; then
		fleth_ipip6_schedule_activation "$cfg" "$tag" "$activation_enabled" "$activation_url" "$ip6addr"
		type fleth_prefer_slaac_address >/dev/null 2>&1 && fleth_prefer_slaac_address "$cfg" "$parent_iface" "$ip6addr" "$prefer_slaac"
	else
		logger -t "$tag" "[${cfg}] ERROR: Failed to create dynamic interface ${cfg}_"
	fi
}
