#!/bin/sh

MAPSH_PATH="/lib/netifd/proto/map.sh"
MAPSH_BACKUP_PATH="/lib/netifd/proto/map.sh.flethbak"
FLETH_MAPSH_PATH="/usr/share/fleth/map.sh"

fleth_legacy_set_interface() {
    current_proto=$(uci get network.${h_TUNNEL_INTERFACE}.proto 2>/dev/null)
    current_tunlink=$(uci get network.${h_TUNNEL_INTERFACE}.tunlink 2>/dev/null)
    current_mtu=$(uci get network.${h_TUNNEL_INTERFACE}.mtu 2>/dev/null)
    current_zone_index=$(uci show firewall | grep -E "firewall.@zone\[[0-9]+\].network=.*'$h_TUNNEL_INTERFACE'" | sed -n "s/.*@zone\[\([0-9]\+\)\].*/\1/p")
    new_zone_index=$(uci show firewall | grep -E "firewall.@zone\[[0-9]+\].name='$h_TUNNEL_INTERFACE_zone'" | sed -n "s/.*@zone\[\([0-9]\+\)\].*/\1/p")

    if [ "$r_TYPE" = 'ds-lite' ]; then
        if [ -z "$r_AFTR" ] || [ -z "$h_TUNNEL_INTERFACE" ] || [ -z "$h_TUNNEL_INTERFACE_MTU" ] || [ -z "$h_UPLINK_INTERFACE" ]; then
            echo "Failed to retrieve one or more configuration values"
            exit 1
        fi
        current_peeraddrdomain=$(uci get network.${h_TUNNEL_INTERFACE}.peeraddrdomain 2>/dev/null)
        if [ "$current_peeraddrdomain" != "$r_AFTR_DOMAIN" ] ||
           [ "$current_tunlink" != "$h_UPLINK_INTERFACE" ] ||
           [ "$current_proto" != 'dslite' ] ||
           [ "$current_mtu" != "$h_TUNNEL_INTERFACE_MTU" ]; then
            uci batch <<EOF
set network.${h_TUNNEL_INTERFACE}=interface
set network.${h_TUNNEL_INTERFACE}.proto='dslite'
set network.${h_TUNNEL_INTERFACE}.peeraddr='${r_AFTR}'
set network.${h_TUNNEL_INTERFACE}.peeraddrdomain='${r_AFTR_DOMAIN}'
set network.${h_TUNNEL_INTERFACE}.tunlink='${h_UPLINK_INTERFACE}'
set network.${h_TUNNEL_INTERFACE}.mtu='${h_TUNNEL_INTERFACE_MTU}'
set network.${h_TUNNEL_INTERFACE}.encaplimit='ignore'
EOF
            uci delete network.${h_TUNNEL_INTERFACE}.device 2>/dev/null
            if [ "$new_zone_index" != "$current_zone_index" ]; then
                uci del_list firewall.@zone[$current_zone_index].network="$h_TUNNEL_INTERFACE" 2>/dev/null
                uci add_list firewall.@zone[$new_zone_index].network="$h_TUNNEL_INTERFACE" 2>/dev/null
            fi
            uci commit
            ifdown ${h_TUNNEL_INTERFACE}; sleep 2; ifup ${h_TUNNEL_INTERFACE}
            logger -t fleth "New ds-lite configuration committed ${h_TUNNEL_INTERFACE}=${r_AFTR}"
        fi
    elif [ "$r_TYPE" = 'map-e' ]; then
        current_peeraddr=$(uci get network.${h_TUNNEL_INTERFACE}.peeraddr 2>/dev/null)
        current_ipaddr=$(uci get network.${h_TUNNEL_INTERFACE}.ipaddr 2>/dev/null)
        current_ip4prefixlen=$(uci get network.${h_TUNNEL_INTERFACE}.ip4prefixlen 2>/dev/null)
        current_ip6prefix=$(uci get network.${h_TUNNEL_INTERFACE}.ip6prefix 2>/dev/null)
        current_ip6prefixlen=$(uci get network.${h_TUNNEL_INTERFACE}.ip6prefixlen 2>/dev/null)
        current_ealen=$(uci get network.${h_TUNNEL_INTERFACE}.ealen 2>/dev/null)
        current_psidlen=$(uci get network.${h_TUNNEL_INTERFACE}.psidlen 2>/dev/null)
        current_offset=$(uci get network.${h_TUNNEL_INTERFACE}.offset 2>/dev/null)
        current_maptype=$(uci get network.${h_TUNNEL_INTERFACE}.maptype 2>/dev/null)
        current_legacymap=$(uci get network.${h_TUNNEL_INTERFACE}.legacymap 2>/dev/null)
        current_psid=$(uci get network.${h_TUNNEL_INTERFACE}.psid 2>/dev/null)
        r_PSID=$(get_mape_psid "$ipv6_address" "$r_PSIDLEN")
        if [ "$current_peeraddr" != "$r_PEERADDR" ] ||
            [ "$current_tunlink" != "$h_UPLINK_INTERFACE" ] ||
            [ "$current_proto" != 'map' ] ||
            [ "$current_mtu" != "$h_TUNNEL_INTERFACE_MTU" ] ||
            [ "$current_maptype" != 'map-e' ] ||
            [ "$current_legacymap" != '1' ] ||
            [ "$current_ipaddr" != "$r_IPADDR" ] ||
            [ "$current_ip4prefixlen" != "$r_IP4PREFIXLEN" ] ||
            [ "$current_ip6prefix" != "$r_IP6PREFIX" ] ||
            [ "$current_ip6prefixlen" != "$r_IP6PREFIXLEN" ] ||
            [ "$current_ealen" != "$r_EALEN" ] ||
            [ "$current_psidlen" != "$r_PSIDLEN" ] ||
            [ "$current_psid" != "$r_PSID" ] ||
            [ "$current_offset" != "$r_OFFSET" ]; then
            uci batch <<EOF
set network.${h_TUNNEL_INTERFACE}=interface
set network.${h_TUNNEL_INTERFACE}.proto='map'
set network.${h_TUNNEL_INTERFACE}.maptype='map-e'
set network.${h_TUNNEL_INTERFACE}.peeraddr='${r_PEERADDR}'
set network.${h_TUNNEL_INTERFACE}.ipaddr='${r_IPADDR}'
set network.${h_TUNNEL_INTERFACE}.ip4prefixlen='${r_IP4PREFIXLEN}'
set network.${h_TUNNEL_INTERFACE}.ip6prefix='${r_IP6PREFIX}'
set network.${h_TUNNEL_INTERFACE}.ip6prefixlen='${r_IP6PREFIXLEN}'
set network.${h_TUNNEL_INTERFACE}.ealen='${r_EALEN}'
set network.${h_TUNNEL_INTERFACE}.psidlen='${r_PSIDLEN}'
set network.${h_TUNNEL_INTERFACE}.psid='${r_PSID}'
set network.${h_TUNNEL_INTERFACE}.offset='${r_OFFSET}'

set network.${h_TUNNEL_INTERFACE}.tunlink='${h_UPLINK_INTERFACE}'
set network.${h_TUNNEL_INTERFACE}.mtu='${h_TUNNEL_INTERFACE_MTU}'
set network.${h_TUNNEL_INTERFACE}.legacymap='1'
set network.${h_TUNNEL_INTERFACE}.encaplimit='ignore'
EOF
            uci delete network.${h_TUNNEL_INTERFACE}.device 2>/dev/null
            if [ "$new_zone_index" != "$current_zone_index" ]; then
                uci del_list firewall.@zone[$current_zone_index].network="$h_TUNNEL_INTERFACE" 2>/dev/null
                uci add_list firewall.@zone[$new_zone_index].network="$h_TUNNEL_INTERFACE" 2>/dev/null
            fi
            uci commit
            ifdown ${h_TUNNEL_INTERFACE}; sleep 2; ifup ${h_TUNNEL_INTERFACE}
            logger -t fleth "New map-e configuration committed ${h_TUNNEL_INTERFACE}=${r_PEERADDR}"
        fi
    elif [ "$new_zone_index" != "$current_zone_index" ]; then
        uci del_list firewall.@zone[$current_zone_index].network="$h_TUNNEL_INTERFACE" 2>/dev/null
        uci add_list firewall.@zone[$new_zone_index].network="$h_TUNNEL_INTERFACE" 2>/dev/null
        uci commit firewall
    fi
    if check_interface_proto_invalid ${h_TUNNEL_INTERFACE}; then
        logger -t fleth "Network Restarting"
        /etc/init.d/network restart
    fi
}

