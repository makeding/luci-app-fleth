# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

luci-app-fleth is a LuCI-based web interface for OpenWrt that automatically configures IPv4 over IPv6 tunneling in Japan. It supports DS-Lite, MAP-E, and IPIP6H (Independent IP) protocols and automatically detects ISP providers and regional configurations (East/West Japan).

### Key Features

- **Automatic ISP Detection**: Identifies DS-Lite and MAP-E providers via DNS/connectivity tests
- **Regional Configuration**: Auto-detects East/West Japan regions
- **Protocol Support**: DS-Lite, MAP-E, IPIP6H (Independent IP tunnel)
- **IPv6 Mode Auto-Configuration**: Detects /56 (PD) or /64 (SLAAC) and configures accordingly
- **Prefix Alignment Checking**: Validates IPv6 prefix alignment for MAP-E/IPIP6 tunnels
- **Port Highlighting**: Visual highlighting of "special" ports (palindromes, repeating digits, etc.)
- **map.sh Patching**: Fixes OpenWrt MAP-E bugs (only first port group working, broken ICMP)
- **Pending State Detection**: Recognizes newly constructed fiber connections awaiting ISP setup
- **SHA256 Verification**: Security checks for downloaded patches
- **Port Forward Hook**: Integration with LuCI firewall port forwarding page

## Build Commands

### OpenWrt Package Build
```bash
# Build within OpenWrt build environment
git clone https://github.com/makeding/luci-app-fleth package/huggy/luci-app-fleth
make package/huggy/luci-app-fleth/compile
```

### Internationalization
```bash
# Compile translation files (Japanese, Simplified Chinese, Traditional Chinese)
po2lmo po/ja/fleth.po root/usr/lib/lua/luci/i18n/fleth.ja.lmo
po2lmo po/zh_Hans/fleth.po root/usr/lib/lua/luci/i18n/fleth.zh_Hans.lmo
po2lmo po/zh_Hant/fleth.po root/usr/lib/lua/luci/i18n/fleth.zh_Hant.lmo
```

## Architecture

### Core Components

1. **Frontend (LuCI Interface)**
   - `htdocs/luci-static/resources/view/fleth.js` (501 lines)
     - Main web interface with 3 tabs: Information, General Settings, Tools
     - Real-time status display (Area, Prefix Length, DS-Lite/MAP-E provider)
     - Port highlighting with caching (`_portHighlightCache`)
     - IPv6 mode configuration buttons (SLAAC/PD)
     - map.sh patch management UI
   - `htdocs/luci-static/resources/view/fleth-hook.js`
     - Injects port availability info into LuCI's port forwarding page
     - Shows available MAP-E port ranges when configuring firewall rules

2. **Backend Shell Script**
   - `root/usr/sbin/fleth` (694 lines) - Main configuration engine
     - **Area Detection** (`get_area`, line 51-75): Uses DNS resolution and IPv6 connectivity tests
     - **DS-Lite Provider Detection** (`get_dslite_provider`, line 325-353):
       - transix: Only resolvable from within ISP network
       - xpass: Resolvable but only pingable from within network
       - v6connect: Only resolvable from within ISP network
     - **MAP-E Provider Detection** (`get_mape_provider`, line 297-322): Calls Lua calculation engine
     - **Pending State Detection** (`get_pending_status`, line 77-95): Checks IPv6 prefix ranges
     - **UCI Configuration** (`set_interface`, line 355-446): Writes tunnel settings
     - **IPv6 Mode Setup** (`setup_ipv6_slaac`, `setup_ipv6_pd`, line 507-599):
       - SLAAC (/64): For 1Gbps plans without Hikari Denwa
       - PD (/56): For 10Gbps plans or with Hikari Denwa
     - **Prefix Alignment Check** (`check_prefix_alignment`, line 181-231): Validates 4th hextet ends with '00'
     - **map.sh Patching** (`patch_map.sh`, `restore_map.sh`, line 600-656): Downloads and verifies fixed version
     - **Concurrent Execution Control** (line 449-451): Simple process counting (TODO: use flock)

3. **MAP-E Calculation Engine**
   - `root/usr/sbin/fleth-map-e.lua` (984 lines)
     - Implements bitwise operations (band, bor, lshift, rshift) for Lua 5.1
     - Contains MAP-E rule tables for JPNE, BIGLOBE, OCN, NURO providers
     - Calculates: peeraddr, ipaddr, prefix, PSID, offset, available ports
     - Three rule sets: `ruleprefix31`, `ruleprefix38`, `ruleprefix38_20`
     - NOTE: Duplicate `band` function definitions (line 4 and 17) - can be cleaned up

