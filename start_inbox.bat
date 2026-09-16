@echo off
title Batabitoo Mail Center
echo ====================================================
echo Starting Batabitoo Mail Center and Cloudflare Tunnel
echo ====================================================
echo.
echo Starting Local Inbox Server (Port 3030)...
start "Inbox Server" node inbox_server.js
timeout /t 2 /nobreak >nul

echo Starting Cloudflare Permanent Tunnel (inbox-api.batabitoo.com)...
start "Cloudflare Permanent Tunnel" .\cloudflared.exe tunnel run --token eyJhIjoiZTM0YzVjNTk0MzNiNmE1NWM5YWQ0MzdmOTJkNTQ0MWQiLCJ0IjoiOWI0NTEyNTktMjNkNS00YmM1LWI1YjktMmU2YWMzZjFmYTAwIiwicyI6IlloVkY2eU1lclZmWTZkb2QrMGxYc2x5eXRrNFlLbU84SUdsNVc1ZU9KNjA9In0=

echo.
echo ====================================================
echo Dashboard is live at: http://localhost:3030
echo ====================================================
