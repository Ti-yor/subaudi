# Anki 与教材制卡

实现版本：Subaudi 0.2.0；内核固定为官方 `anki==26.9.3`（Python API + Rust 后端）。

## 使用

操作说明见 [使用手册 · 卡片库](USER-GUIDE.md#10-卡片库)。实现上需要注意的行为：

- `.colpkg` 先在临时集合中恢复，再合并进当前库，不覆盖已有集合。导入与删除笔记前都会创建内核备份（`userData/anki/backups`）。
- 默认不导入 / 导出学习进度；勾选“导入/导出时包含复习进度”后同时带上牌组配置。
- 从资料制卡：逐批（约 2,400 字）列出知识点清单，再每组五点生成卡片，强制每点至少一张；缺失知识点或出处无法在原文中逐字核对时该组不保存。知识点清单与卡片草稿按内容签名缓存，笔记以“资料 + 问题”的稳定身份去重，因此中断后重跑不会重复。覆盖统计是模型列出的清单覆盖率，不等于教材语义完整性的独立保证。
- PDF 须等全文文字索引完成；无文字页在制卡前自动本地识别。
- 新集合启用官方 FSRS；间隔、学习步骤、每日上限、撤销均由内核计算。界面评分 1–4 映射到内核 `CardAnswer.AGAIN…EASY`。切回阅读视图时暂停答题计时。
- 浏览支持 Anki 搜索语法；编辑写回笔记字段（保留 HTML），同一笔记的全部卡片一起更新。

## 数据与可升级边界

`userData/anki/collection.anki2` 和 `collection.media` 为内核自有数据；Subaudi 不复制 Anki 数据库表结构，也不自己计算复习间隔。卡片/笔记 ID 以字符串穿过 IPC，避免未来大整数精度问题。

- `services/anki/main.py` 是唯一调用上游内核的适配层。协议为 JSON-lines v1，业务代码不调用 Rust 私有方法；只有集合包转接依赖 `RustBackend.import_collection_package`，集中在此文件。
- `src/core/worker.ts`（`LineWorker`）管理常驻子进程、超时、取消与自动重启，与 Office 解析、OCR 共用；`src/anki-contracts.ts` 验证允许的操作，文件路径只能来自主进程文件对话框。
- `src/core/flashcards.ts` 管理分批、生成契约、出处验证、转义；模型缓存、预算与中断在主进程实现。
- 卡面置于无脚本权限的 sandbox iframe，独立 CSP 限制网络。保留基本 HTML/CSS、静态图片、音视频控件、基础/反向/填空模板；依赖 JavaScript 的自定义卡面、Anki 插件和自动 MathJax/LaTeX 渲染不保证兼容。媒体在本地按需内嵌，单文件 8 MB、单卡面 16 MB 上限；媒体原文件仍由内核保存和导出。
- AnkiWeb 同步、编辑笔记类型模板、FSRS 参数优化 UI 尚未实现；可导出到桌面 Anki 操作。

## 构建与升级

开发安装：`npm run setup:anki`。锁文件记录全部 Python 依赖，运行 `npm run build:anki` 构建内含 Python 的 Windows 服务，随 Electron 打包。开发模式可用 Python + 项目本地 `.tools/anki-runtime`；发布包不需要系统 Python。

升级步骤：
1. 退出应用，保留 `userData/anki` 的完整副本；或导出带进度、媒体的牌组。内核可能迁移数据库，不能直接降级后打开新库。
2. 在单独环境安装待升级版本，更新 `services/anki/requirements.txt` 和完整锁文件；不要原地混装旧依赖。
3. 只在适配层消化 API 变化；若协议变化，增加版本并同步 TypeScript 合约。
4. 执行 `npm run check`、`npm test`、`npm run test:anki`、`npm run ui`。最后运行 `build-release.bat` 重新构建服务与 Electron 包，并确认它对打包后卡片库内核的冒烟测试通过。
5. 在真实用户集合副本上验证新/旧 APKG、COLPKG、媒体、填空、评分/撤销、重启和重复导入，再替换内核。回退时恢复旧内核和升级前集合副本。

## 依据与实现取舍

查阅日期：2026-09-24。

- [Anki 笔记、模板与卡片](https://docs.ankiweb.net/getting-started.html)：笔记存字段，模板生成卡片，各卡片有独立学习状态。因此编辑操作写回笔记，调度操作针对卡片。
- [导入牌组](https://docs.ankiweb.net/importing/packaged-decks.html)、[导出](https://docs.ankiweb.net/exporting.html)：共享内容和学习进度应区分，故进度选项默认关闭。
- [Anki 官方 Python API](https://github.com/ankitects/anki/blob/main/docs-site/addons/the-anki-module.mdx)、[Collection 源码](https://github.com/ankitects/anki/blob/main/pylib/anki/collection.py)、[V3 调度源码](https://github.com/ankitects/anki/blob/main/pylib/anki/scheduler/v3.py)：使用 Collection、现代导入导出、queued states、build_answer/answer_card，保留官方复习日志和撤销机制。
- [FSRS 算法](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)、[官方牌组选项](https://docs.ankiweb.net/deck-options.html)：难度、稳定性、可提取性建模由官方内核负责，不以简化自制公式冒充 FSRS。
- Tabibian et al., [Optimizing Human Learning](https://arxiv.org/html/1712.01856v2)：基于遗忘概率和学习反馈的自适应调度模型；这里借鉴记录真实回忆结果的设计原则，没有将该论文的 Memorize 算法称为 FSRS。
- Reddy et al., [Unbounded Human Learning](https://arxiv.org/html/1602.07032v2)：讨论新内容输入率和复习负荷之间的关系，因此保留 Anki 每日新卡上限，而不是生成多少就立即要求复习多少。

上游 Anki 使用 AGPL-3.0-or-later。版本、源码与许可信息见 `third-party/ANKI-NOTICE.md`。分发整合产品时需满足适用的许可和对应源码提供要求；子进程隔离用于升级维护，不构成许可豁免。

旧版 PPT 解析依据：[Microsoft MS-PPT 文件结构](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/5bda8009-6612-4679-a6eb-6fb83cbcf195)。OLE 容器使用 olefile 0.47，许可随包提供。