4. **IPIP6H Protocol Handler**
   - `root/lib/netifd/proto/ipip6h.sh` (196 lines)
     - Custom netifd protocol for Independent IP tunnels
     - DNS resolution of peer address with retry
     - IPv6 prefix delegation support with interface_id
     - Prefix alignment validation (calls `fleth check_alignment`)
     - Dynamic interface creation for static IPv6 addressing
     - Comprehensive logging for troubleshooting

5. **System Integration**
   - `root/etc/init.d/fleth` (17 lines)
     - System service daemon (START=99)
     - Runs `fleth auto` on start/reload
   - `root/etc/hotplug.d/iface/70-fleth` (73 lines)
     - Triggers `fleth auto` when uplink interface comes up
     - Tunnel activation via delayed ping (30s) for map/dslite/ipip6/ipip6h protocols
     - Process management with PID files to prevent duplicate activations
   - `root/etc/uci-defaults/luci-app-fleth`
     - Sets default configuration on first install

### Configuration Management

Uses OpenWrt's UCI (Unified Configuration Interface):

```bash
# Main configuration section: fleth.global
uci get fleth.global.enabled         # Auto-configuration enable/disable
uci get fleth.global.interface       # Tunnel interface name (default: wan)
uci get fleth.global.interface6      # IPv6 uplink interface (default: wan6)
uci get fleth.global.mtu             # Tunnel MTU (default: 1460)
uci get fleth.global.interface_zone  # Firewall zone (default: wan)
```

Configuration flow:
1. User enables auto-configuration via LuCI
2. Hotplug script triggers on interface up
3. `fleth auto` detects ISP and configures tunnel
4. UCI settings are applied to network/firewall
5. Interface restart applies changes

### ISP Support Matrix

**DS-Lite Providers:**
- `gw.transix.jp` - BB.excite, enひかり, IIJひかり, ZOOT NATIVE
- `dgw.xpass.jp` - BB.exciteコネクト, 楽天ひかり, GameWith光, Tigers-net
- `dslite.v6connect.net` - ASAHIネット光

**MAP-E Providers:**
- `BIGLOBE` - BIGLOBE, おてがる光, BB.excite 10Gbps
- `JPNE（v6プラス）` - DMM光, GMOとくとくBB, enひかり, So-net, 21ip.jp
- `OCN` - OCN (R.I.P.)
- `NURO` - NURO

**IPIP6H (Independent IP):**
- `JPNE（v6プラス）` - enひかり with independent IPv4

### Technical Implementation Details

**Area Detection Algorithm** (`root/usr/sbin/fleth:51-75`):
1. Check DNS servers in `/tmp/resolv.conf.d/resolv.conf.auto` for `flets-east.jp` or `flets-west.jp`
2. Fallback: Test connectivity to East IPv6 address `2404:1a8:f401:100::1`
3. Fallback: Test connectivity to West IPv6 address `2001:a7ff:ff0e:1::2`

**Pending Service Detection** (`root/usr/sbin/fleth:77-95`):
- East ranges: `2001:c90::/32`, `2404:1a8::/32`, `2408::/22`
- West ranges: `2001:d70::/30`, `2001:a000::/21`
- These indicate fiber construction complete but ISP setup pending

**MAP-E Port Calculation** (`root/usr/sbin/fleth-map-e.lua:930-938`):
- Calculates available port ranges based on PSID, offset, and prefix length
- Formula: `port = (A << (16-offset)) | (psid << (16-offset-psidlen))`
- Returns space-separated list of all available ports

**Port Highlighting Logic** (`htdocs/luci-static/resources/view/fleth.js:26-50`):
- Detects "special" ports: consecutive repeats, ends with 0, ABAB pattern, palindromes
- Uses cache to avoid re-computation
- Applied to MAP-E available ports display

**SHA256 Verification** (`root/usr/sbin/fleth:129-147`):
- Validates downloaded map.sh patch before installation
- Expected hash: `d64b8018f9eda6dfb84089f7b2fb168c7e7c04ece0c33315422120cdcebdd0b4`
- Fallback: Continues without verification if `sha256sum` unavailable

**Prefix Alignment Check** (`root/usr/sbin/fleth:181-231`):
- Required for subdivided prefixes (/60, /62, etc.)
- Checks if 4th hextet's last 2 hex digits are '00'
- Skips check for /56 (ISP-assigned) and /64 (SLAAC)

