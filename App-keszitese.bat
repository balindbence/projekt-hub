@echo off
title Projekt Hub - alkalmazas keszitese
cd /d "%~dp0"

echo ============================================
echo   Projekt Hub - alkalmazas keszitese
echo   (telepito nelkul, admin jog nelkul)
echo ============================================
echo.

where npm >nul 2>nul
if errorlevel 1 goto :nonode
echo Node.js verzio:
call node -v
echo.
goto :haveNode

:nonode
echo [HIBA] Nem talalom az npm-et.
echo Telepitsd a Node.js LTS verziot: https://nodejs.org
echo Utana zard be ezt az ablakot es inditsd ujra ezt a fajlt.
pause
exit /b 1

:haveNode

echo [1/4] Fuggosegek telepitese/frissitese...
call npm install --no-audit --no-fund
if errorlevel 1 goto :npmfail
echo.

echo [2/4] Regi build torlese...
if exist "%~dp0dist" rmdir /s /q "%~dp0dist"
echo.

echo [3/4] Alkalmazas osszecsomagolasa... (par perc)
call npx electron-builder --win dir
echo.

set "APPDIR=%~dp0dist\win-unpacked"
if not exist "%APPDIR%\Projekt Hub.exe" goto :packfail

echo [4/4] Asztali parancsikon es zip keszitese...
powershell -NoProfile -Command "$w=New-Object -ComObject WScript.Shell; $s=$w.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Projekt Hub.lnk')); $s.TargetPath='%APPDIR%\Projekt Hub.exe'; $s.WorkingDirectory='%APPDIR%'; $s.Save()"
echo   - Asztali parancsikon kesz.

echo   - Zip keszitese a laptopra... ez eltarthat egy percig.
powershell -NoProfile -Command "Compress-Archive -Path '%APPDIR%\*' -DestinationPath '%~dp0dist\Projekt-Hub-hordozhato.zip' -Force"
if exist "%~dp0dist\Projekt-Hub-hordozhato.zip" echo   - Zip kesz.
echo.

echo ============================================
echo   KESZ!
echo ============================================
echo.
echo   Inditas: az asztalon a "Projekt Hub" ikon
echo   vagy:    dist\win-unpacked\Projekt Hub.exe
echo.
echo   Masik gepre: dist\Projekt-Hub-hordozhato.zip
echo   Ott kicsomagolod es inditod a Projekt Hub.exe-t.
echo   Nem kell rá se Node.js, se telepites.
echo.
start "" "%~dp0dist"
pause
exit /b 0

:npmfail
echo.
echo [HIBA] A fuggosegek telepitese nem sikerult. A fenti uzenetet kuldd el.
pause
exit /b 1

:packfail
echo.
echo [HIBA] Nem jott letre a "Projekt Hub.exe".
echo A fenti uzenetet kuldd el a chatben.
pause
exit /b 1
