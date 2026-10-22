@echo off
rem Hourly run of the email outbox for Windows Task Scheduler (pilot, 2026-10-21).
rem With no provider configured, every pending message is recorded as suppressed. Nothing is sent.
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
echo %date% %time% start email-outbox>> logs\email-outbox.log
call npx tsx src/scripts/process-email-outbox.ts>> logs\email-outbox.log 2>&1
set RESULT=%ERRORLEVEL%
echo %date% %time% exit %RESULT% email-outbox>> logs\email-outbox.log
exit /b %RESULT%
