# CPA 刷题库（2026 教材版）

按科目、学习模块、章节和知识节组织的注册会计师练习工具，提供网页版和 Windows 离线版。当前六个专业阶段科目全部开放，综合阶段两套试卷仍待补充。题目是原创学习练习，非中注协官方题库。

本次源码和题库取自用户提供的 `CPA刷题库_六科离线版_Android-3.apk` 内置 `assets/index.html`，合并仓库已有的退出续答功能。导入来源、原始文件哈希和题目数据哈希见 [content/android-import.json](content/android-import.json)。最新 Android 和 Windows 原生设备同步源码见 `native/`。

## 最新安装包：3.2.3

- [Android APK：3.2.3，支持回车提交答案](downloads/peer/CPA刷题库_设备同步_Android.apk)
- [Windows EXE：3.2.3.0，支持回车提交答案](downloads/peer/CPA刷题库_设备同步_Windows.exe)
- [完整构建与升级说明](native/README.md)、[安装包 SHA-256](downloads/peer/SHA256SUMS.txt)
- [2026-10-09 更新与本次同步验证记录](docs/updates/2026-10-09.md)
- [2026-10-10 回车提交更新](docs/updates/2026-10-10.md)

点击左上角“CPA刷题库”打开左侧菜单，集中进入选科、练习历史和设备同步。六科共 4,412 题保持原题号、题干、答案及来源。

Android 包名 `cn.cpa26.workbook`、版本 `3.2.3`、版本码 `37`，沿用原六科离线版的签名证书。原六科离线版 3.0.3 / 同包名 3.2.0 / 3.2.1 / 3.2.2 可直接覆盖升级；独立包名 `cn.cpa26.workbookresume` 的旧续答版属于另一应用。请保留原应用数据，勿先卸载。

新设备同步版直接运行 APK / EXE，在同一 Wi-Fi 或热点内发现设备，点击目标设备的“同步”即可交换记录，取消配对码步骤。选择后持续自动合并统计、错题、标记和历史，可点击“停止同步”。未提交的练习使用“在本机继续对方进度”接管。两端都需要 3.2.2 或以上版本。无需启动 Python 服务；不与 LocalSend 软件互通。Android 需 8.0+；Windows 使用 .NET Framework 4 和默认浏览器。连接受防火墙或热点客户端隔离影响时可输入设备 IP。

以下 `dist/`、`windows/` 和 `lan/` 说明保留早期网页与离线版用法；**最新安装包从 `native/` 构建**。

## 功能

- **章节学习**：按模块、章、知识节选题；会计默认打开当前章首节，其他科目默认显示本章全部题目。
- **判分与解析**：单选、多选按答案精确匹配判分；简答、辨析和计算题展示参考答案后自评。保留知识点、解析及教材来源位置。
- **回车提交**：学习和错题练习中可按回车提交当前答案；简答输入框内回车换行。模拟练习统一交卷，弹窗及其他按钮保留原有键盘操作。
- **提交本组**：章节学习支持逐题提交和整组提交；整组提交只统计已作答题，未答题不加入错题。提交后可逐题查看解析。
- **机考短练**：45 分钟，最多抽取 10 单选、5 多选、5 简答。题型不足时不补齐；会计全为单选，实际抽取 10 题。不是正式考试的题型比例或成绩。
- **错题复习**：保存累计练习次数、正确次数和错题状态；错题连续答对 3 次移出。
- **退出后继续**：自动保存六科当前练习的模式、章节、知识节、题号、答案、简答草稿、选项顺序、提交与自评状态及模拟剩余时间。刷新或重新打开后恢复，关闭期间暂停计时；恢复后不会重复计分。
- **练习历史**：记录逐题或整组提交后的时间、答案、参考答案和解析，最多保留最近 200 次且不超过 10,000 道题。重新打开后，同一场练习继续使用原历史记录。
- **统一题号**：使用 ACC、LAW、FIN、TAX、AUD、STR 五位序号显示题号，内部题号保持稳定以兼容旧统计和进度。CSV 同时保留显示题号与原题号。
- **辅助操作**：题目标记、随机选项、字号、计算器、键盘操作、手机布局和按科目下载 CSV、覆盖清单。

