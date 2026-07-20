@echo off
cd /d "%~dp0"

rem Make sure the background server is running (harmless if it already is).
start "" wscript.exe "%~dp0run_server_hidden.vbs"

timeout /t 3 /nobreak >nul

set EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe
set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe

if exist "%EDGE%" (
    start "" "%EDGE%" --app=http://127.0.0.1:8000/
) else if exist "%CHROME%" (
    start "" "%CHROME%" --app=http://127.0.0.1:8000/
) else (
    start "" http://127.0.0.1:8000/
)
