#!/bin/sh
# Shared IPoE detection and MAP-E calculations.
DNS_E=2404:1a8:7f01:a::3
DNS_W=2001:a7ff:5f01::a

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
	[ -n "$1" ] || return 1
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
