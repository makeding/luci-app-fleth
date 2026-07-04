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

fleth_filter_global_ipv6() {
	grep -viE '^(fe80|f[cd][0-9a-f][0-9a-f]|::|::1|::ffff:0:0|::/96)' | head -n 1
}

fleth_get_area() {
	if [ -f /tmp/resolv.conf.d/resolv.conf.auto ]; then
		if grep -q "flets-east.jp" /tmp/resolv.conf.d/resolv.conf.auto; then
			DNS=$DNS_E
			return
		elif grep -q "flets-west.jp" /tmp/resolv.conf.d/resolv.conf.auto; then
			DNS=$DNS_W
			return
		fi
	fi

	if wget --timeout=1 -s "http://[2404:1a8:f401:100::1]/l/__healthcheck" -O /dev/null >/dev/null 2>&1; then
		DNS=$DNS_E
	elif wget --timeout=1 -s "http://[2001:a7ff:ff0e:1::2]/l/__healthcheck" -O /dev/null >/dev/null 2>&1; then
		DNS=$DNS_W
	fi
}

fleth_get_aaaa_record() {
	local domain="$1"
	local result

	if [ -n "$DNS" ]; then
		result=$(nslookup -type=AAAA "$domain" "$DNS" 2>/dev/null | grep "Address:")
	else
		result=$(nslookup -type=AAAA "$domain" 2>/dev/null | grep "Address:")
	fi
	[ -n "$result" ] && echo "$result" | awk 'NR==2' | awk '{print $2}'
}

fleth_check_ipv6_reachability() {
	ping6 -c 1 -w 2 "$1" >/dev/null 2>&1
}

fleth_get_uplink_ipv6() {
	local tunlink="$1"
	local status
	local ipv6_address

	status=$(ifstatus "$tunlink" 2>/dev/null)
	ipv6_address=$(echo "$status" | grep '"address"' | awk -F '"' '{print $4}' | fleth_filter_global_ipv6)
	if [ -z "$ipv6_address" ]; then
		ipv6_address=$(echo "$status" | jsonfilter -e '@.route[*].source' 2>/dev/null | sed -n 's#/.*##p' | fleth_filter_global_ipv6)
	fi

	echo "$ipv6_address"
}

fleth_set_dslite_provider() {
	local domain="$1"
	local aftr

	case "$domain" in
		*:*) aftr="$domain" ;;
		*)
			aftr=$(fleth_get_aaaa_record "$domain")
			[ -n "$aftr" ] || aftr=$(resolveip -6 "$domain" 2>/dev/null | head -n 1)
			;;
	esac
	[ -n "$aftr" ] || return 1

	FLETH_TYPE="dslite"
	FLETH_AFTR="$aftr"
	FLETH_AFTR_DOMAIN="$domain"
	return 0
}

fleth_has_custom_dslite_provider() {
	[ -n "$custom_aftr" ] && return 0
	[ "$custom_aftr_enabled" = "1" ] && [ -n "$custom_aftr_preset" ] && return 0
	return 1
}

fleth_get_custom_dslite_provider() {
	fleth_get_area

	if [ -n "$custom_aftr" ]; then
		fleth_set_dslite_provider "$custom_aftr" && return 0
	fi

	if [ "$custom_aftr_enabled" = "1" ] && [ -n "$custom_aftr_preset" ]; then
		fleth_set_dslite_provider "$custom_aftr_preset" && return 0
	fi

	return 1
}

fleth_get_dslite_provider() {
	local transix xpass asahi

	fleth_get_custom_dslite_provider && return 0

	transix=$(fleth_get_aaaa_record "gw.transix.jp")
	if [ -n "$transix" ]; then
		FLETH_TYPE="dslite"
		FLETH_AFTR="$transix"
		FLETH_AFTR_DOMAIN="gw.transix.jp"
		return 0
	fi

	xpass=$(fleth_get_aaaa_record "dgw.xpass.jp")
	if [ -n "$xpass" ] && fleth_check_ipv6_reachability "$xpass"; then
		FLETH_TYPE="dslite"
		FLETH_AFTR="$xpass"
		FLETH_AFTR_DOMAIN="dgw.xpass.jp"
		return 0
	fi

	asahi=$(fleth_get_aaaa_record "dslite.v6connect.net")
	if [ -n "$asahi" ]; then
		FLETH_TYPE="dslite"
		FLETH_AFTR="$asahi"
		FLETH_AFTR_DOMAIN="dslite.v6connect.net"
		return 0
	fi

	return 1
}

fleth_get_mape_psid() {
	local ipv6="$1"
	local psidlen="$2"
	local fourth_hextet high_byte psid

	fourth_hextet=$(echo "$ipv6" | sed 's/%.*$//' | cut -d: -f4)
	high_byte=$(printf "%04x" "0x$fourth_hextet" 2>/dev/null | sed 's/..$//')
	[ -n "$high_byte" ] || return 1

	psid=$(printf "%d" "0x$high_byte" 2>/dev/null)
	[ -n "$psid" ] || return 1

	if [ "$psidlen" = "6" ]; then
		psid=$(((psid & 63) << 10))
	elif [ "$psidlen" = "8" ]; then
		psid=$((psid << 8))
	else
		return 1
	fi

	echo "$psid"
}

