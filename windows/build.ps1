param(
    [string]$NodePath = 'node',
    [string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$taskRepoRoot = Split-Path -Parent $PSScriptRoot
if (!$OutputDirectory) { $OutputDirectory = Join-Path $taskRepoRoot 'downloads\windows' }
$taskBuildDir = Join-Path $taskRepoRoot 'work\windows-build'
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
& $NodePath (Join-Path $PSScriptRoot 'build-offline.mjs') $taskBuildDir
if ($LASTEXITCODE -ne 0) { throw 'Offline HTML build failed' }
$taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (!(Test-Path -LiteralPath $taskCompiler)) {
    $taskCompiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (!(Test-Path -LiteralPath $taskCompiler)) { throw '.NET Framework compiler was not found' }
$taskExecutable = Join-Path $OutputDirectory 'CPA会计从零刷题_离线版_Windows.exe'
$taskPayload = Join-Path $taskBuildDir 'CPAOffline.html.gz'
& $taskCompiler /nologo /target:winexe /platform:anycpu /optimize+ "/out:$taskExecutable" /reference:System.Windows.Forms.dll "/resource:$taskPayload,CPAOffline.html.gz" (Join-Path $PSScriptRoot 'Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Windows executable build failed' }
Get-Item -LiteralPath $taskExecutable | Select-Object FullName,Length
Get-FileHash -LiteralPath $taskExecutable -Algorithm SHA256
