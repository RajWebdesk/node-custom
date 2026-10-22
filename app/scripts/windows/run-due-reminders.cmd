@echo off
rem Hourly run of the due-reminder job for Windows Task Scheduler (pilot, 2026-10-21).
rem The job itself only acts after the 09:00 America/Toronto slot and only once per day.
rem Requires DATABASE_URL in this user's environment. Never put the connection string in this file.
setlocal

rem Pilot rule: real email stays disabled. Refuse to run if a provider is configured.
if defined EMAIL_PROVIDER (
  echo Refusing to run: EMAIL_PROVIDER is set. The pilot keeps real email disabled. 1>&2
  exit /b 3
)
if not defined DATABASE_URL (
  echo DATABASE_URL is not set for this Windows user. 1>&2
  exit /b 2
)

cd /d "%~dp0\..\.."
if not exist logs mkdir logs
echo %date% %time% start due-reminders>> logs\due-reminders.log
call npx tsx src/scripts/due-reminders.ts>> logs\due-reminders.log 2>&1
set RESULT=%ERRORLEVEL%
echo %date% %time% exit %RESULT% due-reminders>> logs\due-reminders.log
exit /b %RESULT%
