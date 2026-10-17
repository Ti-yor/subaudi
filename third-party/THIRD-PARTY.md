# 第三方组件与许可证

本文件由 `node scripts/licenses.mjs` 生成，请勿手工编辑。它列出 Subaudi 中**实际包含**的组件及其
版本与许可证，并汇总各自的许可证原文。升级依赖或修改 `services/` 后请重新生成：

```bash
npm run licenses            # 重新生成
npm run licenses -- --check # 只检查是否与仓库内容一致（CI 用）
```

生成方式：

- **应用**：渲染进程与主进程由 esbuild 打包，下表依据 esbuild metafile 列出真正进入 `app.asar` 的
  npm 包，因而不会出现只用于开发的包。
- **sidecar**：组件清单取自固定版本的依赖文件（`services/anki/requirements.lock.txt`、
  `services/parser/requirements.txt`），并补上 PyInstaller 自动收入的间接依赖；版本与许可证优先
  读取组件包内的 `*.dist-info`，其次是 `.tools/` 中的固定版本运行时，最后是
  `third-party/licenses/` 中人工核对过的文本。
- **内置运行时**：Electron、Chromium、Node.js、CPython 及随其分发的原生库，见文末；其完整声明
  由发布包本身提供（`LICENSES.chromium.html`、`LICENSE.electron.txt`）。

## 应用（app.asar）

共 60 个包。

