@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem PROJECT COMMANDO: сервер игры без Python (PowerShell + встроенный C#, есть в Windows 10/11).
rem Раздаёт игру из папки game, связывает игроков для прямого подключения и сам открывает игру в браузере.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\server.ps1" -Port 8000 -Open
rem закрыли вкладку с игрой — сервер вышел сам (код 0), окно закрывается; ошибка (порт занят и т. п.) — окно ждёт
if errorlevel 1 pause
