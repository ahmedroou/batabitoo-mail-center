@echo off
title Batabitoo Mail Center
echo ====================================================
echo Starting Batabitoo Mail Center and Cloudflare Tunnel
echo ====================================================
echo.
if "%SESSION_SECRET%"=="" (
    echo [SECURITY ERROR] SESSION_SECRET is required before exposing the server.
    exit /b 1
)
if "%MASTER_PIN%"=="" if "%MASTER_PASSWORD%"=="" (
    echo [SECURITY ERROR] MASTER_PIN or MASTER_PASSWORD is required before exposing the server.
    exit /b 1
)
if "%INBOUND_EMAIL_SECRET%"=="" (
    echo [SECURITY ERROR] INBOUND_EMAIL_SECRET is required before exposing the email webhook.
    exit /b 1
)
set "NODE_ENV=production"

echo Starting Local Inbox Server (Port 3030)...
start "Inbox Server" node inbox_server.js
timeout /t 2 /nobreak >nul

set TUNNEL_TOKEN=%CLOUDFLARE_TUNNEL_TOKEN%
if "%TUNNEL_TOKEN%"=="" (
    if exist "%~dp0.tunnel_token" (
        set /p TUNNEL_TOKEN=<"%~dp0.tunnel_token"
    )
)

if "%TUNNEL_TOKEN%"=="" (
    echo [WARNING] CLOUDFLARE_TUNNEL_TOKEN is not set and .tunnel_token was not found.
    echo Cloudflare tunnel will not start. To enable remote access, set CLOUDFLARE_TUNNEL_TOKEN
    echo or place your token in .tunnel_token.
) else (
    echo Starting Cloudflare Permanent Tunnel (inbox-api.batabitoo.com)...
    start "Cloudflare Permanent Tunnel" .\cloudflared.exe tunnel run --token %TUNNEL_TOKEN%
)

echo.
echo ====================================================
echo Dashboard is live at: http://localhost:3030
echo ====================================================
