# CPA刷题库 3.2.1 原生设备同步版

`web/` 是 APK 和 EXE 共用的实际界面与题库源码；`android/` 是 WebView、AndroidKeyStore 身份和 Java 设备通信；`windows/PeerApp.cs` 是 Windows 本地启动器与通信。`dist/` 属于早期网页版本。

## 使用与升级

点击左上角“CPA刷题库”打开侧边菜单，进入选科、练习历史或设备同步。关闭应用会保存题号、选择、简答草稿、提交状态和模拟剩余时间；重新打开不会重复计分。累计统计、错题、标记和历史兼容原六科离线版存储。旧版从未保存的草稿无法补回。

Android 8.0+，包名 `cn.cpa26.workbook`，版本码 35。保留原签名证书和 WebView 来源，可覆盖同包名六科离线版 3.0.3 和设备同步版 3.2.0。不同包名的独立续答版不能被本包覆盖。

Windows 需要 .NET Framework 4；运行 EXE 后通过默认浏览器答题。EXE 保持运行才能发现、同步设备；再次运行打开相同本机页面。原来通过文件网页打开的旧 Windows 版记录使用不同来源，可通过进度备份导入迁移。

Windows 安装包已修订为 **3.2.1.1**：修复首次运行时“无法生成设备证书”，正确传递 Unicode 证书名称，创建可持久化的 RSA 设备身份。已有设备证书继续沿用，题库和 Android 3.2.1 安装包未变。

两端连接同一热点或 Wi-Fi，在菜单中打开设备同步，选择对方并输入对方的 8 位配对码。配对后自动交换记录；按“在本机继续对方进度”接管未完成练习。请一次在一台设备继续同一场练习。错题连续答对三次移出，多次收到同一提交事件不会重复累计。

协议为本项目的 `cpa-p2p-v1`，不是 LocalSend 协议。UDP 多播 `224.0.0.169:53319` 用于发现，TCP/TLS 53319 用于设备通信，Windows 本机网页为 `127.0.0.1:53320`。首次配对后固定证书指纹并保存设备令牌。端口被占用、防火墙、访客网络和热点隔离会影响连接；发现失败可手动输入 IP。

## 构建

仅构建 Windows EXE，可在 Windows 仓库根目录执行（需要 Node.js 和系统 .NET Framework C# 编译器，不需要 Android 签名私钥）：

```powershell
.\native\windows\build.ps1 -NodePath node
```

脚本构建共用网页、打包 EXE 并更新 `release.json` 和 `SHA256SUMS.txt`，保留 Android APK。若题库标识已变化，会拒绝仅更新 Windows，以免两端无法配对。

Windows 原生证书及启动回归测试：

```powershell
& "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:exe /out:work\peer-build\WindowsCertificateTest.exe native\tests\WindowsCertificateTest.cs
& .\work\peer-build\WindowsCertificateTest.exe .\downloads\peer\CPA刷题库_设备同步_Windows.exe .\work\certificate-test
```

测试使用独立目录，验证真实 Windows 证书创建、私钥保存、重开后身份不变、TLS 1.2、本机网页及生产同步接口；不打开浏览器界面。测试设备私钥仅留在已忽略的 `work/` 中，不得提交。

运行时无需 Python / Node.js；以下依赖仅用于开发构建。Linux 构建脚本使用解包后的 Ubuntu 工具根目录，依赖 Node.js、Python 3（cryptography）、Mono C# 编译器、JDK 21、Android aapt/zipalign/dx/apksigner，以及 Android 23 编译平台。

工具路径布局（相对 `--tools-root`）：

- `usr/bin/mono`、`usr/lib/mono/4.5/mcs.exe` 和 .NET Framework 引用程序集、`etc/mono/`
- `usr/lib/jvm/java-21-openjdk-amd64/bin/java` 和 `javac`
- `usr/share/java/com.android.android-23.jar`、`com.android.dx-10.0.0.jar`
- `usr/share/java/apksigner-31.0.2.jar` 及其依赖 JAR
- `usr/lib/android-sdk/build-tools/debian/aapt`、`zipalign` 和相关动态库

在仓库根目录执行：

```bash
python native/build.py --tools-root /path/to/tools-root --signing-key /private/signing_key.pem
```

原版公开签名证书和图标已包含在源码中，构建默认校验私钥必须匹配该证书。可选 `--signing-cert /path/to/certificate.pem` 指定其他证书，或 `--previous-apk /path/to/original.apk` 从含 v1 签名的旧 APK 提取证书与图标。不同证书构建不能覆盖原版应用。PKCS12 密钥需设置 `CPA_SIGNING_PASSWORD`。

输出为 `downloads/peer/` 内的 APK 和 EXE，中间文件在忽略的 `work/peer-build/`。私钥必须保存在仓库外；`android/signing-cert.pem` 仅为公开证书，不含私钥。仓库不包含构建工具二进制、私钥或用户练习数据。

网页构建不需要签名工具：

```bash
node native/build-web.mjs
node windows/build-offline.mjs
node --test tests/*.test.mjs
```

生产 Java / EXE 通信联测：

```bash
/path/to/tools-root/usr/lib/jvm/java-21-openjdk-amd64/bin/javac -source 8 -target 8 -encoding UTF-8 -cp /path/to/tools-root/usr/share/java/com.android.json-android-10.0.0.jar -d work/peer-build/testclasses native/android/src/cn/cpa26/workbook/PeerNode.java native/tests/PeerHarness.java
python native/tests/transport_test.py /path/to/tools-root
```

自动检查覆盖六科数据、退出续答、草稿和计时接管、幂等合并、实际 3.0.3 界面产生的旧存储升级、Java 与 EXE 的双向 TLS 通信、配对码拒绝、来源保护和重启持久化。通信联测在 Linux/Mono 和 JVM 回环环境执行，尚未在用户手机、热点和真实 Windows 环境实测。

`web/import-manifest.json` 记录导入时的原始 APK 网页与文件哈希，是来源记录；其中界面文件随后已增加续答、同步和菜单功能。`tests/fixtures/3.0.3-app.js` 保留原 APK 应用逻辑以验证真实旧存储兼容；题库由测试注入当前校验一致的原版数据。
