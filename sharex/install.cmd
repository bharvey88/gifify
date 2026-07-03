@echo off
rem Registers both gifify custom uploaders with ShareX.
rem Double-click this; ShareX will prompt once per uploader.

cd /d "%~dp0"

start "" "gifify-edit.sxcu"
timeout /t 2 /nobreak >nul
start "" "gifify-auto-webp.sxcu"

echo If ShareX did not open, install it first: https://getsharex.com/
echo Next, in ShareX: Destinations ^> File uploader ^> pick a gifify entry.
pause
