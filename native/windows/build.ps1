param(
    [string]$NodePath = 'node',
    [string]$CompilerPath = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$buildDirectory = Join-Path $repoRoot 'work\peer-build'
$outputPath = Join-Path $repoRoot 'downloads\peer\CPA刷题库_设备同步_Windows.exe'
Push-Location $repoRoot
try {
    & $NodePath (Join-Path $repoRoot 'native\build-web.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'Web build failed' }
    $bankId = [IO.File]::ReadAllText((Join-Path $buildDirectory 'bank-id.txt')).Trim()
    $releasePath = Join-Path $repoRoot 'downloads\peer\release.json'
    $release = Get-Content -LiteralPath $releasePath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($release.bankId -ne $bankId) { throw 'Question bank changed; update both installers together' }
    $source = [IO.File]::ReadAllText((Join-Path $PSScriptRoot 'PeerApp.cs'), [Text.Encoding]::UTF8).Replace('BANK_PLACEHOLDER', $bankId)
    $compiledSource = Join-Path $buildDirectory 'PeerApp.Windows.cs'
    [IO.File]::WriteAllText($compiledSource, $source, [Text.UTF8Encoding]::new($false))
    $payload = Join-Path $buildDirectory 'CPAPeer.html.gz'
    & $CompilerPath /nologo /target:winexe /optimize+ /platform:anycpu "/out:$outputPath" /reference:System.dll /reference:System.Core.dll /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll "/resource:$payload,CPAPeer.html.gz" $compiledSource
    if ($LASTEXITCODE -ne 0) { throw 'Windows build failed' }
    $hash = (Get-FileHash -LiteralPath $outputPath -Algorithm SHA256).Hash.ToLowerInvariant()
    $release | Add-Member -NotePropertyName windowsVersion -NotePropertyValue '3.2.1.1' -Force
    $release.files.'CPA刷题库_设备同步_Windows.exe'.sha256 = $hash
    $release.files.'CPA刷题库_设备同步_Windows.exe'.bytes = (Get-Item -LiteralPath $outputPath).Length
    [IO.File]::WriteAllText($releasePath, (($release | ConvertTo-Json -Depth 10) + "`n"), [Text.UTF8Encoding]::new($false))
    $sums = foreach ($file in $release.files.PSObject.Properties) { $file.Value.sha256 + '  ' + $file.Name }
    [IO.File]::WriteAllText((Join-Path $repoRoot 'downloads\peer\SHA256SUMS.txt'), (($sums -join "`n") + "`n"), [Text.UTF8Encoding]::new($false))
    Write-Output "Built Windows 3.2.1.1: $outputPath"
    Write-Output "SHA256: $hash"
} finally { Pop-Location }
