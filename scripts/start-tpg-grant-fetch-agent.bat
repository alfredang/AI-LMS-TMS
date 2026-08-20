@echo off
REM ===========================================================================
REM  Start the TPGateway grant-fetch helper on this PC.
REM
REM  WHAT THIS IS FOR
REM    Finance fetches Financial Transactions from TPGateway via the "Fetch
REM    from TPGateway" button on Bulk Grant Payment Sync. That fetch has to go
REM    through TPGateway, and TPGateway only accepts connections from an
REM    ordinary office internet line — not from our server. So this PC does
REM    that part on their behalf. Same idea as start-tpg-agent.bat (Direct
REM    Application confirmations) — this is that same pattern for a different
REM    feature, kept as its own script/process so the two never interfere.
REM
REM  WHO NEEDS TO RUN IT
REM    One PC in the office, not every staff member. Leave it running. While
REM    it is on, anyone can click "Fetch from TPGateway" on the website and it
REM    works. If this PC is off, their run simply queues until it is back on.
REM
REM  RUNNING THIS ALONGSIDE start-tpg-agent.bat ON THE SAME PC
REM    Fine — they're independent processes. This script checks whether the
REM    LMS (npm run dev) is already up on port 3000 before starting a second
REM    copy of it, so running both .bat files on the same PC doesn't collide.
REM
REM  SETUP (once)
REM    Edit the LIVE_URL line under SETTINGS below if it differs from
REM    start-tpg-agent.bat's.
REM    To have it start by itself each time this PC is switched on, press
REM    Windows+R, type  shell:startup  , and put a shortcut to this file there
REM    (alongside the shortcut to start-tpg-agent.bat, if that's already set up).
REM ===========================================================================

REM ----------------------------- SETTINGS ------------------------------------
REM The live LMS address:
set LIVE_URL=https://ai-lms-tms.tertiaryinfo.tech
REM ---------------------------------------------------------------------------

cd /d "%~dp0.."

REM The key is read from .env.local rather than kept here, because this file is
REM in git and that one is not — a secret pasted here would end up published.
REM Same AGENT_KEY line start-tpg-agent.bat already needs in .env.local (same
REM value as EXTERNAL_API_KEY_FOR_CLAWDBOT on the live server):
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

REM Skip starting a second copy of the LMS if start-tpg-agent.bat (or a
REM previous run of this script) already has it up on port 3000.
netstat -ano | findstr ":3000" | findstr "LISTENING" >nul
if %errorlevel%==0 (
  echo LMS already running on this PC — reusing it.
) else (
  echo Starting the LMS on this PC...
  start "LMS (leave running)" cmd /k npm run dev
  echo Waiting for it to come up...
  timeout /t 25 /nobreak >nul
)

echo Starting the TPGateway grant-fetch helper...
start "TPGateway grant-fetch helper (leave running)" cmd /k node scripts/tpg-grant-fetch-agent.mjs

echo.
echo   Both are running in their own windows. Leave them open.
echo   Finance can now use "Fetch from TPGateway" on Bulk Grant Payment Sync.
echo.
pause
