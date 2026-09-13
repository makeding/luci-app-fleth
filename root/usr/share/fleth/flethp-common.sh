#!/bin/sh
# Runtime state is root-owned, bounded per interface, and never derived from new UCI on cleanup.
flethp_name() { case "$1" in ''|*[!A-Za-z0-9_]*) return 1;; esac; [ "${#1}" -le 8 ]; }
flethp_device() { case "$1" in ''|*[!A-Za-z0-9_.:-]*) return 1;; esac; [ "${#1}" -le 15 ]; }
flethp_int() { case "$1" in ''|*[!0-9]*|0[0-9]*) return 1;; esac; [ "${#1}" -le 9 ] && [ "$1" -ge "$2" ] && [ "$1" -le "$3" ]; }
flethp_ipv4_number() {
    echo "$1" | awk -F. 'NF != 4 {exit 1} {n=0; for(i=1;i<=4;i++) {if($i !~ /^[0-9]+$/ || length($i)>3 || ($i ~ /^0./) || $i>255) exit 1; n=n*256+$i} if ($1==0 || $1==127 || $1>=224) exit 1; printf "%.0f\n",n}'
}
flethp_address_plan() {
    local n g block host
    n=$(flethp_ipv4_number "$client") || return 1
    [ -n "$prefix" ] || { [ "$mode" = map-e ] && prefix=31 || prefix=29; }
    flethp_int "$prefix" 1 31 || return 1
    [ -n "$gateway" ] || {
        if [ "$mode" = map-e ]; then
            gateway="${client%.*}.$(( (${client##*.} / 2) * 2 + 1 - ${client##*.} % 2 ))"
        else gateway=192.0.0.1; fi
    }
    g=$(flethp_ipv4_number "$gateway") || return 1
    block=$((1 << (32-prefix)))
    [ "$n" != "$g" ] && [ "$((n / block))" = "$((g / block))" ] || return 1
    if [ "$prefix" -lt 31 ]; then
        for host in "$n" "$g"; do
            [ "$((host % block))" -ne 0 ] && [ "$((host % block))" -ne "$((block-1))" ] || return 1
        done
    fi
}
flethp_save() {
    local key value
    # If saving fails, rollback still uses live flags and the previous journal.
    umask 077
    # Validated identifiers/numbers only; peer and port values are validated before this call.
    : > "$state.new" || return 1
    for key in cfg device link client gateway prefix table priority mode ports peer local6 uplink old_forward old_proxy old_pvlan old_rpf address_added tunnel_added route_added default_added gateway_route_added rule_added proxy_added sysctl_set nft_added fw4_chain_added; do
        eval 'value=${'"$key"'-}'
        printf "%s='%s'\n" "$key" "$value" >> "$state.new" || return 1
    done
    mv "$state.new" "$state"
}
flethp_remove_fw4() {
    local handle
    nft -a list chain inet fw4 forward 2>/dev/null | awk -v tag="flethp:$cfg" '
        index($0,"comment \"" tag "\"") {for(i=1;i<NF;i++) if($i=="handle") print $(i+1)}' |
    while read -r handle; do nft delete rule inet fw4 forward handle "$handle" || return 1; done
}
flethp_fw4() {
    if nft list chain inet fw4 "fp_$cfg" >/dev/null 2>&1; then
        [ "$fw4_chain_added" = 1 ] || return 1
        flethp_remove_fw4 || return 1
        nft flush chain inet fw4 "fp_$cfg" && nft delete chain inet fw4 "fp_$cfg" || return 1
    else
        [ "$fw4_chain_added" != 1 ] || flethp_remove_fw4 || return 1
    fi
    # One jump, installed before fw4's generic established/flow offload rules.
    {
        echo "add chain inet fw4 fp_$cfg"
        echo "add rule inet fw4 fp_$cfg iifname \"$device\" oifname \"$link\" ip saddr $client accept"
        echo "add rule inet fw4 fp_$cfg iifname \"$link\" oifname \"$device\" ip daddr $client accept"
        echo "insert rule inet fw4 forward jump fp_$cfg comment \"flethp:$cfg\""
    } | nft -f - || return 1
    fw4_chain_added=1
    flethp_save
}
flethp_nft() {
    local ranges='' range start end count=0 mapping='' proto
    for range in $ports; do
        case "$range" in *[!0-9-]*|*-*-*) return 1;; esac
        start=${range%-*}; end=${range#*-}
        flethp_int "$start" 1 65535 && flethp_int "$end" "$start" 65535 || return 1
        ranges="$ranges$range, "
        mapping="$mapping$count : jump block$count, "
        count=$((count+1))
    done
    ranges=${ranges%, }; mapping=${mapping%, }
    [ "$mode" != map-e ] || [ "$count" -gt 0 ] || return 1
    {
        echo "add table ip fp_$cfg"
        echo "add chain ip fp_$cfg guard { type filter hook forward priority -10; policy accept; }"
        echo "add chain ip fp_$cfg output { type filter hook output priority -10; policy accept; }"
        echo "add rule ip fp_$cfg output oifname \"$link\" drop"
        echo "add rule ip fp_$cfg guard iifname \"$device\" ip saddr != $client drop"
        echo "add rule ip fp_$cfg guard iifname \"$device\" oifname != \"$link\" drop"
        echo "add rule ip fp_$cfg guard oifname \"$link\" iifname != \"$device\" drop"
        echo "add rule ip fp_$cfg guard iifname \"$link\" ip daddr != $client drop"
        echo "add rule ip fp_$cfg guard iifname \"$link\" oifname != \"$device\" drop"
        echo "add rule ip fp_$cfg guard iifname { \"$device\", \"$link\" } ct state invalid drop"
        echo "add chain ip fp_$cfg nat { type nat hook postrouting priority 90; policy accept; }"
        if [ "$mode" = map-e ]; then
            echo "add set ip fp_$cfg ports { type inet_service; flags interval; elements = { $ranges }; }"
            echo "add chain ip fp_$cfg inbound"
            echo "add rule ip fp_$cfg guard iifname \"$link\" jump inbound"
            echo "add rule ip fp_$cfg inbound ct state established,related accept"
            for proto in tcp udp; do
                echo "add rule ip fp_$cfg inbound $proto dport @ports accept"
            done
            echo "add rule ip fp_$cfg inbound icmp type echo-request icmp id @ports accept"
            echo "add rule ip fp_$cfg inbound drop"
            echo "add chain ip fp_$cfg allocate"
            echo "add rule ip fp_$cfg nat iifname \"$device\" oifname \"$link\" ip saddr $client jump allocate"
            for proto in tcp udp; do
                # Identity SNAT creates a conntrack NAT binding even when the address is unchanged.
                echo "add rule ip fp_$cfg allocate $proto sport @ports snat to $client : $proto sport"

            done
            echo "add rule ip fp_$cfg allocate icmp type { echo-request, echo-reply } icmp id @ports snat to $client : icmp id"
            count=0
            for range in $ports; do
                echo "add chain ip fp_$cfg block$count"
                echo "add rule ip fp_$cfg block$count ip protocol { tcp, udp, icmp } snat to $client : $range"
                count=$((count+1))
            done
            echo "add rule ip fp_$cfg allocate ip protocol { tcp, udp, icmp } numgen inc mod $count vmap { $mapping }"
            echo "add rule ip fp_$cfg guard iifname \"$device\" ct state related accept"
            echo "add rule ip fp_$cfg guard iifname \"$device\" ip protocol { tcp, udp } accept"
            echo "add rule ip fp_$cfg guard iifname \"$device\" icmp type { echo-request, echo-reply } accept"
            echo "add rule ip fp_$cfg guard iifname \"$device\" drop"
        else
            # A null NAT binding prevents later fw4 masquerade from changing the B4 source.
            echo "add rule ip fp_$cfg nat iifname \"$device\" oifname \"$link\" ip saddr $client accept"
        fi
    } | nft -f - || return 1
    flethp_fw4
}
flethp_cleanup() {
    [ -f "$state" ] || return 0
    [ "$1" = live ] || . "$state"
    local item
    # Remove forwarding permission first. Keep the journal if an owned resource
    # cannot be removed, so the next setup cannot reuse it as an unowned object.
    if [ "$fw4_chain_added" = 1 ]; then
        flethp_remove_fw4 || return 1
        if nft list chain inet fw4 "fp_$cfg" >/dev/null 2>&1; then
            nft flush chain inet fw4 "fp_$cfg" && nft delete chain inet fw4 "fp_$cfg" || return 1
        fi
        fw4_chain_added=0; flethp_save || return 1
    fi
    if [ "$rule_added" = 1 ]; then
        if ip -N -4 rule show | grep -q "^${priority}:"; then
            ip -4 rule del priority "$priority" iif "$device" from "$client/32" table "$table" || return 1
        fi
        # Clear only this dedicated client's sessions while its routing is stopped.
        # conntrack exits 1 when no matching entries exist.
        conntrack -D -f ipv4 -s "$client" >/dev/null 2>&1
        conntrack -D -f ipv4 -d "$client" >/dev/null 2>&1
        rule_added=0; flethp_save || return 1
    fi
    if [ "$default_added" = 1 ]; then
        if [ -n "$(ip -4 route show table "$table" default)" ]; then
            ip -4 route del default dev "$link" table "$table" || return 1
        fi
        default_added=0; flethp_save || return 1
    fi
    for item in client gateway; do
        local addr flag
        if [ "$item" = client ]; then addr=$client; flag=$route_added; else addr=$gateway; flag=$gateway_route_added; fi
        if [ "$flag" = 1 ]; then
            if [ -n "$(ip -4 route show table main exact "$addr/32")" ]; then
                ip -4 route del "$addr/32" dev "$device" table main || return 1
            fi
            if [ "$item" = client ]; then route_added=0; else gateway_route_added=0; fi
            flethp_save || return 1
        fi
    done
    if [ "$proxy_added" = 1 ]; then
        if ip -4 neigh show proxy dev "$device" | grep -q "^$gateway "; then
            ip -4 neigh del proxy "$gateway" dev "$device" || return 1
        fi
        proxy_added=0; flethp_save || return 1
    fi
    if [ "$sysctl_set" = 1 ] && [ -d "/proc/sys/net/ipv4/conf/$device" ]; then
        for item in "forwarding:$old_forward" "proxy_arp:$old_proxy" "proxy_arp_pvlan:$old_pvlan" "rp_filter:$old_rpf"; do
            echo "${item#*:}" > "/proc/sys/net/ipv4/conf/$device/${item%:*}" || return 1
        done
        sysctl_set=0; flethp_save || return 1
    fi
    if [ "$tunnel_added" = 1 ]; then
        if ip link show dev "$link" >/dev/null 2>&1; then ip link del "$link" || return 1; fi
        tunnel_added=0; flethp_save || return 1
    fi
    if [ "$address_added" = 1 ]; then
        if ip -6 addr show dev "$uplink" to "$local6/128" | grep -q 'inet6 '; then
            ip -6 addr del "$local6/128" dev "$uplink" || return 1
        fi
        address_added=0; flethp_save || return 1
    fi
    if [ "$nft_added" = 1 ]; then
        if nft list table ip "fp_$cfg" >/dev/null 2>&1; then nft delete table ip "fp_$cfg" || return 1; fi
    fi
    rm -f "$state" "$state.new"
}

