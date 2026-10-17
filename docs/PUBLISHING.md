# 发布到 GitHub：建立仓库、上传与发版

面向维护者。按顺序做一遍即可完成首次公开；之后每次发版只需看第 5 节。

---

## 1. 上传前必须知道的三件事

1. **公开后就收不回来。** 推送到公开仓库的内容会在几分钟内被镜像站、搜索引擎和自动扫描密钥的机器人抓取。之后删除文件、甚至删除仓库，都不能保证别人手里没有副本。所以检查一定要在第一次 `git push` **之前**做。
2. **`.gitignore` 只拦得住还没被 `git add` 过的文件。** 文件一旦进了某次提交，再写进 `.gitignore` 也没用，它会留在历史里。
3. **API Key 只要上传过一次就视为泄露。** 不管多快删掉，都要先到服务商后台作废这个 Key，再处理仓库（见第 7 节）。

---

## 2. 什么不可以上传

| 类别 | 例子 | 为什么 | 拦截方式 |
| --- | --- | --- | --- |
| **API Key 与凭据** | `credential*.bin`、`.env`、代码或文档里的 `sk-…` | 别人可以用你的账户付费调用 | `.gitignore` + `npm run check:publish` 扫描内容 |
| **你的教材与资料** | 课本 PDF、讲义 DOCX/PPTX、扫描件 | 绝大多数受版权保护，公开即侵权 | `.gitignore` 拦截根目录与 `private/`、`books/`；检查脚本拦截 `fixtures/` 以外的所有文档 |
| **本地数据库** | `subaudi.sqlite`（及 `-wal`、`-shm`） | 含资料全文、批注、解释和用量 | `.gitignore` + 检查脚本 |
| **卡片库与牌组** | `collection.anki2`、`.apkg`、`.colpkg` | 含个人复习记录；别人的牌组也可能有版权 | `.gitignore` + 检查脚本 |
| **构建产物** | `node_modules/`、`dist/`、`release/`、`build/`、`.tools/`、`services/*/dist/`、`*.exe`、`*.dll` | 可以重新生成，体积以 GB 计；EXE 超过 GitHub 单文件 100 MB 上限 | `.gitignore` + 检查脚本；EXE 用 Release 附件发布（第 5 节） |
| **测试残留** | `test-results/`、`evals/real-*.json` | 含完整的应用数据目录或付费 API 的原始请求 | `.gitignore` |
| **个人信息** | 写着 `C:\Users\你的名字\…` 的路径、私人邮箱 | 暴露用户名与目录结构 | 检查脚本给出提醒 |

**可以、也应该上传的：** 源码、`prompts/`、`docs/`（含截图）、`fixtures/`（原创示例资料）、`evals/cases.json` 与 `evals/live/`（自写的评测用例与模型输出）、`LICENSE`、`third-party/`（许可证文本与 Anki 源码快照，AGPL 要求随发布提供）、`package-lock.json`。

> `fixtures/` 里的资料必须是你**原创**或可以自由分发的。往里添加任何文件之前，先确认来源。

---

## 3. 建立仓库

### 3.1 选平台

- **GitHub**：开源项目的默认选择，Issues、Releases、Actions、密钥扫描都完整。下文以 GitHub 为例。
- **Gitee**（可选镜像）：国内用户下载 Release 更快。建议以 GitHub 为主仓库，在 Gitee 上建镜像仓库同步。

### 3.2 在 GitHub 上新建空仓库

1. 登录 GitHub，右上角 **＋ → New repository**。
2. **Repository name**：`subaudi`。
3. **Description**：例如“本地优先的教材阅读器：选中读不懂的句子，在页边补上作者省略的前提、步骤和条件”。
4. **Visibility**：先选 **Private**。推上去、在网页上逐个目录看过一遍之后，再到 Settings 改成 Public（第 4.6 节）。
5. **不要**勾选 “Add a README”、“Add .gitignore”、“Choose a license”。这三样项目里都有了；让 GitHub 生成的话，第一次推送会冲突。
6. 点 **Create repository**，记下页面上的仓库地址，例如 `https://github.com/你的用户名/subaudi.git`。

### 3.3 安装与配置 Git（只需一次）

