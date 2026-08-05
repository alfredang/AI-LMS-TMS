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

REM The service key. Must match EXTERNAL_API_KEY_FOR_CLAWDBOT (or
REM SCHEDULER_SECRET) on the live server. Ask whoever manages the server.
set AGENT_KEY=PUT-THE-KEY-HERE
REM ---------------------------------------------------------------------------

cd /d "%~dp0.."

if "%AGENT_KEY%"=="PUT-THE-KEY-HERE" (
  echo.
  echo   Set AGENT_KEY inside this file first ^(see SETTINGS near the top^).
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
