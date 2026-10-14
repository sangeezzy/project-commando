@echo off
chcp 65001 >nul
rem Разрешить гостям подключаться к серверу игры из любой сети этого ПК (и из раздачи Wi-Fi с ПК). Один раз; спросит права администратора.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0firewall.ps1" -Port 8000
pause
