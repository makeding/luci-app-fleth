#!/bin/sh

fleth_schedule_ping_activation() {
    local cfg="$1"
    local device="$2"
    local delay="${3:-30}"
    local pid_file="/var/run/fleth-activation-${cfg}.pid"

    [ -n "$cfg" ] && [ -n "$device" ] || return 0

    if [ -f "$pid_file" ]; then
        local old_pid
        old_pid=$(cat "$pid_file" 2>/dev/null)
        [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null && kill "$old_pid" 2>/dev/null
    fi

    (
        echo $$ > "$pid_file"
        sleep "$delay"
        ping -I "$device" 1.1.1.1 -c 1 -W 3 >/dev/null 2>&1
        rm -f "$pid_file"
    ) &
}

fleth_cancel_ping_activation() {
    local cfg="$1"
    local pid_file="/var/run/fleth-activation-${cfg}.pid"
    local old_pid

    [ -n "$cfg" ] || return 0
    [ -f "$pid_file" ] || return 0

    old_pid=$(cat "$pid_file" 2>/dev/null)
    [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null && kill "$old_pid" 2>/dev/null
    rm -f "$pid_file"
}

fleth_get_interface_device() {
    local iface="$1"
    local status device

    [ -n "$iface" ] || return 1

    status=$(ifstatus "$iface" 2>/dev/null)
    device=$(echo "$status" | jsonfilter -e '@.device' 2>/dev/null)
    [ -n "$device" ] || device=$(echo "$status" | jsonfilter -e '@.l3_device' 2>/dev/null)
    [ -n "$device" ] || device=$(uci get network.${iface}.device 2>/dev/null)
    [ -n "$device" ] || device=$(uci get network.${iface}.ifname 2>/dev/null)
    [ -n "$device" ] || return 1

    echo "$device"
}

fleth_prefer_slaac_address() {
    local cfg="$1"
    local parent_iface="$2"
    local ip6addr="$3"
    local enabled="${4:-1}"
    local parent_device

    [ "$enabled" = "1" ] || return 0
    [ -n "$parent_iface" ] && [ -n "$ip6addr" ] || return 0

    parent_device=$(fleth_get_interface_device "$parent_iface") || return 0
    [ -n "$parent_device" ] || return 0

    ip -6 addr change "${ip6addr}/128" dev "$parent_device" preferred_lft 0 2>/dev/null
    logger -t fleth "[${cfg}] Deprecated static address ${ip6addr} on ${parent_device} to prefer SLAAC"
}
