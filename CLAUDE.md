# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

luci-app-fleth is a LuCI-based web interface for OpenWrt that automatically configures IPv4 over IPv6 tunneling in Japan. It supports DS-Lite and MAP-E protocols and automatically detects ISP providers and regional configurations (East/West Japan).

## Build Commands

### OpenWrt Package Build
```bash
# Build within OpenWrt build environment
git clone https://github.com/makeding/luci-app-fleth package/huggy/luci-app-fleth
make package/huggy/luci-app-fleth/compile
```

### Internationalization
```bash
# Compile Japanese translation files
po2lmo po/ja/fleth.po root/usr/lib/lua/luci/i18n/fleth.ja.lmo
```

## Architecture

### Core Components

1. **Frontend (LuCI Interface)**
   - `htdocs/luci-static/resources/view/fleth.js` - Main web interface logic
   - `htdocs/luci-static/resources/view/fleth-hook.js` - Port forward integration
   - Uses LuCI framework patterns with tabs for Information and General Settings

2. **Backend Shell Script**
   - `root/usr/sbin/fleth` - Main configuration engine that handles:
     - Area detection (East/West Japan) via DNS resolution and connectivity tests
     - DS-Lite provider detection (transix, xpass, v6connect)
     - MAP-E provider detection via Lua calculations
     - Network interface configuration using UCI
     - IPv6 SLAAC/PD setup for different service plans

3. **MAP-E Calculation Engine**
   - `root/usr/sbin/fleth-map-e.lua` - Lua script for MAP-E parameter calculation
   - Implements bitwise operations and IPv6 prefix calculations

4. **System Integration**
   - `root/etc/init.d/fleth` - System service daemon
   - `root/etc/hotplug.d/iface/70-fleth` - Interface hotplug handler (triggers on interface up)
   - `root/etc/uci-defaults/luci-app-fleth` - Default configuration setup

### Configuration Management

- Uses OpenWrt's UCI (Unified Configuration Interface) system
- Main config section: `fleth.global` with settings for tunnel interfaces, MTU, zones
- Integrates with network and firewall configurations
- Real-time status detection and pending service state handling

### ISP Support Matrix

**DS-Lite Providers:**
- gw.transix.jp (BB.excite, enひかり, IIJひかり, etc.)
- dgw.xpass.jp (BB.exciteコネクト, 楽天ひかり, GameWith光, etc.)  
- dslite.v6connect.net (ASAHIネット光)

**MAP-E Providers:**
- BIGLOBE, JPNE (v6プラス), OCN, NURO

### Key Technical Details

- Automatic area detection using DNS servers and connectivity tests to specific IPv6 addresses
- Pending service state detection for newly constructed fiber connections
- Dynamic interface configuration with automatic restart when parameters change
- IPv6 prefix delegation support for enterprise/multi-subnet scenarios
- MTU optimization (recommends 1460 for tunnels)
- Integration with OpenWrt firewall zones and port forwarding

## Common Operations

The fleth command supports these operations:
- `fleth auto` - Main configuration routine
- `fleth get_area` - Show detected region
- `fleth mape_status` - Show MAP-E parameters
- `fleth get_dslite_provider` - Show DS-Lite provider
- `fleth setup_ipv6_slaac` - Configure for NEXT(1Gbps) plans
- `fleth setup_ipv6_pd` - Configure for CROSS(10Gbps) plans