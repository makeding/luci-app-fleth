![banner](./logo/fleth-banner.svg)
# luci-app-fleth
[日本語](./readme.md) || [English](./readme-en.md)

luci-app-fleth 是一个可以自动配置 IPv4 over IPv6 隧道的辅助工具。支持 DS-Lite、MAP-E、IPIP6H 隧道（独立 IP）以及 IPIP6HP 透传。

> 仅面向日本

**OpenWrt 25.12 上 wan6 无法获取 IPv6 的解决办法**
如果需要在安装本插件前先恢复连接，请清空 `Network → Interfaces → Default DUID`。

[>>>>>> 点击此处下载 <<<<<<](https://github.com/makeding/luci-app-fleth/releases)
# 安装（apk）
如果使用 OpenWrt 25.12 或更新版本，目前没有签名，需要 `--allow-untrusted`。

```
apk add --allow-untrusted /tmp/luci-app-fleth_*.apk
```
# 对应 ISP
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
- `NURO`

## 独立IP
- `JPNE（v6プラス）`
  - enひかり（東日本 テスト済）
- `SoftBank 光`
  - 1Gbps
  - 10Gbps（东日本 已测试）

## IPIP6HP 透传
IPIP6HP 用于将独立 IPv4 不经 OpenWrt 路由器 NAT，直接交给一个专用下游设备使用。适合服务器、既有路由器、防火墙设备，或其他需要直接持有公网 IPv4 的设备。

- 可在 LuCI 中设置下游客户端 IPv4、CIDR 前缀长度、客户端网关 IPv4。
- `/31` 配置下，会根据下游客户端 IPv4 自动补全客户端网关 IPv4。
- v6plus / SoftBank 10G 配置可使用 IPv4 到 Interface ID 的辅助填充按钮。
- 建议使用专用透传设备；只有明确需要共享设备时，才启用 “Allow shared passthrough device”。
- 会自动应用 Proxy ARP、源地址策略路由、fw4 nft 规则和 TCP MSS 调整。

# 截图
![information](./screenshots/luci-information-3.jpeg)  
![configuration](./screenshots/luci-configuration-3.jpeg)  
![tools](./screenshots/luci-tools-1.jpeg)  
![luci-proto-ipip6h](./screenshots/luci-proto-ipip6h.jpeg)  
![firewall-port-forward-hook-1](./screenshots/firewall-port-forward-hook-1.png)


# 编译
请自行准备构建 SDK。

```
git clone https://github.com/makeding/luci-app-fleth package/huggy/luci-app-fleth
make package/huggy/luci-app-fleth/compile
```

国际化:
```
po2lmo po/ja/fleth.po root/usr/lib/lua/luci/i18n/fleth.ja.lmo
```
# 许可证
MIT + GPL2（如果构建中包含 `luci-proto-ipip6h` 或 `luci-proto-ipip6hp` 组件）