## CLI Command Reference

The `fleth` command provides these operations:

### Tunnel Configuration
- `fleth auto` - Main auto-configuration routine (checks ISP, configures tunnel)

### Status and Detection
- `fleth get_area` - Show detected region (EAST/WEST/UNKNOWN)
- `fleth get_dslite_provider` - Show DS-Lite provider domain
- `fleth mape_status` - Show MAP-E provider and all parameters (multi-line output)
- `fleth pending_status` - Check if service is in pending state
- `fleth get_prefix_length` - Show detected IPv6 prefix length (/56, /64, or UNKNOWN)
- `fleth check_alignment [ipv6]` - Check prefix alignment (ALIGNED/NOT_ALIGNED:hextet/SKIPPED:/XX)
- `fleth mapsh_status` - Check if map.sh is patched or original

### IPv6 Configuration
- `fleth auto_setup_ipv6` - Auto-detect prefix and configure PD or SLAAC mode
- `fleth setup_ipv6_slaac` - Configure IPv6 SLAAC for /64 prefixes (1Gbps plans)
- `fleth setup_ipv6_pd` - Configure IPv6 PD for /56 prefixes (10Gbps plans)

### File Patches
- `fleth patch_map.sh` - Download and install fixed map.sh (creates backup)
- `fleth restore_map.sh` - Restore original map.sh from backup
- `fleth hook_none.js` - Install fleth hook in none.js (for port forward integration)
- `fleth restore_none.js` - Restore none.js to default state

### Examples
```bash
# Check current configuration
fleth get_area                    # Output: EAST
fleth get_prefix_length          # Output: /56
fleth mape_status                # Multi-line output with all MAP-E params

# Apply configuration
fleth auto                       # Detect and configure

# IPv6 mode setup
fleth auto_setup_ipv6           # Auto-detect and configure
fleth setup_ipv6_pd             # Manual PD configuration

# Patch management
fleth mapsh_status              # Check status
fleth patch_map.sh              # Apply patch
```

## Code Organization

```
luci-app-fleth/
├── htdocs/luci-static/resources/view/
│   ├── fleth.js                 # Main LuCI interface (501 lines)
│   └── fleth-hook.js            # Port forward integration
├── po/                          # Translations
│   ├── ja/fleth.po              # Japanese (214 lines)
│   ├── zh_Hans/fleth.po         # Simplified Chinese (214 lines)
│   └── zh_Hant/fleth.po         # Traditional Chinese (214 lines)
├── root/
│   ├── etc/
│   │   ├── config/fleth         # UCI config defaults
│   │   ├── init.d/fleth         # System service (17 lines)
│   │   ├── hotplug.d/iface/70-fleth  # Interface hotplug handler (73 lines)
│   │   └── uci-defaults/luci-app-fleth
│   ├── lib/netifd/proto/
│   │   └── ipip6h.sh            # IPIP6H protocol handler (196 lines)
│   └── usr/sbin/
│       ├── fleth                # Main shell script (694 lines)
│       └── fleth-map-e.lua      # MAP-E calculation engine (984 lines)
├── logo/                        # SVG logos
├── screenshots/                 # Documentation screenshots
├── Makefile                     # OpenWrt package build
├── LICENSE                      # MIT + GPL2 (if ipip6h included)
├── README.md                    # Japanese documentation
├── readme-en.md                 # English documentation
├── readme-zhs.md                # Simplified Chinese documentation
└── CLAUDE.md                    # This file
```

## Known Optimization Opportunities

### High Priority
1. **Concurrent Execution Control** (`root/usr/sbin/fleth:449-451`)
   - Current: Simple process counting with `pgrep`
   - Recommendation: Use `flock` for reliable mutex locking
   ```bash
   exec 200>/var/lock/fleth.lock
   flock -n 200 || exit 0
   ```

2. **Error Handling Enhancement**
   - Add retry mechanisms for DNS resolution and network tests
   - Implement rollback on configuration failures
   - Add timeout controls for all network operations

3. **Input Validation**
   - Validate all user inputs (IP addresses, domains, MTU values)
   - Prevent command injection vulnerabilities
   - Add UCI configuration schema validation

### Medium Priority
4. **Code Modularization** (`root/usr/sbin/fleth`)
   - Extract network detection to `/usr/lib/fleth/network.sh`
   - Extract ISP detection to `/usr/lib/fleth/isp.sh`
   - Extract configuration management to `/usr/lib/fleth/config.sh`

