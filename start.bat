@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem Сервер игры: раздаёт файлы и связывает игроков для прямого подключения (нужен Python 3)
start "" http://localhost:8000/
python server.py 8000
pause
