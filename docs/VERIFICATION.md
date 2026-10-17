# 外部能力、版本与许可核实

核实日期 2026-09-21；实测记录更新 2026-09-23。官方文档核实与真实接口调用是两件事：DeepSeek已完成真实文字调用，SearXNG仍未实测。详见 EVALUATION.md。

- [DeepSeek模型表](https://api-docs.deepseek.com/quick_start/pricing/)：官方表列出 deepseek-flash（DeepSeek-V4.1-Flash）和 deepseek-v4-pro（DeepSeek-V4-Pro-0813），均支持JSON，只有Flash支持视觉。首次直接抓取超时，随后通过官方索引页重新获得表格；不采信已被更新的新闻中的退役计划。本实现只调用文字JSON，不发送图像或工具调用。模型别名可更新，不能承诺复现。
- [JSON模式](https://api-docs.deepseek.com/guides/json_mode/)要求JSON消息及response_format；可能返回空内容。实现设置4096最大输出，无temperature等未验证参数；空/截断/非法引用拒绝成功缓存。价格随时变化，虽查到峰谷定价，本版仍只记录token与unknown金额，没有硬编码美元单价。
- [思考模式](https://api-docs.deepseek.com/guides/thinking_mode/)：已核对并实测 `thinking: {type: "disabled"}`，不请求模型内部思维链；可复现推导写入教学正文。适配器版本和提示词manifest参与缓存签名。
- [视觉指南](https://api-docs.deepseek.com/guides/vision/)确认Flash图片输入，但本版不使用云OCR；不能据模型支持图像推断坐标或公式可靠。
- [SearXNG API](https://docs.searxng.org/dev/search_api.html)：/search?format=json，实例必须启用JSON。实现独立于模型，用户配置自己的实例。
- Electron npm 当前版本 44.4.3、PDF.js 6.3.289 已下载并锁定。Electron MIT（含Chromium第三方声明）；PDF.js Apache-2.0；React MIT；react-markdown MIT；Zod MIT；SQLite公有领域（由Electron内置Node提供）。精确依赖树见 DEPENDENCIES.json 与 package-lock.json。
- Python PSF；PyInstaller GPL-2.0-or-later带分发例外；RapidOCR Apache-2.0；ONNX Runtime MIT；Pillow MIT-CMU；pypdfium2 Apache-2.0/BSD-3-Clause，PDFium及其依赖有独立声明，随其包分发。
- [RapidOCR](https://github.com/RapidAI/RapidOCR)说明模型源于PaddleOCR转换；[PaddleOCR许可](https://github.com/PaddlePaddle/PaddleOCR/blob/main/LICENSE)为Apache-2.0。已记录三个随本机1.2.3包分发模型的名称、大小、SHA-256，未下载来源不明新权重。正式公开发布前仍应独立审查模型分发链与完整NOTICE；本记录不是法律意见或合规认证。

third-party/ 收集本次生产npm依赖和Python分发包的可用LICENSE/NOTICE；Electron发布目录另外包含 LICENSE 和 LICENSES.chromium.html。DEPENDENCIES.json 同时记录开发依赖，不能把开发依赖误当全部嵌入应用。
