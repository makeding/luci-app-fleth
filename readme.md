![banner](./logo/fleth-banner.svg)  
# luci-app-fleth
[English](./readme-en.md) || [Chinese Simplified](./readme-zhs.md)  

luci-app-fleth は、IPv4 over IPv6 トンネルを自動構成できるヘルパーです。DS-Lite、MAP-E、および IPIP6 トンネル（独立IP）に対応しています。

> 日本向け

[＞＞＞＞＞＞ダウンロードはこちら＜＜＜＜＜＜＜](https://github.com/makeding/luci-app-fleth/releases)
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
    - ASAHIネット光
## MAP-E:
- `BIGLOBE`
  - BIGLOBE（西日本 テスト済）
  - おてがる光（東日本 テスト済）
  - BB.excite光 10Gbps MAP-E PLAN（東日本 テスト済）
- `JPNE（v6プラス）`
    - DMM光
    - GMOとくとくBB
    - enひかり（東日本 テスト済）
    - ic-net光コース
    - おてがる光（東日本 テスト済）
    - So-net
    - ぷらら（Sコース）(R.I.P.)
    - 21ip.jp（東日本 テスト済）
- `OCN` (R.I.P.)（東日本 テスト済）

## 独立IP
- `JPNE（v6プラス）`
  - enひかり（東日本 テスト済）
- `NURO`

# スクリーンショット
![information](./screenshots/luci-information-3.jpeg)  
![configuration](./screenshots/luci-configuration-3.jpeg)  
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
MIT + GPL2(If the `luci-proto-ipip6h` component is included in the build)