5. **Performance Optimization**
   - Batch UCI operations to reduce calls
   - Cache ISP detection results
   - Cache DNS resolution results

6. **Lua Code Cleanup** (`root/usr/sbin/fleth-map-e.lua`)
   - Remove duplicate `band` function (line 4 and 17)
   - Add more comments explaining MAP-E calculation logic
   - Consider adding unit tests

7. **Variable Naming Consistency** (`root/usr/sbin/fleth`)
   - Current prefixes: `r_*` (real/detected), `h_*` (config), `e_*` (area), `t_*` (temp)
   - Recommendation: Use semantic names (`detected_*`, `cfg_*`, `area_*`, `temp_*`)

### Low Priority
8. **Frontend Enhancements**
   - Add configuration wizard for first-time users
   - Add real-time connection monitoring
   - Add connection speed test functionality

9. **Diagnostics Tool**
   - Add `fleth diagnose` command for automated troubleshooting
   - Generate diagnostic reports (network status, config, logs)

10. **Testing Infrastructure**
    - Add shell script unit tests (using shunit2 or bats)
    - Add Lua unit tests (using busted)
    - Add integration tests

## Development Guidelines

### Coding Conventions

**Shell Scripts:**
- Use POSIX-compatible syntax (tested on BusyBox ash)
- Prefix global variables with descriptive names
- Use `logger -t fleth` for all logging
- Always check command exit codes for critical operations
- Use UCI batch operations when modifying multiple settings

**Lua Scripts:**
- Compatible with Lua 5.1 (OpenWrt default)
- Avoid external dependencies
- Use local functions where possible
- Return structured data for shell script consumption

**JavaScript (LuCI):**
- Follow LuCI framework patterns
- Use ES5 syntax (no arrow functions, const, let)
- Handle all Promise rejections
- Provide user-friendly error messages

### Internationalization (i18n) Workflow

**CRITICAL: All UI strings must be translated into all supported languages.**

This project supports three languages:
- Japanese (ja) - `po/ja/fleth.po`
- Simplified Chinese (zh_Hans) - `po/zh_Hans/fleth.po`
- Traditional Chinese (zh_Hant) - `po/zh_Hant/fleth.po`

**When adding or modifying UI features:**

1. **Wrap all user-facing strings with `_()`:**
   ```javascript
   // ✓ Correct
   o.title = _("Area Detection");
   ui.addNotification(_('Configuration Error'), ...);

   // ✗ Wrong
   o.title = "Area Detection";
   ui.addNotification('Configuration Error', ...);
   ```

2. **Update ALL translation files (not just one):**
   ```bash
   # Extract msgid from your code and find it in all .po files
   grep -r "Area Detection" po/*/fleth.po

   # You must add translations to:
   po/ja/fleth.po         # Japanese translation
   po/zh_Hans/fleth.po    # Simplified Chinese translation
   po/zh_Hant/fleth.po    # Traditional Chinese translation
   ```

3. **Translation file format (.po):**
   ```po
   msgid "Area Detection"
   msgstr "エリア検出"  # Japanese

   msgid "Area Detection"
   msgstr "区域检测"     # Simplified Chinese

   msgid "Area Detection"
   msgstr "區域檢測"     # Traditional Chinese
   ```

4. **Compile translations after editing:**
   ```bash
   po2lmo po/ja/fleth.po root/usr/lib/lua/luci/i18n/fleth.ja.lmo
   po2lmo po/zh_Hans/fleth.po root/usr/lib/lua/luci/i18n/fleth.zh_Hans.lmo
   po2lmo po/zh_Hant/fleth.po root/usr/lib/lua/luci/i18n/fleth.zh_Hant.lmo
   ```

5. **Test in all languages:**
   - LuCI → System → System → Language
   - Switch between Japanese, 简体中文, 繁體中文
   - Verify all new strings appear translated

**Common mistakes to avoid:**
- ✗ Adding strings only to English/Japanese
- ✗ Forgetting to wrap strings with `_()`
- ✗ Using string concatenation instead of format strings
- ✗ Not compiling .po to .lmo files
- ✗ Hardcoding language-specific content

**Translation checklist:**
- [ ] All UI strings wrapped with `_()`
- [ ] msgid added to all 3 .po files
- [ ] Translations provided (or marked with FIXME if unsure)
- [ ] .po files compiled to .lmo
- [ ] Tested in all 3 languages
- [ ] No untranslated strings appear in UI