1. 安装 [Git for Windows](https://git-scm.com/download/win)，一路默认即可。它自带的 Git Credential Manager 会在第一次推送时弹出浏览器登录 GitHub，不需要手动生成令牌。
2. 设置提交者身份。**邮箱建议用 GitHub 提供的匿名邮箱**，否则你的私人邮箱会出现在每一次提交里、永久公开：
   - 到 GitHub **Settings → Emails**，勾选 **Keep my email addresses private**，复制形如 `12345678+用户名@users.noreply.github.com` 的地址；
   - 同页勾选 **Block command line pushes that expose my email**。

   ```powershell
   git config --global user.name  "你的名字或昵称"
   git config --global user.email "12345678+用户名@users.noreply.github.com"
   git config --global init.defaultBranch main
   ```

---

## 4. 首次上传

在项目根目录（`package.json` 所在目录）打开 PowerShell。

### 4.1 初始化并暂存

```powershell
git init
git add -A
```

### 4.2 人工检查要上传的文件

```powershell
git status --short          # 列出全部待提交文件
git status --short | Measure-Object -Line   # 数量，正常约 300 个
```

逐项看一遍，重点确认：没有 `node_modules`、`release`、`dist`、`build`、`.tools`；没有 `.sqlite`、`.bin`、`.apkg`；`.pdf` / `.docx` / `.pptx` 只出现在 `fixtures/` 下。

### 4.3 自动检查

```powershell
npm run check:publish
```

它会扫描所有待上传的文件：

- **✖ 错误**（必须处理，否则脚本以非零状态退出）：密钥、凭据、数据库、卡片库、构建产物、`fixtures/` 以外的教材、超过 100 MB 的文件；
- **⚠ 提醒**（逐条确认）：可能暴露用户名的本机路径、超过 20 MB 的文件。

遇到错误时，把该文件移出暂存区，再确认 `.gitignore` 已覆盖它：

```powershell
git rm --cached "文件路径"
```

看到 `✔ 可以上传` 再继续。

### 4.4 （推荐）安装提交前钩子

以后每次 `git commit` 都会自动检查暂存的内容：

```powershell
Set-Content -Encoding ascii .git/hooks/pre-commit "#!/bin/sh`nexec node scripts/publish-check.mjs --staged`n"
```

### 4.5 提交并推送

```powershell
git commit -m "Subaudi 0.2.0"
git remote add origin https://github.com/你的用户名/subaudi.git
git push -u origin main
```

第一次推送时会弹出浏览器窗口让你登录 GitHub 授权，之后不再询问。

### 4.6 在网页上复查，然后公开

1. 打开仓库页面，确认 README 的截图能正常显示，并点开 `third-party/`、`fixtures/`、`evals/` 看一眼。
2. **Settings → General → Danger Zone → Change visibility → Public**。
3. 在 **Settings → Code security** 中开启（公开仓库免费）：
   - **Secret scanning** 与 **Push protection**：GitHub 会拒绝包含已知格式密钥的推送；
   - **Dependabot alerts**：依赖出现安全漏洞时提醒你。
4. 仓库首页右侧 **About** 的齿轮里填写简介与主题标签，例如 `textbook-reader`、`electron`、`anki`、`llm`、`education`；许可证会被自动识别为 AGPL-3.0。
5. （可选）**Settings → Branches → Add rule**：保护 `main` 分支，禁止强制推送。

---

## 5. 发布版本（Release）

EXE 不进仓库，作为 Release 附件发布。

### 5.1 打包

在 Windows 上双击 `build-release.bat`（或运行 `npm run release`）。完整流程会依次完成：检查环境、类型检查与测试、构建 sidecar、**重新生成第三方许可证清单**、打包 EXE、对发布包里的三个 sidecar 做冒烟测试。任一步失败都会停止。

### 5.2 提交版本变更并打标签

```powershell
git status                    # 打包会更新 third-party/，一并提交
git add -A
npm run check:publish
git commit -m "Release 0.2.0"
git tag -a v0.2.0 -m "Subaudi 0.2.0"
git push origin main --tags
```

### 5.3 计算校验值

```powershell
certutil -hashfile "release\Subaudi 0.2.0.exe" SHA256
```

### 5.4 在 GitHub 上创建 Release

1. 仓库页面 **Releases → Draft a new release**，**Choose a tag** 选 `v0.2.0`。
2. 标题：`Subaudi 0.2.0`。正文可以直接用 `docs/CHANGELOG-0.2.0.md` 的内容，末尾附上：

   ```markdown
   ## 下载
   - `Subaudi-0.2.0.exe`：Windows 10/11 64 位便携版，双击即可运行
   - SHA256：`（粘贴第 5.3 步的结果）`
   - 暂未签名：Windows 提示“已保护你的电脑”时，点“更多信息 → 仍要运行”

   ## 源码与许可证
   - 本版本源码：标签 [v0.2.0](../../tree/v0.2.0)（AGPL-3.0-or-later）
   - 第三方组件与许可证：[third-party/THIRD-PARTY.md](../../blob/v0.2.0/third-party/THIRD-PARTY.md)
   - 内置 Anki 内核的对应源码：[third-party/anki-source-29bb700b.tar.gz](../../blob/v0.2.0/third-party/anki-source-29bb700b.tar.gz)
   ```

3. 把 `release\Subaudi 0.2.0.exe` 拖进附件区，建议重命名为不含空格的 `Subaudi-0.2.0.exe`（与 README 中的文件名一致）。
4. 点 **Publish release**。

### 5.5 许可证义务（每次发版都要满足）

- **AGPL（Subaudi 与 Anki）**：分发 EXE 时必须让接收者能取得完整对应源码。按上面的模板，在 Release 中链接到同一标签的源码和 Anki 源码快照，就满足了这一要求。**不要**只发 EXE、不推送对应源码。
- **LGPL（GEOS，随文字识别组件以 DLL 形式分发）**：保持它是可替换的独立 DLL（PyInstaller 的 onedir 打包已经满足），并在许可证清单中保留其许可证原文。
- **MPL-2.0（certifi、orjson）**：未修改即可原样分发，清单中已包含许可证原文和上游地址。
- **宽松许可证（MIT、BSD、Apache 等）**：保留各自的版权声明与许可证文本。`third-party/` 随发布包一同分发，已经满足。

升级依赖或修改 `services/` 之后，打包流程会自动重新生成 `third-party/THIRD-PARTY.md`。如果只想检查清单是否过期，运行 `npm run licenses -- --check`。

---

## 6. 日常维护

```powershell
git pull                       # 先同步
# ……修改……
npm run check; npm test        # 本地检查
git add -A
git commit -m "简要说明改了什么"   # 已安装钩子时会自动运行发布检查
git push
```

接受他人的 Pull Request 前，先在本地跑一次 `npm run check:publish`，并确认对方没有提交教材或大文件。

> 如果你将来可能对 Subaudi 另行提供商业授权（例如闭源的定制版），在接受第一份外部贡献**之前**就要求贡献者签署贡献者许可协议（CLA）。否则别人贡献的代码仍归其本人所有，你就无法对它重新授权。

---

## 7. 万一上传了不该上传的东西

### 7.1 泄露了 API Key

1. **立刻**到服务商后台作废这个 Key 并生成新 Key（DeepSeek、OpenAI、Anthropic 的控制台都有“删除 / Revoke”）。这一步比清理仓库更重要。
2. 查看服务商账单与用量，确认有没有被盗用。
3. 按 7.2 清理历史。

### 7.2 从历史中彻底删除文件

**还没推送**：撤销最后一次提交，移除文件后重新提交：

```powershell
git reset --soft HEAD~1
git rm --cached "文件路径"
git commit -m "…"
```

**已经推送**：用 [git-filter-repo](https://github.com/newren/git-filter-repo) 改写历史：

```powershell
pip install git-filter-repo
git filter-repo --invert-paths --path "文件路径"     # 删除整个文件
# 或者只替换文件里的密钥文本：
#   先建 replacements.txt，写一行：sk-泄露的值==>***REMOVED***
#   git filter-repo --replace-text replacements.txt
git remote add origin https://github.com/你的用户名/subaudi.git   # filter-repo 会移除 remote
git push origin --force --all
git push origin --force --tags
```

改写历史后：

- 其他人手中的克隆仍保留旧历史，需要重新克隆；
- GitHub 可能仍缓存旧提交的页面：联系 GitHub Support 申请清除缓存视图；
- 如果泄露的是**受版权保护的教材**且仓库曾经公开，在清理之外，最好也告知权利人。

---

## 8. 附：发布前检查清单

- [ ] `npm run check`、`npm test` 通过
- [ ] `npm run check:publish` 显示“可以上传”，提醒已逐条确认
- [ ] `git status --short` 中没有构建产物、数据库、卡片库、教材
- [ ] `fixtures/` 中的每个文件都是原创或可自由分发
- [ ] `third-party/THIRD-PARTY.md` 是最新的（`npm run licenses -- --check`）
- [ ] `package.json` 的版本号、`docs/CHANGELOG-*.md` 已更新
- [ ] 提交者邮箱是 GitHub 匿名邮箱（`git config user.email`）
- [ ] Release 附有 EXE、SHA256，以及同一标签的源码链接