## 当前规模

| 科目 | 题目 | 章节 | 知识节 |
| --- | ---: | ---: | ---: |
| 会计 | 2,331 | 30 | 127 |
| 经济法 | 305 | 12 | 65 |
| 财务成本管理 | 393 | 20 | 81 |
| 税法 | 554 | 14 | 74 |
| 审计 | 394 | 24 | 120 |
| 公司战略与风险管理 | 435 | 8 | 29 |
| **合计** | **4,412** | **108** | **496** |

与旧 Windows 版相比，税法新增 245 题，新增战略 435 题，合计增加 680 题。原有 3,732 题的内部题号、题干、答案和解析保持一致。会计由第 1—3 章基础理论 280 题和第 4—30 章扩展题 2,051 题组成。

“知识节有题”不代表已经穷尽全部规则、例外和跨章综合考法。请结合教材、考试大纲及各科覆盖清单核对。

## 早期 Windows 离线版下载与构建

[下载早期 Windows 离线 EXE](downloads/windows/CPA会计从零刷题_离线版_Windows.exe)

当前版本为 **1.2.0.0**，内嵌六科共 4,412 题和 12 个下载文件，使用默认浏览器打开，不需要 HTTP 服务。文件名保留旧版名称以兼容下载路径。需要 Windows 的 .NET Framework 4。

SHA-256：`874730790D4A23B137B7DD9DEF73E6DA3988C47424B9D033457721DC32EAA29A`。

在仓库根目录执行：

```powershell
.\windows\build.ps1 -NodePath node
```

输出到 `downloads/windows/`。`windows/build-offline.mjs` 合并网页模块、CSS 和离线下载文件，并压缩为嵌入资源；`windows/Launcher.cs` 将网页写到旧版固定临时文件 `CPA_Accounting_Offline.html`，再打开默认浏览器。相同浏览器配置下可保留旧记录。中间产物位于已忽略的 `work/windows-build/`。

EXE 支持 `--extract <文件路径>`，可提取内嵌网页进行校验。

## 本地运行

```powershell
git clone https://github.com/hHeyLgMK/hHeyLgMK-cpa-accounting-from-zero-2026.git
cd hHeyLgMK-cpa-accounting-from-zero-2026
python -m http.server 8000 --bind 127.0.0.1 --directory dist
```

打开 <http://127.0.0.1:8000/>。网页版使用 ES modules，应通过 HTTP 访问。Windows EXE 的网页已全部内联，可以直接离线使用。

项目采用静态 HTML、CSS 和原生 JavaScript，不需要数据库、登录服务或第三方 npm/pip 依赖。将完整 `dist/` 发布为静态站点即可；推送 GitHub 本身不等于已启用网站托管。

## 早期 Python 局域网版

电脑运行 `python lan/server.py`，Windows 可双击 `lan/start-windows.bat`。手机通过同一热点或 Wi-Fi 打开启动窗口显示的电脑局域网地址，两端输入相同配对码。当前设备自动上传进度，另一端点击“在本机继续”接管。一次一台设备答题，版本检查和备份防止旧端覆盖新记录。服务需要 Python 3.9+，无第三方依赖。

详见 [局域网使用说明](lan/使用说明.md)。此段仅描述旧的浏览器局域网版；最新 APK / EXE 设备同步见上方。旧 APK/EXE 的记录不会自动迁移到 Python 局域网网页。静态站点和重新打包的离线网页支持进度备份，但只有通过局域网服务地址打开才能配对。

## 数据保存

`cpa-accounting-zero-v1` 保存累计统计、错题、标记、选项随机设置和练习历史；`cpa-practice-sessions-v1` 保存各科当前会话、最后打开的科目和字号。保存会话时只保存题号，不复制题库正文。

每次选择答案、输入草稿、翻题、提交、计时和关闭页面都会保存。切换科目或回到选科页暂停对应模拟；切换章节、知识节、练习模式或重新抽题会替换该科的当前会话。已提交整组和模拟结果也会恢复。