| 组件 | 版本 | 许可证 | 文本 | 来源 |
| --- | --- | --- | --- | --- |
| @pdf-lib/standard-fonts | 1.0.0 | MIT | [pdf-lib-standard-fonts-LICENSE.txt](licenses/packages/pdf-lib-standard-fonts-LICENSE.txt) | https://github.com/Hopding/standard-fonts |
| @pdf-lib/upng | 1.0.1 | MIT | [pdf-lib-upng-LICENSE.txt](licenses/packages/pdf-lib-upng-LICENSE.txt) | https://github.com/Hopding/upng |
| @ungap/structured-clone | 1.4.0 | ISC | [ungap-structured-clone-LICENSE.txt](licenses/packages/ungap-structured-clone-LICENSE.txt) | https://github.com/ungap/structured-clone |
| bail | 2.0.2 | MIT | [bail-LICENSE.txt](licenses/packages/bail-LICENSE.txt) | wooorm/bail |
| character-entities | 2.0.2 | MIT | [bail-LICENSE.txt](licenses/packages/bail-LICENSE.txt) | wooorm/character-entities |
| comma-separated-tokens | 2.0.3 | MIT | [comma-separated-tokens-LICENSE.txt](licenses/packages/comma-separated-tokens-LICENSE.txt) | wooorm/comma-separated-tokens |
| decode-named-character-reference | 1.3.0 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | wooorm/decode-named-character-reference |
| estree-util-is-identifier-name | 3.0.0 | MIT | [estree-util-is-identifier-name-LICENSE.txt](licenses/packages/estree-util-is-identifier-name-LICENSE.txt) | syntax-tree/estree-util-is-identifier-name |
| extend | 3.0.2 | MIT | [extend-LICENSE.txt](licenses/packages/extend-LICENSE.txt) | https://github.com/justmoon/node-extend |
| hast-util-to-jsx-runtime | 2.3.6 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | syntax-tree/hast-util-to-jsx-runtime |
| hast-util-whitespace | 3.0.0 | MIT | [comma-separated-tokens-LICENSE.txt](licenses/packages/comma-separated-tokens-LICENSE.txt) | syntax-tree/hast-util-whitespace |
| html-url-attributes | 3.0.1 | MIT | [html-url-attributes-LICENSE.txt](licenses/packages/html-url-attributes-LICENSE.txt) | https://github.com/rehypejs/rehype-minify/tree/main/packages/html-url-attributes |
| inline-style-parser | 0.2.7 | MIT | [inline-style-parser-LICENSE.txt](licenses/packages/inline-style-parser-LICENSE.txt) | https://github.com/remarkablemark/inline-style-parser |
| is-plain-obj | 4.1.0 | MIT | [is-plain-obj-LICENSE.txt](licenses/packages/is-plain-obj-LICENSE.txt) | sindresorhus/is-plain-obj |
| mdast-util-from-markdown | 2.0.3 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | syntax-tree/mdast-util-from-markdown |
| mdast-util-to-hast | 13.2.1 | MIT | [comma-separated-tokens-LICENSE.txt](licenses/packages/comma-separated-tokens-LICENSE.txt) | syntax-tree/mdast-util-to-hast |
| mdast-util-to-string | 4.0.0 | MIT | [bail-LICENSE.txt](licenses/packages/bail-LICENSE.txt) | syntax-tree/mdast-util-to-string |
| micromark | 4.0.2 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark |
| micromark-core-commonmark | 2.0.3 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-core-commonmark |
| micromark-factory-destination | 2.0.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-destination |
| micromark-factory-label | 2.0.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-label |
| micromark-factory-space | 2.0.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-space |
| micromark-factory-title | 2.0.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-title |
| micromark-factory-whitespace | 2.0.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-factory-whitespace |
| micromark-util-character | 2.1.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-util-character |
| micromark-util-chunked | 2.0.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-util-chunked |
| micromark-util-classify-character | 2.0.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-util-classify-character |
| micromark-util-combine-extensions | 2.0.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-util-combine-extensions |
| micromark-util-decode-numeric-character-reference | 2.0.2 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-util-decode-numeric-character-reference |
| micromark-util-decode-string | 2.0.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-util-decode-string |
| micromark-util-html-tag-name | 2.0.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-util-html-tag-name |
| micromark-util-normalize-identifier | 2.0.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-util-normalize-identifier |
| micromark-util-resolve-all | 2.0.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-util-resolve-all |
| micromark-util-sanitize-uri | 2.0.1 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-util-sanitize-uri |
| micromark-util-subtokenize | 2.1.0 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | https://github.com/micromark/micromark/tree/main/packages/micromark-util-subtokenize |
| pako | 1.0.11 | MIT AND Zlib | [pako-LICENSE.txt](licenses/packages/pako-LICENSE.txt) | nodeca/pako |
| pdf-lib | 1.17.1 | MIT | [pdf-lib-LICENSE.txt](licenses/packages/pdf-lib-LICENSE.txt) | https://github.com/Hopding/pdf-lib |
| pdfjs-dist | 6.3.289 | Apache-2.0 | [pdfjs-dist-LICENSE.txt](licenses/packages/pdfjs-dist-LICENSE.txt) | https://github.com/mozilla/pdf.js |
| property-information | 7.2.0 | MIT | [property-information-LICENSE.txt](licenses/packages/property-information-LICENSE.txt) | wooorm/property-information |
| react | 19.1.1 | MIT | [react-LICENSE.txt](licenses/packages/react-LICENSE.txt) | https://github.com/facebook/react |
| react-dom | 19.1.1 | MIT | [react-LICENSE.txt](licenses/packages/react-LICENSE.txt) | https://github.com/facebook/react |
| react-markdown | 10.1.0 | MIT | [react-markdown-LICENSE.txt](licenses/packages/react-markdown-LICENSE.txt) | remarkjs/react-markdown |
| remark-parse | 11.0.0 | MIT | [remark-parse-LICENSE.txt](licenses/packages/remark-parse-LICENSE.txt) | https://github.com/remarkjs/remark/tree/main/packages/remark-parse |
| remark-rehype | 11.1.2 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | remarkjs/remark-rehype |
| scheduler | 0.26.0 | MIT | [react-LICENSE.txt](licenses/packages/react-LICENSE.txt) | https://github.com/facebook/react |
| space-separated-tokens | 2.0.2 | MIT | [comma-separated-tokens-LICENSE.txt](licenses/packages/comma-separated-tokens-LICENSE.txt) | wooorm/space-separated-tokens |
| style-to-js | 1.1.21 | MIT | [style-to-js-LICENSE.txt](licenses/packages/style-to-js-LICENSE.txt) | https://github.com/remarkablemark/style-to-js |
| style-to-object | 1.0.14 | MIT | [style-to-object-LICENSE.txt](licenses/packages/style-to-object-LICENSE.txt) | https://github.com/remarkablemark/style-to-object |
| trim-lines | 3.0.1 | MIT | [trim-lines-LICENSE.txt](licenses/packages/trim-lines-LICENSE.txt) | wooorm/trim-lines |
| trough | 2.2.0 | MIT | [trough-LICENSE.txt](licenses/packages/trough-LICENSE.txt) | wooorm/trough |
| tslib | 1.14.1 | 0BSD | [tslib-LICENSE.txt](licenses/packages/tslib-LICENSE.txt) | https://github.com/Microsoft/tslib |
| unified | 11.0.5 | MIT | [unified-LICENSE.txt](licenses/packages/unified-LICENSE.txt) | unifiedjs/unified |
| unist-util-is | 6.0.1 | MIT | [unist-util-is-LICENSE.txt](licenses/packages/unist-util-is-LICENSE.txt) | syntax-tree/unist-util-is |
| unist-util-position | 5.0.0 | MIT | [bail-LICENSE.txt](licenses/packages/bail-LICENSE.txt) | syntax-tree/unist-util-position |
| unist-util-stringify-position | 4.0.0 | MIT | [comma-separated-tokens-LICENSE.txt](licenses/packages/comma-separated-tokens-LICENSE.txt) | syntax-tree/unist-util-stringify-position |
| unist-util-visit | 5.1.0 | MIT | [bail-LICENSE.txt](licenses/packages/bail-LICENSE.txt) | syntax-tree/unist-util-visit |
| unist-util-visit-parents | 6.0.2 | MIT | [comma-separated-tokens-LICENSE.txt](licenses/packages/comma-separated-tokens-LICENSE.txt) | syntax-tree/unist-util-visit-parents |
| vfile | 6.0.3 | MIT | [unified-LICENSE.txt](licenses/packages/unified-LICENSE.txt) | vfile/vfile |
| vfile-message | 4.0.3 | MIT | [decode-named-character-reference-LICENSE.txt](licenses/packages/decode-named-character-reference-LICENSE.txt) | vfile/vfile-message |
| zod | 3.25.76 | MIT | [zod-LICENSE.txt](licenses/packages/zod-LICENSE.txt) | https://github.com/colinhacks/zod |

