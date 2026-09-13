#!/bin/sh
[ -n "$INCLUDE_ONLY" ] || {
    . /lib/functions.sh
    . /lib/functions/network.sh
    . /usr/share/libubox/jshn.sh
    . /usr/share/fleth/common.sh
    . /usr/share/fleth/ipoe-common.sh
    . /usr/share/fleth/flethp-common.sh
    . ../netifd-proto.sh
    init_proto "$@"
}

proto_flethp_init_config() {
    available=1
    proto_config_add_string tunlink
    proto_config_add_string aftr
    proto_config_add_int mtu
    proto_config_add_int ip4prefixlen
    proto_config_add_string gateway4
    proto_config_add_int ip4table
    proto_config_add_int ip4rule_priority
}
flethp_error() {
    FLETHP_ERROR=$1
    logger -t fleth "[$cfg] flethp: $1"
    proto_notify_error "$cfg" "$1"
    [ "$2" = permanent ] && proto_block_restart "$cfg"
    return 1
}
flethp_other_device() {
    local section="$1" other_device other_proto
    [ "$section" = "$cfg" ] && return
    config_get other_device "$section" device
    config_get other_proto "$section" proto
    [ "$other_device" = "$device" ] && [ "$other_proto" != dhcpv6 ] && conflict=1
}
flethp_setup_locked() (
    local cfg="$1" device="$2" state="/var/run/flethp/$1.state"
    # Subshell prevents old saved fields from contaminating the new configuration.
    ( flethp_cleanup ) || return 1
    local tunlink aftr mtu ip4prefixlen gateway4 ip4table ip4rule_priority
    local link="flethp-$cfg" client gateway prefix table priority mode ports peer local6 uplink
    local old_forward old_proxy old_pvlan old_rpf conflict item
    local address_added=0 tunnel_added=0 route_added=0 default_added=0 gateway_route_added=0 rule_added=0 proxy_added=0 sysctl_set=0 nft_added=0 fw4_chain_added=0
    json_get_vars tunlink aftr mtu ip4prefixlen gateway4 ip4table ip4rule_priority
    tunlink=${tunlink:-wan6}; mtu=${mtu:-1460}; table=${ip4table:-110}; priority=${ip4rule_priority:-11000}
    prefix=$ip4prefixlen; gateway=$gateway4
    flethp_device "$device" && flethp_device "$tunlink" && [ "$tunlink" != "$cfg" ] || { flethp_error INVALID_DEVICE permanent; return 1; }
    flethp_int "$mtu" 1280 1500 && flethp_int "$table" 1 252 && flethp_int "$priority" 1 32765 || { flethp_error INVALID_ROUTING_OPTIONS permanent; return 1; }
    case "$aftr" in *[!A-Za-z0-9.:-]*|-*) flethp_error INVALID_AFTR permanent; return 1;; esac
    for item in ip nft conntrack flock; do command -v "$item" >/dev/null || { flethp_error MISSING_DEPENDENCY permanent; return 1; }; done
    nft list chain inet fw4 forward >/dev/null 2>&1 || { flethp_error FW4_REQUIRED; return 1; }
    ip link show dev "$device" >/dev/null 2>&1 || { flethp_error INVALID_DEVICE; return 1; }
    [ ! -e "/sys/class/net/$device/master" ] || { flethp_error SHARED_DEVICE_HAS_IPV4 permanent; return 1; }
    conflict=0; config_load network; config_foreach flethp_other_device interface
    [ "$conflict" = 0 ] && ! ip -4 addr show dev "$device" | grep -q 'inet ' || { flethp_error SHARED_DEVICE_HAS_IPV4 permanent; return 1; }
    [ -z "$(ip -4 route show table "$table" 2>/dev/null)" ] &&
        ! ip -N -4 rule show | grep -Eq "^${priority}:|lookup ${table}( |$)" || { flethp_error ROUTING_CONFLICT permanent; return 1; }
    ip link show dev "$link" >/dev/null 2>&1 && { flethp_error ROUTING_CONFLICT permanent; return 1; }
    nft list table ip "fp_$cfg" >/dev/null 2>&1 && { flethp_error ROUTING_CONFLICT permanent; return 1; }
    nft list chain inet fw4 "fp_$cfg" >/dev/null 2>&1 && { flethp_error ROUTING_CONFLICT permanent; return 1; }
    ( proto_add_host_dependency "$cfg" :: "$tunlink" )
    network_get_device uplink "$tunlink"
    flethp_device "$uplink" || { flethp_error NO_LOCAL_IPV6; return 1; }
    if ! flethp_detect_plan; then
        case "$FLETHP_ERROR" in INVALID_PSID|INVALID_DOWNSTREAM_ADDRESS) flethp_error "$FLETHP_ERROR" permanent;; *) flethp_error "$FLETHP_ERROR";; esac
        return 1
    fi
    [ -z "$(ip -4 route show table all exact "$client/32")" ] &&
      [ -z "$(ip -4 route show table all exact "$gateway/32")" ] &&
      [ -z "$(ip -4 neigh show proxy dev "$device")" ] || { flethp_error ROUTING_CONFLICT permanent; return 1; }
    for item in forwarding proxy_arp proxy_arp_pvlan rp_filter; do
        [ -w "/proc/sys/net/ipv4/conf/$device/$item" ] || { flethp_error SYSCTL_FAILED; return 1; }
    done
    old_forward=$(cat "/proc/sys/net/ipv4/conf/$device/forwarding")
    old_proxy=$(cat "/proc/sys/net/ipv4/conf/$device/proxy_arp")
    old_pvlan=$(cat "/proc/sys/net/ipv4/conf/$device/proxy_arp_pvlan")
    old_rpf=$(cat "/proc/sys/net/ipv4/conf/$device/rp_filter")
    flethp_save || { flethp_error STATE_WRITE_FAILED; return 1; }
    # Every mutation is checked; the EXIT trap also covers cancellation.
    trap 'result=$?; [ "$result" = 0 ] || proto_notify_error "$cfg" "${FLETHP_STAGE:-SETUP_FAILED}"; flethp_cleanup live' EXIT
    trap 'exit 1' INT TERM
    FLETHP_STAGE=TUNNEL_SETUP_FAILED
    if ! fleth_local_ipv6_exists "$local6"; then
        ip -6 addr add "$local6/128" dev "$uplink" || return 1
        address_added=1; flethp_save || return 1
    fi
    ip -6 tunnel add "$link" mode ipip6 local "$local6" remote "$peer" dev "$uplink" encaplimit none || return 1
    tunnel_added=1; flethp_save || return 1
    ip link set dev "$link" mtu "$mtu" up || return 1
    echo 1 > "/proc/sys/net/ipv4/conf/$link/forwarding" || return 1
    echo 2 > "/proc/sys/net/ipv4/conf/$link/rp_filter" || return 1
    FLETHP_STAGE=ROUTE_SETUP_FAILED
    ip -4 route add "$client/32" dev "$device" scope link table main || return 1
    route_added=1; flethp_save || return 1
    ip -4 route add default dev "$link" table "$table" || return 1
    default_added=1; flethp_save || return 1
    ip -4 route add "$gateway/32" dev "$device" scope link table main || return 1
    gateway_route_added=1; flethp_save || return 1
    ip -4 neigh add proxy "$gateway" dev "$device" || return 1
    proxy_added=1; flethp_save || return 1
    FLETHP_STAGE=SYSCTL_FAILED
    sysctl_set=1; flethp_save || return 1
    for item in forwarding proxy_arp proxy_arp_pvlan; do echo 1 > "/proc/sys/net/ipv4/conf/$device/$item" || return 1; done
    echo 2 > "/proc/sys/net/ipv4/conf/$device/rp_filter" || return 1
    FLETHP_STAGE=NFT_SETUP_FAILED
    nft_added=1; flethp_save || return 1
    flethp_nft || return 1
    FLETHP_STAGE=ROUTE_SETUP_FAILED
    ip -4 rule add priority "$priority" iif "$device" from "$client/32" table "$table" || return 1
    rule_added=1; flethp_save || return 1
    proto_init_update "$link" 1 1
    proto_add_data
    json_add_string state configured
    json_add_string mode "$mode"
    json_add_string client_ipv4 "$client"
    json_add_int client_prefixlen "$prefix"
    json_add_string gateway_ipv4 "$gateway"
    json_add_string peeraddr "$peer"
    json_add_string ports "$ports"
    json_add_boolean internet_verified 0
    proto_close_data
    proto_send_update "$cfg" || return 1
    trap - EXIT INT TERM
)
proto_flethp_setup() (
    local cfg="$1"
    flethp_name "$cfg" || { proto_notify_error "$cfg" INVALID_INTERFACE_NAME; proto_block_restart "$cfg"; return 1; }
    umask 077
    mkdir -p /var/run/flethp || return 1
    exec 9>/var/run/flethp/lock
    flock -x 9 || return 1
    flethp_setup_locked "$@"
)
proto_flethp_teardown() (
    flethp_name "$1" || return 1
    [ -d /var/run/flethp ] || return 0
    exec 9>/var/run/flethp/lock
    flock -x 9 || return 1
    local state="/var/run/flethp/$1.state"
    flethp_cleanup
)
[ -n "$INCLUDE_ONLY" ] || add_protocol flethp