旧版累计统计和已保存的当前作答继续保留；历史功能上线前没有记录的逐次答案无法补回。损坏存储或已删除题号会安全回到新练习，页面会提示存储是否可用。

记录仅保存在当前浏览器与用户配置。不同来源（协议、域名、端口或本地文件路径）的数据分别保存；未配对的网页版、Android 和 Windows 不自动跨设备同步；局域网版配对后可同步网页记录。清除站点或应用数据会删除记录。

## 源码与题库维护

| 文件 | 职责 |
| --- | --- |
| `dist/index.html`、`app.css`、`app.js` | 六科入口、答题、历史、计时、判分和下载 |
| `dist/progress.js` | 保存与恢复会话、答案、草稿、剩余时间和历史会话标识 |
| `dist/questions.js`、`basic-theory.js`、`accounting-expanded.js` | 会计题库及适配 |
| `dist/extra-subjects.js`、`strategy.js` | 其他五科运行时题库 |
| `dist/question-numbers.js` | 内部题号到统一显示题号的映射 |
| `content/` | 题稿、教材目录、APK 导入与题库构建工具 |
| `windows/` | 可复现的 Windows 离线打包源码 |
| `tests/` | 导入完整性、应用状态和进度恢复测试 |

`dist` 同时包含手工网页源码与生成题库，不能整体删除。基础理论题直接维护在 `dist/basic-theory.js`。税法新题保存于 `content/supplemental/tax-questions.json`，战略完整题稿保存于 `content/supplemental/strategy.json`，统一题号源表为 `content/question-numbers.json`。

重新构建题库：

```powershell
python -X utf8 content/build_bank.py
python -X utf8 content/build_strategy.py
node content/accounting/build.mjs
```

四科构建包含税法补充题并刷新 `coverage.json`；战略构建生成战略模块、题库 CSV、覆盖 CSV 和显示题号模块。会计构建更新会计模块、题库 CSV 和覆盖表。战略学习清单和税法覆盖核对 Markdown 随 APK 导入并人工维护。

新增题必须保持已有内部题号和显示题号稳定，在 `content/question-numbers.json` 分配新号；不能通过重新排序替换旧号。教材页码与来源须随题目核对，来源 PDF 不随仓库分发。详细说明见 [content/README.md](content/README.md)。

若有新 APK，可先提取到独立目录：

```powershell
python -X utf8 content/import-apk.py path/to/app.apk work/apk-import
```

导入器只提取内置网页、模块和下载资源，不执行 APK 或脚本。提取的 `app.js` 是 APK 原版，覆盖仓库前须合并进度恢复功能，并检查新版结构；不能直接覆盖现有应用。

## 验证

先构建 Windows 网页，再运行：

```powershell
node --test tests/progress.test.mjs tests/app-resume.test.mjs tests/bank.test.mjs
```

测试涵盖 APK 六科数据完整性、4,412 个题号与答案有效性、真实应用脚本重新初始化、未提交草稿、多科会话、模拟试卷与选项顺序、剩余时间、历史连续性、整组结果、旧版进度迁移、重复计分防护、损坏存储和实际 EXE 网页脚本。

会计只读校验：

```powershell
Push-Location content/accounting
try { node verify.mjs } finally { Pop-Location }
```

本次同步已逐题核对 APK 的六科题库与 8 个题库/覆盖 CSV，自动状态测试和 EXE 提取一致性校验通过。浏览器界面实测尚未完成，此前本机浏览器工具连接失败。

## 限制与授权

- 综合阶段题库尚未提供；Android 原生壳源码已包含在 `native/android/`，签名私钥不随仓库分发。
- 简答自评与客观题判分不能代表正式考试评分。
- 部分题源标注所属知识节阅读范围；税法和战略补充题另标知识点所在页。
- 税法扫描缺少印刷页 628—629，相关旧题引用官方补充来源；规则变化时需人工复核。
- 仓库未声明开源许可证。教材名称、页码和官方链接用于来源回查，不包含教材 PDF。
