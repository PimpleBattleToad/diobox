@echo off
rem Запуск генератора развёртки вкладыша.
rem Без параметров — открывается страница, где размеры и картинку выбирает
rem пользователь сам. С параметрами — обычный режим командной строки.
rem Python берётся из поставки DSH (в системном может не быть Pillow/numpy).
setlocal
set "HERE=%~dp0"
set "PY=C:\Users\Zerg\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe"
if not exist "%PY%" set "PY=python"
if "%~1"=="" goto :ui
if /I "%~1"=="ui" goto :ui
"%PY%" "%HERE%insert_generator.py" %*
goto :eof

:ui
rem всё после "ui" (или без него) уходит серверу страницы
"%PY%" "%HERE%ui_server.py" %2 %3 %4 %5 %6 %7 %8 %9
goto :eof