@echo off
chcp 65001 >nul
cd /d "%~dp0.."
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 lan\server.py
) else (
  where python >nul 2>nul
  if errorlevel 1 (
    echo 需要先安装 Python 3.9 或更新版本，并勾选 Add Python to PATH。
  ) else (
    python lan\server.py
  )
)
pause
