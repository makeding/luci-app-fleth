[![banner](./logo/fleth-banner.svg)](https://fleth.link/)
# luci-app-fleth
[English](./readme-en.md) || [Chinese Simplified](./readme-zhs.md)  

luci-app-fleth は、IPv4 over IPv6 トンネルを自動構成できるヘルパーです。DS-Lite、MAP-E、IPIP6H トンネル（固定IP）、および IPIP6HP パススルーに対応しています。

- 公式サイト: [fleth.link](https://fleth.link/)
- パッケージフィード: [dl.fleth.link](https://dl.fleth.link/)

> 日本向け

**OpenWrt 25.12 で wan6 が IPv6 を取得できない場合**
インストール前に接続が必要な場合は、`Network → Interfaces → Default DUID` を空にしてください。

> v0.24 は `map` / `ds-lite` 依存関係を含む最後のリリースです。詳細は [v0.24 リリースノート](https://github.com/makeding/luci-app-fleth/releases/tag/v0.24) を参照してください。

# インストール (apk)
OpenWrt 25.12 以降:

```
wget -O /etc/apk/keys/fleth.pem https://dl.fleth.link/fleth.pem
echo 'https://dl.fleth.link/apk/all/packages.adb' > /etc/apk/repositories.d/fleth.list
apk update
apk add luci-proto-fleth
```

# インストール (ipk)
OpenWrt 24.10 以前:

```
mkdir -p /etc/opkg/keys
wget -O /etc/opkg/keys/064499bbef2b4ee5 https://dl.fleth.link/opkg/all/064499bbef2b4ee5
echo 'src/gz fleth https://dl.fleth.link/opkg/all' >> /etc/opkg/customfeeds.conf
opkg update
opkg install luci-proto-fleth
```

旧 `luci-app-fleth` から更新する場合は、同じフィードを追加した後に互換パッケージをインストールしてください。

```
opkg install luci-app-fleth
# または
apk add luci-app-fleth
```
# 対応 ISP
https://qiita.com/site_u/items/b6d5097f5e3a0f91c95d  

## DS-Lite:
- `gw.transix.jp`
    - BB.excite光（コネクト と 10Gbps MAP-E PLAN 除く）
    - enひかり
    - IIJひかり（東日本 テスト済）
    - インターリンクZOOT NATIVE
    - 株式会社インターリンク ZOOT NATIVE
- `dgw.xpass.jp`
    - BB.exciteコネクト
    - enひかり
    - GameWith光
    - 楽天ひかり（東日本 テスト済）
    - Tigers-net
- `dslite.v6connect.net`
    - ASAHIネット光（東日本 テスト済）
## MAP-E:
- `BIGLOBE`
  - BIGLOBE（東/西日本 テスト済）
  - おてがる光（東日本 テスト済）
  - BB.excite光 10Gbps MAP-E PLAN（東日本 テスト済）
- `JPNE（v6プラス）`
    - DMM光
    - GMOとくとくBB
    - enひかり（東/西日本 テスト済）
    - ic-net光コース
    - おてがる光（東日本 テスト済）
    - So-net
    - ぷらら（Sコース）(R.I.P.)
    - 21ip.jp（東日本 テスト済）
- `OCN` (R.I.P.)（東日本 テスト済）
- `NURO`

## 固定IP
- `JPNE（v6プラス）`
  - enひかり（東/西日本 テスト済）
- `SoftBank 光`
  - 1Gbps
  - 10Gbps（東日本 テスト済）
- 固定IPを下流機器へパススルーする構成にも対応しています。

# スクリーンショット
![information](./screenshots/luci-information-3.jpeg)  
![luci-proto-fleth](./screenshots/luci-proto-fleth.jpeg)  
![tools](./screenshots/luci-tools-1.jpeg)  
![luci-proto-ipip6h](./screenshots/luci-proto-ipip6h.jpeg)  
![firewall-port-forward-hook-1](./screenshots/firewall-port-forward-hook-1.png)


# コンパイル
ビルドSDKを自分で用意してください。

```
git clone https://github.com/makeding/luci-app-fleth package/huggy/luci-app-fleth
make package/huggy/luci-app-fleth/compile
```

i18n:
```
po2lmo po/ja/fleth.po root/usr/lib/lua/luci/i18n/fleth.ja.lmo
```
# License
MIT + GPL2(If the `luci-proto-ipip6h` or `luci-proto-ipip6hp` component is included in the build)