fleth_detect_mape() {
	local ipv6_address="$1"
	local data i line

	data=$(lua /usr/sbin/fleth-map-e.lua calc "$ipv6_address" 2>/dev/null)
	[ -n "$data" ] && [ "$data" != "UNKNOWN" ] || return 1

	i=0
	while IFS= read -r line; do
		i=$((i + 1))
		case "$i" in
			1) FLETH_PROVIDER=$line ;;
			2) FLETH_IPV4ADDR=$line ;;
			3) FLETH_PEERADDR=$line ;;
			4) FLETH_IP4PREFIX=$line ;;
			5) FLETH_IP4PREFIXLEN=$line ;;
			6) FLETH_IP6PREFIX=$line ;;
			7) FLETH_IP6PREFIXLEN=$line ;;
			8) FLETH_EALEN=$line ;;
			9) FLETH_PSIDLEN=$line ;;
			10) FLETH_OFFSET=$line ;;
			12) FLETH_LOCAL_IPV6=$line ;;
		esac
	done << EOF
$data
EOF

	[ -n "$FLETH_PEERADDR" ] && [ -n "$FLETH_IPV4ADDR" ] || return 1
	FLETH_TYPE="map-e"
	FLETH_PSID=$(fleth_get_mape_psid "$ipv6_address" "$FLETH_PSIDLEN")
	return 0
}

fleth_map_portsets_from_psid() {
	local psid="$1"
	local psidlen="$2"
	local offset="$3"
	local raw_psid max_raw_psid block amax a start end portsets=""

	case "$psid:$psidlen:$offset" in
		*[!0-9:]*|::*|*::*) return 1 ;;
	esac

	max_raw_psid=$((1 << psidlen))
	if [ "$psid" -lt "$max_raw_psid" ]; then
		raw_psid="$psid"
	else
		raw_psid=$((psid >> (16 - psidlen)))
	fi

	block=$((1 << (16 - offset - psidlen)))
	amax=$(((1 << offset) - 1))
	a=1
	while [ "$a" -le "$amax" ]; do
		start=$(((a << (16 - offset)) | (raw_psid << (16 - offset - psidlen))))
		end=$((start + block - 1))
		portsets="${portsets}${start}-${end} "
		a=$((a + 1))
	done

	echo "$portsets"
}

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

	proto_add_tunnel
	json_add_string mode ipip6
	json_add_int mtu "${mtu:-1460}"
	json_add_int ttl "${ttl:-64}"
	json_add_string local "$local_ipv6"
	json_add_string remote "$FLETH_PEERADDR"
	[ -n "$tunlink" ] && json_add_string link "$tunlink"
	json_add_object "data"
		[ -n "$encaplimit" ] && json_add_string encaplimit "$encaplimit"
	json_close_object
	proto_close_tunnel

	proto_add_data
	[ -n "$zone" ] && json_add_string zone "$zone"
	proto_close_data
	proto_send_update "$cfg"

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

	proto_init_update "$link" 1
	: ${defaultroute:=1}
	[ "$defaultroute" -eq 1 ] && {
		: ${metric:=0}
		proto_add_ipv4_route "0.0.0.0" 0 "" "" "$metric"
	}
	proto_add_ipv4_address "$ip4addr" "" "" "$ip4gateway"

	proto_add_tunnel
	json_add_string mode ipip6
	json_add_int mtu "${mtu:-1460}"
	json_add_int ttl "${ttl:-64}"
	json_add_string remote "$FLETH_AFTR"
	[ -n "$FLETH_IPV6ADDR" ] && json_add_string local "$FLETH_IPV6ADDR"
	[ -n "$tunlink" ] && json_add_string link "$tunlink"
	json_add_object "data"
		[ -n "$encaplimit" ] && json_add_string encaplimit "$encaplimit"
	json_close_object
	proto_close_tunnel

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

	json_get_vars tunlink mtu ttl encaplimit zone defaultroute metric prefer_slaac auto_activate custom_aftr_enabled custom_aftr_preset custom_aftr
	[ "$zone" = "-" ] && zone=""
	tunlink="${tunlink:-wan6}"

	( proto_add_host_dependency "$cfg" "::" "$tunlink" )

	FLETH_IPV6ADDR=$(fleth_get_uplink_ipv6 "$tunlink")
	if [ -z "$FLETH_IPV6ADDR" ]; then
		proto_notify_error "$cfg" "NO_LOCAL_IPV6"
		return
	fi

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

	if fleth_detect_mape "$FLETH_IPV6ADDR"; then
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
	proto_config_add_boolean "custom_aftr_enabled"
	proto_config_add_string "custom_aftr_preset"
	proto_config_add_string "custom_aftr"
}

[ -n "$INCLUDE_ONLY" ] || {
	add_protocol fleth
}
