# 题库维护

当前运行时题库来自六科 Android-3 APK，并保留仓库原有题稿与构建流程。导入来源及哈希见 `android-import.json`。

## 可编辑题稿

- `seed-bank.json`：经济法、财管、税法、审计原有 280 题。
- `expansion/*.txt`：四科逐节扩充题，按 `@章.节` 分组，字段为 `知识点|题目|参考答案|解析`。
- `expansion/sections.py`、`catalog.py`：四科知识节目录和模块映射。
- `supplemental/tax-questions.json`：新版 APK 新增的 245 道税法题，保留完整来源。
- `supplemental/strategy.json`：战略完整 8 章、29 节、435 题，题目维护在章节 `items` 中。
- `question-numbers.json`：六科统一显示题号源表。内部题号用于浏览器数据兼容，显示题号用于界面与 CSV；两者不能复用或重排。
- `accounting/chapter4.json` 至 `chapter30.json`：会计扩展题。
- `../dist/basic-theory.js`：会计第 1—3 章基础理论题。

新题追加到所属章/节，并在题号源表分配未使用的新显示编号。所有旧题号保持原意，避免破坏旧统计、错题和进度。

## 构建

在仓库根目录执行：

```powershell
python -X utf8 content/build_bank.py
python -X utf8 content/build_strategy.py
node content/accounting/build.mjs
.\windows\build.ps1 -NodePath node
node --test tests/progress.test.mjs tests/app-resume.test.mjs tests/bank.test.mjs
```

`build_bank.py` 合并种子、TXT 和税法补充 JSON，生成四科模块、CSV、覆盖 JSON 与知识点清单。
`build_strategy.py` 从战略 JSON 生成 `strategy.js`、战略 CSV 和 `question-numbers.js`。
会计脚本校验题稿并生成扩展模块、CSV 和教材位置覆盖表。不要使用 `--allow-partial` 进行正式构建。

战略 Markdown 清单和税法覆盖核对说明从 APK 提取，题库修改后需人工同步这两个文档。

税法扫描缺少印刷页 628—629，第 630 页起 PDF 偏移由 +9 改为 +7。相关信用管理题使用官方补充来源，不能虚构不存在的 PDF 页。知识节覆盖不等于全部细则与综合考法已覆盖。

## 新 APK 导入

```powershell
python -X utf8 content/import-apk.py path/to/app.apk work/apk-import
```

导入器针对当前 APK 的内联模块格式，只读取 ZIP 中 `assets/index.html`；输出网页模块、CSS 和离线下载资源以及哈希清单。遇到不同结构应先检查并更新导入器。不会执行 APK 或脚本。

提取后的应用代码尚无本仓库的退出续答合并，应先对比题库、新功能和差异，再更新题稿与运行时模块。合并时必须保留 `progress.js` 的恢复路径、历史会话 ID、已完成学习组状态和重复计分防护。

本次六科共 4,412 题，108 章、496 节；与 APK 的题干、答案、解析、来源及 CSV 数据逐项一致。浏览器界面实测未完成，自动测试和 EXE 内嵌网页校验通过。