## sidecar（Python）

| 所在组件 | 包 | 版本 | 许可证 | 文本 | 来源 |
| --- | --- | --- | --- | --- | --- |
| 卡片库内核 | anki | 26.9.3 | AGPL-3.0-or-later | [anki-LICENSE.txt](licenses/anki-LICENSE.txt) | https://pypi.org/project/anki/ |
| 卡片库内核 | certifi | 2026.7.22 | MPL-2.0 | [certifi-LICENSE.txt](licenses/packages/certifi-LICENSE.txt) | https://github.com/certifi/python-certifi |
| 卡片库内核 | charset-normalizer | 3.5.1 | MIT | [charset-normalizer-LICENSE.txt](licenses/charset-normalizer-LICENSE.txt) | https://pypi.org/project/charset-normalizer/ |
| 卡片库内核 | decorator | 5.3.1 | BSD-2-Clause | [decorator-LICENSE.txt](licenses/packages/decorator-LICENSE.txt) | https://pypi.org/project/decorator/ |
| 卡片库内核 | distro | — | Apache-2.0 | [distro-LICENSE.txt](licenses/distro-LICENSE.txt) | 间接依赖 · https://pypi.org/project/distro/ |
| 卡片库内核 | idna | 3.20 | BSD-3-Clause | [idna-LICENSE.txt](licenses/packages/idna-LICENSE.txt) | https://pypi.org/project/idna/ |
| 卡片库内核 | Markdown | 3.10.3 | BSD-3-Clause | [markdown-LICENSE.txt](licenses/packages/markdown-LICENSE.txt) | https://pypi.org/project/markdown/ |
| 卡片库内核 | orjson | 3.12.0 | MPL-2.0 AND (Apache-2.0 OR MIT) | [orjson-LICENSE.txt](licenses/packages/orjson-LICENSE.txt) | https://pypi.org/project/orjson/ |
| 卡片库内核 | packaging | 25.0 | Apache-2.0 OR BSD-2-Clause | [packaging-LICENSE.txt](licenses/packaging-LICENSE.txt) | 间接依赖 · https://pypi.org/project/packaging/ |
| 卡片库内核 | protobuf | 7.36.2 | 3-Clause BSD License | [protobuf-LICENSE.txt](licenses/packages/protobuf-LICENSE.txt) | https://developers.google.com/protocol-buffers/ |
| 卡片库内核 | Pygments | 2.19.2 | BSD-2-Clause | [pygments-LICENSE.txt](licenses/pygments-LICENSE.txt) | 间接依赖 · https://pypi.org/project/Pygments/ |
| 卡片库内核 | PySocks | 1.7.1 | BSD | [pysocks-LICENSE.txt](licenses/packages/pysocks-LICENSE.txt) | https://github.com/Anorov/PySocks |
| 卡片库内核 | requests | 2.34.2 | Apache-2.0 | [requests-LICENSE.txt](licenses/packages/requests-LICENSE.txt) | https://pypi.org/project/requests/ |
| 卡片库内核 | setuptools | — | MIT | [setuptools-LICENSE.txt](licenses/setuptools-LICENSE.txt) | 间接依赖 · https://pypi.org/project/setuptools/ |
| 卡片库内核 | typing_extensions | 4.16.0 | PSF-2.0 | [typing-extensions-LICENSE.txt](licenses/typing-extensions-LICENSE.txt) | https://pypi.org/project/typing-extensions/ |
| 卡片库内核 | tzdata | 2025.2 | Apache-2.0 | [tzdata-LICENSE.txt](licenses/tzdata-LICENSE.txt) | 间接依赖 · https://pypi.org/project/tzdata/ |
| 卡片库内核 | urllib3 | 2.8.0 | MIT | [urllib3-LICENSE.txt](licenses/packages/urllib3-LICENSE.txt) | https://pypi.org/project/urllib3/ |
| 文字识别 | charset-normalizer | 3.4.3 | MIT | [charset-normalizer-LICENSE.txt](licenses/charset-normalizer-LICENSE.txt) | 间接依赖 · https://pypi.org/project/charset-normalizer/ |
| 文字识别 | defusedxml | 0.7.1 | PSF-2.0 | [defusedxml-LICENSE.txt](licenses/defusedxml-LICENSE.txt) | 间接依赖 · https://pypi.org/project/defusedxml/ |
| 文字识别 | numpy | 2.3.2 | BSD-3-Clause 等 | [numpy-LICENSE.txt](licenses/numpy-LICENSE.txt) | 间接依赖 · https://pypi.org/project/numpy/ |
| 文字识别 | onnxruntime | 1.30.0 | MIT | [onnxruntime-LICENSE.txt](licenses/onnxruntime-LICENSE.txt) | https://pypi.org/project/onnxruntime/ |
| 文字识别 | opencv-python | 5.0.0.93 | Apache-2.0 与 MIT | [opencv-LICENSE.txt](licenses/opencv-LICENSE.txt) | 间接依赖 · https://pypi.org/project/opencv-python/ |
| 文字识别 | pillow | 12.3.0 | Apache-2.0 | [pillow-LICENSE.txt](licenses/pillow-LICENSE.txt) | https://pypi.org/project/pillow/ |
| 文字识别 | psutil | 7.0.0 | BSD-3-Clause | [psutil-LICENSE.txt](licenses/psutil-LICENSE.txt) | 间接依赖 · https://pypi.org/project/psutil/ |
| 文字识别 | pyclipper | 1.4.0 | MIT | [pyclipper-LICENSE.txt](licenses/pyclipper-LICENSE.txt) | 间接依赖 · https://pypi.org/project/pyclipper/ |
| 文字识别 | pypdfium2 | 5.11.0 | BSD-3-Clause, Apache-2.0, dependency licenses | [pypdfium2-LICENSE.txt](licenses/pypdfium2-LICENSE.txt) | https://github.com/pypdfium2-team/pypdfium2 |
| 文字识别 | pywin32 | — | PSF-2.0 | [pywin32-LICENSE.txt](licenses/pywin32-LICENSE.txt) | 间接依赖 · https://pypi.org/project/pywin32/ |
| 文字识别 | PyYAML | 6.0.2 | MIT | [pyyaml-LICENSE.txt](licenses/pyyaml-LICENSE.txt) | 间接依赖 · https://pypi.org/project/PyYAML/ |
| 文字识别 | rapidocr-onnxruntime | 1.2.3 | Apache-2.0 | [rapidocr-LICENSE.txt](licenses/rapidocr-LICENSE.txt) | https://github.com/RapidAI/RapidOCR |
| 文字识别 | shapely | 2.1.2 | BSD-3-Clause | [shapely-LICENSE.txt](licenses/shapely-LICENSE.txt) | 间接依赖 · https://pypi.org/project/shapely/ |
| 文字识别 | six | 1.17.0 | MIT | [six-LICENSE.txt](licenses/six-LICENSE.txt) | 间接依赖 · https://pypi.org/project/six/ |
| 文字识别 | threadpoolctl | 3.6.0 | BSD-3-Clause | [threadpoolctl-LICENSE.txt](licenses/threadpoolctl-LICENSE.txt) | 间接依赖 · https://pypi.org/project/threadpoolctl/ |
| 文字识别 | typing_extensions | — | PSF-2.0 | [typing-extensions-LICENSE.txt](licenses/typing-extensions-LICENSE.txt) | 间接依赖 · https://pypi.org/project/typing_extensions/ |
| 文档解析 | olefile | 0.47 | BSD | [olefile-LICENSE.txt](licenses/olefile-LICENSE.txt) | https://www.decalage.info/python/olefileio |

