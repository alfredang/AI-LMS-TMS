@echo off
REM ===========================================================================
REM  Start the TPGateway helper on this PC.
REM
REM  WHAT THIS IS FOR
REM    Staff confirm Direct Applications from the LMS website. The confirmation
REM    itself has to go through TPGateway, and TPGateway only accepts
REM    connections from an ordinary office internet line — not from our server.
REM    So this PC does that part on their behalf.
REM
REM  WHO NEEDS TO RUN IT
REM    One PC in the office, not every staff member. Leave it running. While it
REM    is on, anyone can click Confirm & Enrol on the website and it works. If
REM    this PC is off, their run simply waits until it is back on.
REM
REM  SETUP (once)
REM    Edit the two lines under SETTINGS below.
REM    To have it start by itself each time this PC is switched on, press
REM    Windows+R, type  shell:startup  , and put a shortcut to this file there.
REM ===========================================================================

REM ----------------------------- SETTINGS ------------------------------------
REM The live LMS address:
set LIVE_URL=https://ai-lms-tms.tertiaryinfo.tech
REM ---------------------------------------------------------------------------

cd /d "%~dp0.."

REM The key is read from .env.local rather than kept here, because this file is
REM in git and that one is not — a secret pasted here would end up published.
REM Add this line to .env.local (same value as EXTERNAL_API_KEY_FOR_CLAWDBOT on
REM the live server):
REM     AGENT_KEY=...
for /f "usebackq tokens=1,* delims==" %%a in (".env.local") do (
  if /i "%%a"=="AGENT_KEY" set AGENT_KEY=%%b
)

if "%AGENT_KEY%"=="" (
  echo.
  echo   AGENT_KEY is missing from .env.local
  echo.
  echo   Copy EXTERNAL_API_KEY_FOR_CLAWDBOT from the live server's settings
  echo   in Coolify, then add this line to .env.local:
  echo.
  echo       AGENT_KEY=the-value-you-copied
  echo.
  pause
  exit /b 1
)

echo Starting the LMS on this PC...
REM Opens in its own window so it can be watched or closed independently.
start "LMS (leave running)" cmd /k npm run dev

echo Waiting for it to come up...
REM Give Next.js time to boot before the agent starts asking it for work.
timeout /t 25 /nobreak >nul

echo Starting the TPGateway helper...
start "TPGateway helper (leave running)" cmd /k node scripts/tpg-agent.mjs

echo.
echo   Both are running in their own windows. Leave them open.
echo   Staff can now use Confirm ^& Enrol on the website.
echo.
pause
