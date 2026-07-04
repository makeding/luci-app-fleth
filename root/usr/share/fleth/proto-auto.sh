#!/bin/sh

fleth_proto_auto() {
    if [ "$(pgrep -f "fleth auto" | wc -l)" -ge 3 ]; then
        exit 0
    fi

    logger -t fleth "native proto auto is running $h_ENABLED"
    [ "$h_ENABLED" = "1" ] || return 0

    current_proto=$(uci get network.${h_TUNNEL_INTERFACE}.proto 2>/dev/null)
    current_tunlink=$(uci get network.${h_TUNNEL_INTERFACE}.tunlink 2>/dev/null)
    current_mtu=$(uci get network.${h_TUNNEL_INTERFACE}.mtu 2>/dev/null)
    current_zone_index=$(uci show firewall | grep -E "firewall.@zone\[[0-9]+\].network=.*'$h_TUNNEL_INTERFACE'" | sed -n "s/.*@zone\[\([0-9]\+\)\].*/\1/p")
    new_zone_index=$(uci show firewall | grep -E "firewall.@zone\[[0-9]+\].name='$h_TUNNEL_INTERFACE_zone'" | sed -n "s/.*@zone\[\([0-9]\+\)\].*/\1/p")

    if [ "$current_proto" != "fleth" ] ||
       [ "$current_tunlink" != "$h_UPLINK_INTERFACE" ] ||
       [ "$current_mtu" != "$h_TUNNEL_INTERFACE_MTU" ]; then
        uci batch <<EOF
set network.${h_TUNNEL_INTERFACE}=interface
set network.${h_TUNNEL_INTERFACE}.proto='fleth'
set network.${h_TUNNEL_INTERFACE}.tunlink='${h_UPLINK_INTERFACE}'
set network.${h_TUNNEL_INTERFACE}.mtu='${h_TUNNEL_INTERFACE_MTU}'
set network.${h_TUNNEL_INTERFACE}.encaplimit='ignore'
set network.${h_TUNNEL_INTERFACE}.defaultroute='1'
EOF
        uci delete network.${h_TUNNEL_INTERFACE}.device 2>/dev/null
        if [ "$new_zone_index" != "$current_zone_index" ]; then
            uci del_list firewall.@zone[$current_zone_index].network="$h_TUNNEL_INTERFACE" 2>/dev/null
            uci add_list firewall.@zone[$new_zone_index].network="$h_TUNNEL_INTERFACE" 2>/dev/null
        fi
        uci commit
        ifdown ${h_TUNNEL_INTERFACE}; sleep 2; ifup ${h_TUNNEL_INTERFACE}
        logger -t fleth "New native fleth configuration committed ${h_TUNNEL_INTERFACE}"
    elif [ "$new_zone_index" != "$current_zone_index" ]; then
        uci del_list firewall.@zone[$current_zone_index].network="$h_TUNNEL_INTERFACE" 2>/dev/null
        uci add_list firewall.@zone[$new_zone_index].network="$h_TUNNEL_INTERFACE" 2>/dev/null
        uci commit firewall
    fi

    auto_configure_extendprefix
}