fleth_legacy_auto() {
    if [ "$(pgrep -f "fleth auto" | wc -l)" -ge 3 ]; then
        exit 0
    fi
    logger -t fleth "is running $h_ENABLED"
    if [ "$h_ENABLED" = "1" ]; then
        get_uplink_interface_ipv6 > /dev/null
        get_mape_provider > /dev/null
        if [ "$r_TYPE" = "UNKNOWN" ]; then
            get_area > /dev/null
            get_dslite_provider > /dev/null
        fi
        if [ "$r_TYPE" = "UNKNOWN" ]; then
            logger -t fleth "Can't detect network type ${h_UPLINK_INTERFACE}=${ipv6_address}"
        else
            fleth_legacy_set_interface
            auto_configure_extendprefix
        fi
    fi
}

fleth_legacy_mapsh_status() {
    if [ ! -f "$FLETH_MAPSH_PATH" ]; then
        echo "unavailable"
    elif cmp -s "$MAPSH_PATH" "$FLETH_MAPSH_PATH"; then
        echo "patched"
    elif [ -f "$MAPSH_BACKUP_PATH" ] && cmp -s "$MAPSH_PATH" "$MAPSH_BACKUP_PATH"; then
        echo "original"
    elif [ ! -f "$MAPSH_BACKUP_PATH" ]; then
        echo "original"
    else
        echo "unknown"
    fi
}

fleth_legacy_patch_mapsh() {
    if [ ! -f "$MAPSH_BACKUP_PATH" ]; then
        cp "$MAPSH_PATH" "$MAPSH_BACKUP_PATH"
        if [ $? -ne 0 ]; then
            echo "ERROR: Failed to create backup"
            exit 1
        fi
    fi

    if [ ! -f "$FLETH_MAPSH_PATH" ]; then
        echo "ERROR: fleth map.sh not found"
        exit 1
    fi

    cp "$FLETH_MAPSH_PATH" "$MAPSH_PATH"
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to replace file"
        exit 1
    fi

    chmod +x "$MAPSH_PATH"
    echo "SUCCESS"
}

fleth_legacy_restore_mapsh() {
    logger -t fleth "Starting map.sh restoration"

    if [ ! -f "$MAPSH_BACKUP_PATH" ]; then
        echo "ERROR: Backup not found"
        exit 1
    fi

    mv "$MAPSH_BACKUP_PATH" "$MAPSH_PATH"
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to restore"
        exit 1
    fi

    logger -t fleth "map.sh restored successfully"
    echo "SUCCESS"
}