flethp_detection_error() { FLETHP_ERROR="$1"; return 1; }

# Read-only: used by both setup and the unsaved settings-page preview.
flethp_detect_plan() {
    FLETH_IPV6ADDR=$(fleth_get_uplink_ipv6 "$tunlink")
    [ -n "$FLETH_IPV6ADDR" ] || { flethp_detection_error NO_LOCAL_IPV6; return 1; }
    if [ -n "$aftr" ]; then
        fleth_set_dslite_provider "$aftr" || { flethp_detection_error AFTR_RESOLVE_FAIL; return 1; }
    elif fleth_detect_mape "$FLETH_IPV6ADDR"; then :
    else
        fleth_get_dslite_provider || { flethp_detection_error NO_MAPE_OR_DSLITE_PROVIDER; return 1; }
    fi
    mode=$FLETH_TYPE
    if [ "$mode" = map-e ]; then
        client=$FLETH_IPV4ADDR; peer=$FLETH_PEERADDR; local6=${FLETH_LOCAL_IPV6:-$FLETH_IPV6ADDR}
        flethp_int "$FLETH_PSIDLEN" 1 15 && flethp_int "$FLETH_OFFSET" 1 15 &&
            [ "$((FLETH_PSIDLEN + FLETH_OFFSET))" -le 16 ] && flethp_int "$FLETH_PSID" 0 65535 || { flethp_detection_error INVALID_PSID permanent; return 1; }
        ports=$(fleth_map_portsets_from_psid "$FLETH_PSID" "$FLETH_PSIDLEN" "$FLETH_OFFSET")
    else
        client=192.0.0.2; peer=$FLETH_AFTR
        network_get_ipaddr6 local6 "$tunlink"
        local6=${local6:-$FLETH_IPV6ADDR}
    fi
    case "$peer:$local6" in *[!0-9a-fA-F:]*|::* ) flethp_detection_error INVALID_LOCAL_IPV6; return 1;; esac
    flethp_address_plan || { flethp_detection_error INVALID_DOWNSTREAM_ADDRESS permanent; return 1; }
    return 0
}