**If you're unsure about a translation:**
```po
# FIXME: Need native speaker review
msgid "Prefix Alignment Warning"
msgstr "前缀对齐警告"  # Mark uncertain translations
```

### Security Considerations

1. **Input Validation**: Always validate inputs from UCI, user interface, and network
2. **Command Injection**: Use UCI API instead of shell evaluation where possible
3. **File Downloads**: Verify SHA256 checksums before installing patches
4. **Privilege Separation**: Minimize operations requiring root privileges

### Testing Approach

**Manual Testing Checklist:**
- [ ] Test on both East and West Japan ISPs
- [ ] Verify DS-Lite and MAP-E detection
- [ ] Test IPv6 SLAAC and PD configurations
- [ ] Verify prefix alignment checking
- [ ] Test map.sh patch and restore
- [ ] Check port highlighting display
- [ ] Verify pending state detection
- [ ] **Test all 3 languages (ja, zh_Hans, zh_Hant) - verify no untranslated strings**
- [ ] **Verify all new UI strings appear in all .po files**

**Edge Cases to Test:**
- Subdivided prefixes (/60, /62) with misalignment
- Interface coming up before IPv6 address assignment
- DNS resolution failures
- Concurrent `fleth auto` executions
- map.sh patch download failures

## Troubleshooting and Debugging

### Common Issues

**Issue: Tunnel not activating**
```bash
# Check if fleth is enabled
uci get fleth.global.enabled

# Check interface status
ifstatus wan6
ifstatus wan

# Check logs
logread | grep fleth
logread | grep ipip6h

# Manual detection test
fleth get_area
fleth mape_status
fleth get_dslite_provider
```

**Issue: MAP-E ports not working**
```bash
# Check if map.sh is patched
fleth mapsh_status

# Apply patch if needed
fleth patch_map.sh

# Restart tunnel interface
ifdown wan; ifup wan
```

**Issue: IPv6 prefix alignment error**
```bash
# Check current prefix
fleth get_prefix_length

# Check alignment
fleth check_alignment

# If using subdivided prefix, check upstream router settings
# The 4th hextet must end with '00' for MAP-E/IPIP6
```

### Log Analysis

```bash
# View fleth-related logs
logread | grep -E 'fleth|ipip6h'

# Monitor in real-time
logread -f | grep -E 'fleth|ipip6h'

# Check hotplug events
logread | grep fleth-hotplug

# Check network status
ubus call network.interface.wan status
ubus call network.interface.wan6 status
```

### Diagnostic Commands

```bash
# Full status check
echo "=== Area ===" && fleth get_area
echo "=== Prefix ===" && fleth get_prefix_length
echo "=== Alignment ===" && fleth check_alignment
echo "=== Pending ===" && fleth pending_status
echo "=== DS-Lite ===" && fleth get_dslite_provider
echo "=== MAP-E ===" && fleth mape_status

# Network connectivity
ping6 -c 3 2404:1a8:7f01:a::3  # East DNS
ping6 -c 3 2001:a7ff:5f01::a   # West DNS

# UCI configuration dump
uci show fleth
uci show network | grep -E 'wan|interface'
uci show firewall | grep zone
```

## Important Notes for AI Assistants

1. **🚨 CRITICAL - Internationalization is MANDATORY**: When adding ANY UI feature, you MUST update ALL 3 translation files (ja, zh_Hans, zh_Hant) simultaneously. Never add UI strings without translations. See "Internationalization (i18n) Workflow" section for detailed instructions.

2. **Never modify production ISP detection logic** without thorough testing - incorrect detection can break connectivity

3. **Preserve backward compatibility** - many users rely on existing UCI configuration structure

4. **Test on actual hardware** - OpenWrt behavior can differ from development environment

5. **Respect OpenWrt conventions** - follow UCI patterns, init script standards, netifd protocol guidelines

6. **Consider resource constraints** - OpenWrt routers have limited CPU/memory, optimize for efficiency

7. **SHA256 checksums** - always update when modifying downloaded patches

8. **Logging discipline** - use appropriate log levels, avoid log spam

## References

- [IPv4 over IPv6 in Japan](https://qiita.com/site_u/items/b6d5097f5e3a0f91c95d)
- [MAP-E Web Calculator](https://ipv4.web.fc2.com/map-e.html)
- [OpenWrt MAP-E Fix](https://github.com/fakemanhk/openwrt-jp-ipoe)
- [OpenWrt Netifd Documentation](https://openwrt.org/docs/techref/netifd)
- [LuCI Development Guide](https://github.com/openwrt/luci/wiki)
