#!/bin/ash

. /lib/functions.sh

fleth_delete_nft_comment_rules() {
    local chain="$1"
    local comment="$2"
    local handle

    nft -a list chain inet fw4 "$chain" 2>/dev/null | grep "$comment" | sed -n 's/.* handle \([0-9][0-9]*\)$/\1/p' | while read -r handle; do
        [ -n "$handle" ] && nft delete rule inet fw4 "$chain" handle "$handle" 2>/dev/null
    done
}

fleth_remove_ipip6hp_rules() {
    local interface="$1"
    local comment="fleth-ipip6hp-${interface}"

    command -v nft >/dev/null 2>&1 || return
    fleth_delete_nft_comment_rules input "$comment"
    fleth_delete_nft_comment_rules forward "$comment"
}

fleth_collect_ipip6hp_zone() {
    local section="$1"
    local name networks network

    config_get name "$section" name
    config_get networks "$section" network

    [ -n "$name" ] || return

    for network in $networks; do
        [ "$network" = "$fleth_zone_interface" ] || continue
        fleth_zone_matches="${fleth_zone_matches} $name"
        return
    done
}

fleth_get_ipip6hp_zones() {
    fleth_zone_interface="$1"
    fleth_zone_matches=""

    config_load firewall
    config_foreach fleth_collect_ipip6hp_zone zone
    echo "$fleth_zone_matches"
}

fleth_apply_ipip6hp_rules() {
    local interface="$1"
    local proto device link client4 comment zones zone input_chain forward_chain

    proto=$(uci get network.${interface}.proto 2>/dev/null)
    [ "$proto" = "ipip6hp" ] || return

    comment="fleth-ipip6hp-${interface}"

    device=$(uci get network.${interface}.device 2>/dev/null)
    client4=$(uci get network.${interface}.ip4ifaddr 2>/dev/null)
    link=$(ifstatus "$interface" 2>/dev/null | jsonfilter -e '@.l3_device' 2>/dev/null)
    [ -z "$link" ] && link="ipip6hp-${interface}"

    [ -n "$device" ] && [ -n "$link" ] && [ -n "$client4" ] || {
        logger -t fleth-hotplug "ipip6hp $interface missing nft parameters"
        return
    }

    zones=$(fleth_get_ipip6hp_zones "$interface")

    command -v nft >/dev/null 2>&1 || return
    nft list chain inet fw4 forward >/dev/null 2>&1 || return

    fleth_delete_nft_comment_rules input "$comment"
    fleth_delete_nft_comment_rules forward "$comment"

    nft insert rule inet fw4 forward iifname "$device" oifname "$link" ip saddr "$client4" accept comment "$comment" 2>/dev/null
    nft insert rule inet fw4 forward iifname "$link" oifname "$device" ip daddr "$client4" accept comment "$comment" 2>/dev/null

    for zone in $zones; do
        input_chain="input_${zone}"
        forward_chain="forward_${zone}"

        nft list chain inet fw4 "$input_chain" >/dev/null 2>&1 &&
            nft insert rule inet fw4 input iifname "$device" ip saddr "$client4" jump "$input_chain" comment "$comment" 2>/dev/null

        nft list chain inet fw4 "$forward_chain" >/dev/null 2>&1 &&
            nft insert rule inet fw4 forward iifname "$device" ip saddr "$client4" jump "$forward_chain" comment "$comment" 2>/dev/null
    done

    logger -t fleth-hotplug "Applied ipip6hp rules for $interface ($device <-> $link, zones:${zones:- none})"
}

fleth_apply_all_ipip6hp_rules() {
    local interface

    uci show network 2>/dev/null | sed -n "s/^network\.\([^.]*\)\.proto='ipip6hp'$/\1/p" | while read -r interface; do
        [ -n "$interface" ] || continue
        ifstatus "$interface" 2>/dev/null | jsonfilter -e '@.up' 2>/dev/null | grep -q true || continue
        fleth_apply_ipip6hp_rules "$interface"
    done
}
