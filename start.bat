@echo off
cd /d "%~dp0"

echo ============================================
echo  CrowdWorks Job Matcher
echo ============================================

if not exist venv (
    echo [First run] Creating virtual environment...
    python -m venv venv
    if errorlevel 1 (
        echo Python was not found. Please install Python and try again.
        pause
        exit /b 1
    )
)

call venv\Scripts\activate.bat

if not exist .env (
    echo .env not found. Creating it from .env.example ...
    copy .env.example .env >nul
    echo Please set your ANTHROPIC_API_KEY in the .env file that just opened.
    notepad .env
    echo After saving your API key, double-click this file again to start the server.
    pause
    exit /b 0
)

echo Checking dependencies...
pip install -q -r requirements.txt

echo Starting server... (keep this window open)
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8000"

uvicorn app:app --reload

echo.
echo Server stopped.
pause