## 内置运行时与原生库

| 组件 | 版本 | 许可证 | 文本 | 位置 / 说明 |
| --- | --- | --- | --- | --- |
| Electron | 44.4.3 | MIT | [electron-LICENSE.txt](licenses/electron-LICENSE.txt) |  |
| Chromium | — | BSD-3-Clause 等 | — | 完整声明随发布包提供：`release/win-unpacked/LICENSES.chromium.html` |
| Node.js | — | MIT | — | 随 Electron 分发，声明见 `release/win-unpacked/LICENSE.electron.txt` |
| CPython | 3.13 | PSF-2.0 | [python-3.13-LICENSE.txt](licenses/python-3.13-LICENSE.txt) | 三个 sidecar |
| OpenSSL | — | Apache-2.0 | [openssl-LICENSE.txt](licenses/openssl-LICENSE.txt) | python3.dll / _ssl.pyd |
| libffi | — | MIT | [libffi-LICENSE.txt](licenses/libffi-LICENSE.txt) | libffi-8.dll |
| zlib | — | Zlib | [zlib-LICENSE.txt](licenses/zlib-LICENSE.txt) | zlib / _bz2.pyd |
| bzip2 | — | bzip2-1.0.6 | [bzip2-COPYING.txt](licenses/bzip2-COPYING.txt) | _bz2.pyd |
| XZ Utils (liblzma) | — | 0BSD 与 LGPL-2.1-or-later | [xz-COPYING-0BSD.txt](licenses/xz-COPYING-0BSD.txt) | _lzma.pyd |
| libexpat | — | MIT | [expat-COPYING.txt](licenses/expat-COPYING.txt) | pyexpat.pyd |
| libmpdec | — | BSD-2-Clause | [mpdecimal-COPYRIGHT.txt](licenses/mpdecimal-COPYRIGHT.txt) | _decimal.pyd |
| SQLite | — | 公有领域 | — | https://www.sqlite.org/copyright.html |
| PDFium 及构建依赖 | — | BSD-3-Clause 等 | [pdfium-BUILD-LICENSES.txt](licenses/pdfium-BUILD-LICENSES.txt) | pypdfium2_raw |
| ONNX Runtime 第三方依赖 | — | MIT 等 | [onnxruntime-ThirdPartyNotices.txt](licenses/onnxruntime-ThirdPartyNotices.txt) | onnxruntime |
| OpenCV 第三方依赖 | — | Apache-2.0 等 | [opencv-LICENSE-3RD-PARTY.txt](licenses/opencv-LICENSE-3RD-PARTY.txt) | cv2 |
| GEOS | — | LGPL-2.1-or-later | [shapely-LICENSE-GEOS.txt](licenses/shapely-LICENSE-GEOS.txt) | Shapely.libs |

## 需要人工处理

无。

Anki 内核的版本、源码快照与许可说明另见 [ANKI-NOTICE.md](ANKI-NOTICE.md)。
