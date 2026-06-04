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

fleth_delete_nft_comment_rules_all() {
    local comment="$1"
    local chain handle

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

fleth_rule_priority_before() {
    local needle="$1"
    local fallback="$2"
    local priority

    priority=$(ip rule show 2>/dev/null | awk -v needle="$needle" '
        {
            if (index($0, needle) && index($0, "lookup main suppress_prefixlength 0") == 0) {
                sub(":", "", $1)
                print $1
                exit
            }
        }
    ')
    [ -n "$priority" ] || priority="$fallback"

    case "$priority" in
        ''|*[!0-9]*)
            return
            ;;
        0)
            echo 0
            ;;
        *)
            echo $((priority - 1))
            ;;
    esac
}

fleth_apply_ipip6hp_policy_rules() {
    local interface="$1"
    local device="$2"
    local client4="$3"
    local base_priority to_priority from_priority

    base_priority=$(uci get network.${interface}.ip4rule_priority 2>/dev/null)
    case "$base_priority" in
        ''|*[!0-9]*)
            base_priority=10000
            ;;
    esac

    ip route replace "${client4}/32" dev "$device" scope link table main 2>/dev/null

    to_priority=$(fleth_rule_priority_before " to ${client4} " "$base_priority")
    from_priority=$(fleth_rule_priority_before "from ${client4} " "$base_priority")

    [ -n "$to_priority" ] && {
        ip rule del priority "$to_priority" to "${client4}/32" lookup main suppress_prefixlength 0 2>/dev/null
        ip rule del to "${client4}/32" lookup main suppress_prefixlength 0 2>/dev/null
        ip rule add priority "$to_priority" to "${client4}/32" lookup main suppress_prefixlength 0 2>/dev/null
    }

    [ -n "$from_priority" ] && {
        ip rule del priority "$from_priority" from "${client4}/32" lookup main suppress_prefixlength 0 2>/dev/null
        ip rule del from "${client4}/32" lookup main suppress_prefixlength 0 2>/dev/null
        ip rule add priority "$from_priority" from "${client4}/32" lookup main suppress_prefixlength 0 2>/dev/null
    }
}

fleth_remove_ipip6hp_policy_rules() {
    local interface="$1"
    local client4 base_priority to_priority from_priority

    client4=$(uci get network.${interface}.ip4ifaddr 2>/dev/null)
    [ -n "$client4" ] || return

    base_priority=$(uci get network.${interface}.ip4rule_priority 2>/dev/null)
    case "$base_priority" in
        ''|*[!0-9]*)
            base_priority=10000
            ;;
    esac

    to_priority=$(fleth_rule_priority_before " to ${client4} " "$base_priority")
    from_priority=$(fleth_rule_priority_before "from ${client4} " "$base_priority")

    [ -n "$to_priority" ] &&
        ip rule del priority "$to_priority" to "${client4}/32" lookup main suppress_prefixlength 0 2>/dev/null
    ip rule del to "${client4}/32" lookup main suppress_prefixlength 0 2>/dev/null

    [ -n "$from_priority" ] &&
        ip rule del priority "$from_priority" from "${client4}/32" lookup main suppress_prefixlength 0 2>/dev/null
    ip rule del from "${client4}/32" lookup main suppress_prefixlength 0 2>/dev/null
}

fleth_remove_ipip6hp_rules() {
    local interface="$1"
    local comment="fleth-ipip6hp-${interface}"

    fleth_remove_ipip6hp_policy_rules "$interface"

    command -v nft >/dev/null 2>&1 || return
    fleth_delete_nft_comment_rules_all "$comment"
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

fleth_get_ipip6hp_mss() {
    local interface="$1"
    local mtu mss

    mtu=$(uci get network.${interface}.mtu 2>/dev/null)
    case "$mtu" in
        ''|*[!0-9]*)
            mtu=1460
            ;;
    esac

    mss=$((mtu - 40))
    [ "$mss" -lt 536 ] && mss=536

    echo "$mss"
}

fleth_apply_ipip6hp_rules() {
    local interface="$1"
    local proto device link client4 comment zones zone input_chain forward_chain accept_to_chain mss

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
    mss=$(fleth_get_ipip6hp_mss "$interface")

    command -v nft >/dev/null 2>&1 || return
    nft list chain inet fw4 forward >/dev/null 2>&1 || return

    fleth_remove_ipip6hp_policy_rules "$interface"
    fleth_delete_nft_comment_rules_all "$comment"

    nft insert rule inet fw4 forward iifname "$device" oifname "$link" ip saddr "$client4" accept comment "$comment" 2>/dev/null
    nft insert rule inet fw4 forward iifname "$link" oifname "$device" ip daddr "$client4" accept comment "$comment" 2>/dev/null

    if nft list chain inet fw4 mangle_forward >/dev/null 2>&1; then
        nft insert rule inet fw4 mangle_forward iifname "$device" oifname "$link" tcp flags syn tcp option maxseg size set "$mss" comment "$comment" 2>/dev/null
        nft insert rule inet fw4 mangle_forward iifname "$link" oifname "$device" tcp flags syn tcp option maxseg size set "$mss" comment "$comment" 2>/dev/null
    fi

    [ -n "$zones" ] && fleth_apply_ipip6hp_policy_rules "$interface" "$device" "$client4"

    for zone in $zones; do
        input_chain="input_${zone}"
        forward_chain="forward_${zone}"
        accept_to_chain="accept_to_${zone}"

        nft list chain inet fw4 "$input_chain" >/dev/null 2>&1 &&
            nft insert rule inet fw4 input iifname "$device" ip saddr "$client4" jump "$input_chain" comment "$comment" 2>/dev/null

        nft list chain inet fw4 "$forward_chain" >/dev/null 2>&1 &&
            nft insert rule inet fw4 forward iifname "$device" ip saddr "$client4" jump "$forward_chain" comment "$comment" 2>/dev/null

        nft list chain inet fw4 "$accept_to_chain" >/dev/null 2>&1 &&
            nft insert rule inet fw4 "$accept_to_chain" oifname "$device" ip daddr "$client4" accept comment "$comment" 2>/dev/null
    done

    logger -t fleth-hotplug "Applied ipip6hp rules for $interface ($device <-> $link, mss: $mss, zones:${zones:- none})"
}

fleth_apply_all_ipip6hp_rules() {
    local interface

    uci show network 2>/dev/null | sed -n "s/^network\.\([^.]*\)\.proto='ipip6hp'$/\1/p" | while read -r interface; do
        [ -n "$interface" ] || continue
        ifstatus "$interface" 2>/dev/null | jsonfilter -e '@.up' 2>/dev/null | grep -q true || continue
        fleth_apply_ipip6hp_rules "$interface"
    done
}
