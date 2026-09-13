#!/usr/bin/env python3
"""Bounded mock lifecycle tests; these do not certify Linux/netifd packet handling.
Owned scratch: /tmp/luci-flethp-tests, <=1 MiB, removed in finally.
"""
import os
from pathlib import Path
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
SCRATCH = Path('/tmp/luci-flethp-tests')
LIB = ROOT / 'root/usr/share/fleth'


def shell(code):
    result = subprocess.run(['sh', '-c', code], cwd=ROOT, text=True, capture_output=True)
    if result.returncode:
        raise AssertionError(f'sh exit={result.returncode}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}\nCommand: sh -c (generated fixture in tests/test_flethp.py)')
    return result.stdout


class FlethpTests(unittest.TestCase):
    def test_library_placement_and_shared_regression(self):
        for p in (ROOT / 'root/lib/netifd/proto').glob('*.sh'):
            self.assertIn('add_protocol ' + p.stem, p.read_text())
        old = subprocess.check_output(['git', 'show', 'HEAD:root/lib/netifd/proto/fleth.sh'], text=True)
        old = old[old.index('fleth_filter_global_ipv6()'):old.index('fleth_iptables_chain()')]
        new = (LIB / 'ipoe-common.sh').read_text()
        self.assertIn(old.rstrip(), new)  # extraction preserves the deployed detection behavior
        old_tunnel = subprocess.check_output(['git', 'show', 'HEAD:root/usr/share/fleth/ipip6h-common.sh'], text=True)
        old_tunnel = old_tunnel[old_tunnel.index('fleth_ipip6_add_tunnel()'):old_tunnel.index('fleth_ipip6_schedule_activation()')]
        self.assertIn(old_tunnel.rstrip(), (LIB / 'common.sh').read_text())
        for p in [*LIB.glob('*.sh'), *ROOT.glob('root/lib/netifd/proto/*.sh')]:
            subprocess.run(['sh', '-n', str(p)], check=True)

    def test_addresses(self):
        for mode, client, prefix, gateway, expected in [
            ('map-e', '203.0.113.8', '', '', '31 203.0.113.9'),
            ('map-e', '203.0.113.9', '', '', '31 203.0.113.8'),
            ('dslite', '192.0.0.2', '', '', '29 192.0.0.1'),
            ('map-e', '203.0.113.8', '24', '203.0.113.1', '24 203.0.113.1'),
        ]:
            out = shell(f'. {LIB}/flethp-common.sh; mode={mode}; client={client}; prefix="{prefix}"; gateway="{gateway}"; flethp_address_plan || exit 1; echo "$prefix $gateway"')
            self.assertEqual(out.strip(), expected)
        for address in ['300.1.1.1', '1.2.3', '127.0.0.1', '224.0.0.1', '01.2.3.4', '1.2.3.4;id']:
            shell(f'. {LIB}/flethp-common.sh; ! flethp_ipv4_number "{address}"')
        for prefix, gateway in [('32', '203.0.113.9'), ('31', '203.0.113.8'), ('31', '203.0.114.9'), ('24', '203.0.113.0')]:
            shell(f'. {LIB}/flethp-common.sh; mode=map-e; client=203.0.113.8; prefix={prefix}; gateway={gateway}; ! flethp_address_plan')

    def test_port_sets_and_detection(self):
        out = shell(f'. {LIB}/ipoe-common.sh; fleth_map_portsets_from_psid 3 8 4')
        ranges = [tuple(map(int, r.split('-'))) for r in out.split()]
        self.assertEqual(len(ranges), 15)
        self.assertEqual(ranges[0], (4144, 4159))
        self.assertEqual(ranges[-1], (61488, 61503))
        self.assertEqual(out, shell(f'. {LIB}/ipoe-common.sh; fleth_map_portsets_from_psid 768 8 4'))
        # Real parser with the Lua process boundary stubbed; no provider algorithm changes.
        fixture = '\n'.join(['JPNE','203.0.113.8','2001:db8::1','203.0.113.0','24','2001:db8::','32','16','8','4','unused','2001:db8::2'])
        out = shell(f'''. {LIB}/ipoe-common.sh
lua() {{ printf '%s\\n' '{fixture}'; }}
fleth_detect_mape 240b:0010:0010:0300::1 || exit 1
printf '%s\\n' "$FLETH_TYPE $FLETH_IPV4ADDR $FLETH_PSID $FLETH_LOCAL_IPV6"
fleth_set_dslite_provider 2001:db8::3 || exit 1
printf '%s\\n' "$FLETH_TYPE $FLETH_AFTR"
''')
        self.assertEqual(out.splitlines(), ['map-e 203.0.113.8 768 2001:db8::2', 'dslite 2001:db8::3'])

    def test_preview_is_read_only(self):
        out = shell(f""". {LIB}/ipoe-common.sh
. {LIB}/flethp-common.sh
ip() {{ exit 97; }}
nft() {{ exit 98; }}
uci() {{ exit 99; }}
fleth_get_uplink_ipv6() {{ echo 2001:db8::2; }}
network_get_ipaddr6() {{ local6=2001:db8::2; }}
fleth_detect_mape() {{ return 1; }}
fleth_get_dslite_provider() {{ FLETH_TYPE=dslite; FLETH_AFTR=2001:db8::1; }}
tunlink=unsaved; aftr=''; prefix=''; gateway=''
flethp_detect_plan || exit 1
printf '%s\\n' "$mode $client $prefix $gateway"
aftr=2001:db8::9; prefix=29; gateway=192.0.0.3
flethp_detect_plan || exit 1
printf '%s\\n' "$mode $client $prefix $gateway $peer"
""")
        self.assertEqual(out.splitlines(), ['dslite 192.0.0.2 29 192.0.0.1', 'dslite 192.0.0.2 29 192.0.0.3 2001:db8::9'])

    def test_nft_isolation(self):
        for mode in ['map-e', 'dslite']:
            out = shell(f'''. {LIB}/flethp-common.sh
nft() {{ case "$*" in '-f -') cat;; *) return 1;; esac; }}
flethp_fw4() {{ :; }}
cfg=test; device=eth1; link=flethp-test; client=203.0.113.8; mode={mode}; ports='4144-4159 8240-8255'
flethp_nft
''')
            self.assertIn('iifname "eth1" oifname != "flethp-test" drop', out)
            self.assertIn('output oifname "flethp-test" drop', out)
            if mode == 'map-e':
                self.assertIn('ct state established,related accept', out)
                self.assertIn('icmp id @ports', out)
                self.assertIn('snat to 203.0.113.8 : tcp sport', out)
                self.assertIn('snat to 203.0.113.8 : 8240-8255', out)
                self.assertIn('numgen inc mod 2 vmap', out)
            else:
                self.assertNotIn('snat to', out)

    def test_package_combinations(self):
        # Evaluate the actual Build/Compile make conditional body without an SDK.
        source = (ROOT / 'Makefile').read_text()
        body = source.split('define Build/Compile\n', 1)[1].split('\nendef', 1)[0]
        for hp in ['y', 'n']:
            for fp in ['y', 'n']:
                text = f'PKG_NAME:=luci-proto-fleth\nPKG_BUILD_DIR:=/package\nCONFIG_PACKAGE_luci-proto-fleth_INCLUDE_IPIP6HP:={hp}\nCONFIG_PACKAGE_luci-proto-fleth_INCLUDE_FLETHP:={fp}\nall:\n' + body + '\n'
                result = subprocess.run(['make', '-n', '-f', '-'], input=text, text=True, capture_output=True, check=True).stdout
                self.assertEqual('/root/lib/netifd/proto/flethp.sh' in result, fp == 'n')
                self.assertEqual('/root/lib/netifd/proto/ipip6hp.sh' in result, hp == 'n')
                self.assertEqual('/flethp-firewall.include' in result, fp == 'n')
                self.assertNotIn('/ipoe-common.sh', result)

    def test_firewall_ownership_cleanup(self):
        SCRATCH.mkdir(mode=0o700, exist_ok=True)
        state = SCRATCH / 'ownership.state'
        state.write_text("cfg='test'\nfw4_chain_added=0\n")
        out = shell(f""". {LIB}/flethp-common.sh
state='{state}'
nft() {{ echo "unexpected nft $*"; return 0; }}
flethp_cleanup
""")
        self.assertEqual(out, '', 'rollback cannot touch a chain not recorded as owned')
        state.write_text("cfg='test'\nfw4_chain_added=1\n")
        out = shell(f""". {LIB}/flethp-common.sh
state='{state}'
nft() {{
 case "$*" in
  '-a list chain inet fw4 forward') echo 'jump fp_test comment "flethp:test" # handle 7';;
  'delete rule inet fw4 forward handle 7') return 1;;
  *) echo "unexpected mutation $*";;
 esac
}}
! flethp_cleanup || exit 1
[ -f "$state" ]
""")
        self.assertEqual(out, '', 'failed jump removal must retain ownership for retry')

    def test_lifecycle(self):
        # Script-only paths are redirected to bounded fake sysctl/state files.
        backend = (ROOT / 'root/lib/netifd/proto/flethp.sh').read_text()
        common = (LIB / 'flethp-common.sh').read_text()
        for mode, fail in [('map-e',''), ('dslite',''), ('explicit',''), ('map-e','-4 rule add'), ('map-e','-4 route add default')]:
            if SCRATCH.exists(): shutil.rmtree(SCRATCH)
            SCRATCH.mkdir(mode=0o700)
            for dev in ['eth1','flethp-test']:
                d = SCRATCH / 'proc' / dev
                d.mkdir(parents=True)
                for key in ['forwarding','proxy_arp','proxy_arp_pvlan','rp_filter']: (d/key).write_text('0\n')
            prefix = f'''INCLUDE_ONLY=1
. {LIB}/ipoe-common.sh
. {LIB}/common.sh
'''
            script = prefix + common + '\n' + backend
            script = script.replace('/var/run/flethp', str(SCRATCH/'state')).replace('/proc/sys/net/ipv4/conf', str(SCRATCH/'proc'))
            script += f'''
log={SCRATCH}/log
json_get_vars() {{ tunlink=wan6; mtu=1460; [ '{mode}' != explicit ] || aftr=2001:db8::3; }}
config_load() {{ :; }}
config_foreach() {{ :; }}
network_get_device() {{ uplink=eth0; }}
network_get_ipaddr6() {{ local6=2001:db8::2; }}
fleth_get_uplink_ipv6() {{ echo 2001:db8::2; }}
fleth_local_ipv6_exists() {{ return 0; }}
fleth_detect_mape() {{ echo detect_mape >> "$log"; [ '{mode}' = map-e ] || return 1; FLETH_TYPE=map-e; FLETH_IPV4ADDR=203.0.113.8; FLETH_PEERADDR=2001:db8::1; FLETH_LOCAL_IPV6=2001:db8::2; FLETH_PSIDLEN=8; FLETH_OFFSET=4; FLETH_PSID=768; }}
fleth_get_dslite_provider() {{ FLETH_TYPE=dslite; FLETH_AFTR=2001:db8::3; }}
logger() {{ echo "logger $*" >> "$log"; }}
conntrack() {{ echo "conntrack $*" >> "$log"; }}
flock() {{ :; }}
proto_add_host_dependency() {{ :; }}
proto_init_update() {{ echo "proto_init_update $*" >> "$log"; }}
proto_add_data() {{ :; }}
proto_close_data() {{ :; }}
proto_send_update() {{ :; }}
proto_block_restart() {{ :; }}
proto_notify_error() {{ echo "error $*" >> "$log"; }}
json_add_string() {{ echo "$*" >> "$log"; }}
json_add_int() {{ echo "$*" >> "$log"; }}
json_add_boolean() {{ echo "$*" >> "$log"; }}
nft() {{
 echo "nft $*" >> "$log"
 case "$*" in
  '-f -') cat >> "$log"; touch {SCRATCH}/nft; return 0;;
  'list chain inet fw4 forward') return 0;;
  'list table ip fp_test') [ -f {SCRATCH}/nft ]; return $?;;
  'delete table ip fp_test') rm -f {SCRATCH}/nft; return 0;;
  *) return 1;;
 esac
}}
ip() {{
 echo "ip $*" >> "$log"
 case "$*" in *'{fail or 'NEVER_FAIL'}'*) return 9;; esac
 case "$*" in
  'link show dev flethp-test') [ -f {SCRATCH}/tunnel ]; return $?;;
  '-6 tunnel add '*) touch {SCRATCH}/tunnel;;
  'link del flethp-test') rm -f {SCRATCH}/tunnel;;
  '-4 rule add '*) touch {SCRATCH}/rule;;
  '-N -4 rule show') [ ! -f {SCRATCH}/rule ] || echo '11000: from 203.0.113.8 iif eth1 lookup 110';;
  '-4 rule del '*) rm -f {SCRATCH}/rule;;
  '-4 route add default '*) touch {SCRATCH}/default;;
  '-4 route show table 110 default') [ ! -f {SCRATCH}/default ] || echo 'default dev flethp-test';;
  '-4 route del default '*) rm -f {SCRATCH}/default;;
  '-4 route show table main exact '*) echo 'owned route';;
  '-4 neigh show proxy dev eth1') [ ! -f {SCRATCH}/proxy ] || cat {SCRATCH}/proxy;;
  '-4 neigh add proxy '*) echo "$5 proxy" > {SCRATCH}/proxy;;
  '-4 neigh del proxy '*) rm -f {SCRATCH}/proxy;;
 esac
 return 0
}}
proto_flethp_setup test eth1
result=$?
echo "result=$result" >> "$log"
[ "$result" = 0 ] || [ ! -f {SCRATCH}/state/test.state ] || exit 77
if [ "$result" = 0 ]; then
    proto_flethp_setup test eth1 || {{ cat "$log"; exit 78; }}
fi
# New UCI values must not alter the saved cleanup selectors.
client=198.51.100.2; device=eth9; table=200
proto_flethp_teardown test
proto_flethp_teardown test
cat "$log"
[ ! -f {SCRATCH}/state/test.state ]
'''
            out = shell(script)
            self.assertIn('result=' + ('1' if fail else '0'), out)
            self.assertNotIn('ip -4 rule del priority 11000 iif eth9', out)
            self.assertIn('ip -4 route del ', out)
            if not fail:
                self.assertIn('internet_verified 0', out)
                self.assertIn('proto_init_update flethp-test 1 1', out)
            if mode == 'explicit': self.assertNotIn('detect_mape\n', out)
            self.assertNotIn('ip -4 route add default dev flethp-test table main', out)
            self.assertLess(sum(p.stat().st_size for p in SCRATCH.rglob('*') if p.is_file()), 1024*1024)


if __name__ == '__main__':
    try:
        unittest.main(verbosity=2)
    finally:
        if SCRATCH.exists(): shutil.rmtree(SCRATCH)
