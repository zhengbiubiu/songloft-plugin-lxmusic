# LxMusic Plugin for Songloft

连接 LX Music Sync Server (lxserver) 聚合多平台免费音源（酷我/QQ/酷狗/网易云/咪咕等），向 Songloft 提供网络搜索、播放直链、歌词与封面服务；自动向 MIoT 智能音箱注册外部搜索源，支持小爱语音点歌走 LX Music 免费资源。

## 项目结构

```
songloft-plugin-lxmusic/
├── main.js              # 插件主入口（单文件 IIFE，所有代码内联）
├── icon.svg             # 插件图标
├── static/
│   └── index.html       # 设置页面
├── plugin.json          # 插件清单（含 entryHash + zipHash，由 build.py 自动更新）
├── registry.json        # Songloft 订阅源入口
└── build.py             # 一键构建脚本
```

## 开发流程

1. 修改 `main.js` / `static/index.html` / `icon.svg` 中的任意文件
2. 运行构建脚本：
   ```powershell
   python build.py
   ```
   脚本会：
   - 重算 `entryHash` 和 `zipHash` 并写入 `plugin.json`
   - 生成符合 Songloft 规范的 `lx-music-plugin.jsplugin.zip`
3. 提交代码并推送：
   ```powershell
   git add -A
   git commit -m "feat: 描述你的修改"
   git push
   ```
4. 到 [Releases](https://github.com/zhengbiubiu/songloft-plugin-lxmusic/releases) 编辑对应 release，上传新的 ZIP 附件

## 安装方式

在 Songloft → 设置 → 插件 → 订阅源中添加：

```
https://raw.githubusercontent.com/zhengbiubiu/songloft-plugin-lxmusic/main/registry.json
```

## 配置

安装后在插件设置页填写 **lxserver 服务地址**（如 `http://192.168.0.115:9527`）。

- 如果 lxserver 启用了用户认证，展开"高级（可选）"填写用户名密码
- 默认搜索平台优先级：酷我 → QQ → 网易云 → 咪咕 → 酷狗 → 百度
- 默认音质：128k（可选 320k / flac / hires）

## 依赖

- [Songloft](https://github.com/songloft-org/songloft) ≥ 2.7.0
- [lxserver](https://github.com/XCQ0607/lxserver) 任意版本
