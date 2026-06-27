@echo off
echo Starting ProctoEase Demo Setup...

echo.
echo Stopping any running containers and wiping volumes...
docker compose down -v

echo.
echo Starting Database and Redis...
docker compose up -d

echo.
echo Waiting 5 seconds for database to initialize...
timeout /t 5 /nobreak > nul

echo.
echo Executing seeder script...
python seed.py
if %ERRORLEVEL% NEQ 0 (
    echo Seeding Failed!
    exit /b %ERRORLEVEL%
)

echo.
echo Starting Backend...
start "ProctoEase Backend" cmd /k "uvicorn app.main:app --reload"

echo.
echo Starting Frontend...
start "ProctoEase Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo ========================================================
echo Demo Setup Complete!
echo "Backend running"
echo "Frontend running"
echo Frontend is available at http://localhost:5173
echo Please check demo_credentials.txt for login info.
echo ========================================================
