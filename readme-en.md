# luci-app-fleth
luci-app-fleth is a helper that can configure your IPv4 over IPv6 tunnel automatically.
> Japan only
# Support ISP
https://qiita.com/site_u/items/b6d5097f5e3a0f91c95d  

DS-Lite:
- gw.transix.jp
    - IIJひかり
    - インターリンクZOOT NATIVE
    - excite MEC光
    - BB.excite光Fit
    - enひかり
- dgw.xpass.jp
    - 楽天ひかり
    - GameWith光
    - enひかり
    - BB.exciteコネクト
    - Tigers-net
- dslite.v6connect.net
    - ASAHIネット光


MAP-E:
- WIP
> Need a environment to test

# Screenshots
![information-1](./screenshots/luci-information-1.png)  
![configuration-1](./screenshots/luci-configuration-1.png)
# Compile

prepare your building SDK by yourself.

```
git clone https://github.com/makeding/luci-app-fleth package/huggy/luci-app-fleth
make package/huggy/luci-app-fleth/compile
```

# License
MIT