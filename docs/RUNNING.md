# 开发、测试与打包

面向用户的完整说明（每项功能、设置、隐私、备份、快捷键、故障排除）见 [使用手册](USER-GUIDE.md)。本文只涉及开发、测试与打包。

## 开发

```powershell
npm ci
npm run check        # TypeScript
npm test             # 单元测试（29 项）
npm run ui           # 构建 + Electron 界面冒烟测试，截图在 test-results/ui
npm start            # 开发构建（带 sourcemap）并启动
```

`npm run ui` 在主进程内替换了模型接口，不需要 Key、不产生费用；任一页面错误即失败。开发环境下 Office 解析、OCR 与卡片库直接运行 `services/` 里的 Python 脚本（需 Python 3.13 与 `services/parser/requirements.txt`；再运行 `npm run setup:parser` 与 `npm run setup:anki`，分别把 olefile 和 Anki 内核装到 `.tools/` 下）。`build-release.bat` 发现缺少这两个运行时会自动安装。

真实模型评测（会产生费用）：`npm run probe -- K01` 或 `npx tsx scripts/live-check.ts K11`，结果写入 `evals/`。

## 打包

一键打包（Windows）：双击根目录的 `build-release.bat`，或运行 `npm run release`。

| 参数 | 作用 |
| --- | --- |
| （无） | 环境检查 → `check` / `test` / `test:anki` → 构建 sidecar → 构建 EXE → 冒烟测试 |
| `--fast` | 跳过类型检查与测试，其余不变 |
| `--smoke-only` | 只对 `release\win-unpacked\resources` 中的 sidecar 做冒烟测试 |

冒烟测试按应用的真实方式（每行一个 JSON 请求、不带 `id`、FIFO 匹配应答）调用发布包中的三个 sidecar：卡片库内核 `status`、解析 `fixtures/重排示例.docx`、识别 `fixtures/数字与扫描混合.pdf` 第 1 页。任一组件返回错误、退出或超时，脚本即以非零码结束。双击运行时窗口会停住以便查看输出；在 CI 中设置环境变量 `SUBAUDI_NO_PAUSE=1` 可取消暂停。

构建 EXE 前，脚本会检查 `release\` 里是否有程序在运行（例如从 `release\win-unpacked` 直接打开的 Subaudi，或便携版 EXE）。Windows 不允许覆盖正在运行的文件，electron-builder 会报 `EPERM … unlink Subaudi.exe`。发现这类程序时脚本会列出来，并询问是否关闭：先让窗口正常退出，10 秒内没有退出再强制结束。测试打包结果时，建议把 EXE 复制到别的文件夹再运行。

分步命令：

```powershell
npm run build:sidecars   # Office 解析 + OCR（PyInstaller）
npm run build:anki       # 卡片库内核
npm run dist             # 便携版 EXE → release/
```

sidecar 构建脚本会排除各组件从不使用的模块（numpy/Pillow/cryptography 之于卡片库，OpenCV 视频 I/O 与 AVIF 之于 OCR 等），并在结束后删除 PyInstaller 中间目录。

## 数据

本地数据目录为 `%APPDATA%/subaudi`（设置 → 数据与备份 → 打开）。完整备份：退出 Subaudi 后复制整个目录；`credential*.bin` 只在原 Windows 用户下可解密，分享前请排除。
