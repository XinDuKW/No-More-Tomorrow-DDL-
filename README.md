<div align="center">

# NoMoreTomorrow · 桌面便签

碎碎念：
很久以前使用千问做的html桌面标签，可供SAO的桌面网页插件使用
现在让大肥鱼包装后的html便签，可单独作为软件使用
至少比较符合自己的审美、功能需求（主要是没见过什么好用还不需要VIP的（）随便整了一个，没有调研过，大概是造轮子了）
（一开始是为了自己老是拖延二游活动、月卡时间忘记续这种情况的，但好像有时候连便签都懒得记录（））

有问题提issues吧，我会全力交给大肥鱼的


把**一个 HTML 文件**包装成 Windows 原生桌面便签：单进程多窗口、独立配置目录、
记住窗口位置/大小/数量（任务管理器强杀、断电、直接关机都不丢）、开机自启。

[![platform](https://img.shields.io/badge/platform-Windows%2010%2F11-0078d4)](#)
[![electron](https://img.shields.io/badge/Electron-44-47848f)](#)
[![license](https://img.shields.io/badge/license-MIT-green)](LICENSE)

<img src="docs/screenshot-note.png" width="300" alt="便签窗口">
<img src="docs/screenshot-settings.png" width="300" alt="外观设置">

</div>

---

## 特性

- **一个进程，多个便签窗口** —— 再次双击 exe 不会再起一个进程，而是让已有进程**再开一个窗口**（单实例锁 + 进程内多窗口）。
- **每个窗口可以显示不同的便签** —— 开两个窗口，一个看「期末」一个看「生活」，互不干扰；任一窗口改内容，其它窗口**实时同步刷新**。
- **窗口位置 / 大小 / 数量全记住** —— 移动缩放 250ms 防抖落盘，关窗 / 退出 / 关机立即落盘。强杀、断电后重启，还是原来那几个窗口、原来的位置和大小。
- **便签内容是文件级持久化** —— 不依赖浏览器 localStorage，改动直接写入 JSON 文件（原子替换），强杀最多丢最后 0.1 秒的输入。
- **独立配置文件夹** —— 便携版存在 exe 旁边，安装版存在 `%APPDATA%\NoMoreTomorrow-Data`，与系统里其它软件完全隔离；备份就是复制一个文件夹。
- **开机自启** —— 首次运行默认开启，托盘菜单随时开关，exe 挪了位置会自动修正路径。
- **透明毛玻璃、无边框** —— 便签直接浮在桌面上，八向缩放、拖动把手、置顶、最小化一应俱全。
- **托盘常驻** —— 新建窗口 / 显示全部 / 置顶 / 开机自启 / 打开配置文件夹。

## 下载

到 **[Releases](../../releases)** 页面下载（仓库里只有源码，不含 exe）。

| 文件 | 适合谁 | 说明 |
|---|---|---|
| `NoMoreTomorrow-Setup-[version].exe` | **推荐** | 安装版：可选安装目录、开始菜单 + 桌面快捷方式、带卸载程序，启动最快 |
| `NoMoreTomorrow-Portable-[version].exe` | 不想安装 | 单文件便携版，数据存在它旁边；每次启动要解压，约 12 秒 |
| `NoMoreTomorrow-绿色版` | 要最快启动 | 解压即用文件夹版，约 1.4 秒启动 |

> 未做数字签名，首次运行 Windows SmartScreen 可能提示 —— 点「更多信息 → 仍要运行」。

## 用法

| 操作 | 方法 |
|---|---|
| 移动窗口 | 拖便签顶部的小把手，或标题那一行的空白处，或右上角 `⠿` |
| 缩放窗口 | 拖窗口四条边 / 四个角 |
| 新建窗口 | 右上角 `＋` / 托盘菜单 / `Ctrl+N` / 再双击一次 exe |
| 置顶 / 最小化 / 关闭 | 右上角 `📌` `–` `✕` |
| 退出软件 | 托盘「退出」，或 `Ctrl+Q`，或关掉最后一个便签窗口 |

数据目录：便携版与绿色版在 exe 同级的 `NoMoreTomorrow-Data\`，安装版在 `%APPDATA%\NoMoreTomorrow-Data\`。
里面 `store.json` 是便签内容，`windows.json` 是窗口布局，删掉整个文件夹即可重置。


## 许可

[MIT](LICENSE)。发行包内已包含 Electron / Chromium 的许可证文件（`LICENSES.chromium.html`、`LICENSE.electron.txt`）。

---

<details>
<summary>English</summary>

**NoMoreTomorrow** is a Windows desktop sticky-notes app built with Electron around a single HTML file.
One process hosts many note windows; each window can show a different note and they stay in sync in real time.
Window position, size and count are persisted continuously (atomic writes), so a force-kill, power loss or
shutdown without quitting still restores everything on the next launch. Data lives in a dedicated portable
folder next to the exe (or `%APPDATA%` for the installed build), and autostart is enabled on first run.

Download the installers from the Releases page — the repository contains source only.
</details>
