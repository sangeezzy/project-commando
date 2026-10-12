@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Сервер игры без Python: PowerShell + встроенный C# (есть в Windows 10/11).
rem Раздаёт игру, связывает игроков для прямого подключения и сам открывает игру в браузере.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server.ps1" -Port 8000 -Open
pause
