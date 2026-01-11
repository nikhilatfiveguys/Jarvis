# Create a single .exe installer for Jarvis using IExpress
$sourceDir = "dist\win-unpacked"
$outputExe = "$env:USERPROFILE\Downloads\Jarvis-6.0-Setup.exe"
$tempDir = "$env:TEMP\Jarvis-Installer"
$sedFile = "$env:TEMP\jarvis-installer.sed"

# Clean up temp directory
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Copy all files to temp directory
Write-Host "Copying files..." -ForegroundColor Cyan
Copy-Item "$sourceDir\*" -Destination $tempDir -Recurse -Force

# Create IExpress SED file
$sedContent = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackageType=InstallSelfExtractor
ShowInstallProgramWindow=1
HideExtractAnimation=0
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%AppName% Setup
DisplayLicense=
FinishMessage=Installation complete!
TargetName=$outputExe
FriendlyName=Jarvis 6.0 Setup
AppLaunched=setup.bat
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
SourceFiles=@
[Strings]
AppName=Jarvis 6.0
FILE0="setup.bat"
[SourceFiles]
SourceFiles0=$tempDir\
[SourceFiles0]
"@

# Create setup.bat that will run after extraction
$setupBat = @"
@echo off
echo Installing Jarvis 6.0...
set INSTALL_DIR=%LOCALAPPDATA%\Jarvis-6.0
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
xcopy /E /I /Y "%TEMP%\Jarvis-Installer\*" "%INSTALL_DIR%\"
echo Creating desktop shortcut...
powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; `$Shortcut = `$WshShell.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Jarvis 6.0.lnk'); `$Shortcut.TargetPath = '%INSTALL_DIR%\Jarvis 6.0.exe'; `$Shortcut.WorkingDirectory = '%INSTALL_DIR%'; `$Shortcut.Save()"
echo Installation complete!
start "" "%INSTALL_DIR%\Jarvis 6.0.exe"
"@

Set-Content -Path "$tempDir\setup.bat" -Value $setupBat

# Add all files to SED
$files = Get-ChildItem -Path $tempDir -Recurse -File
$fileList = ""
foreach ($file in $files) {
    $relativePath = $file.FullName.Replace($tempDir + "\", "")
    $fileList += "`"$relativePath`"`r`n"
}

$sedContent = $sedContent -replace "@", $fileList
$sedContent += "`r`n"

# Write SED file
Set-Content -Path $sedFile -Value $sedContent

Write-Host "Creating installer..." -ForegroundColor Cyan
# Use IExpress to create the installer
$iexpressPath = "$env:SystemRoot\System32\iexpress.exe"
& $iexpressPath /N $sedFile

if (Test-Path $outputExe) {
    Write-Host "`nSuccess! Installer created:" -ForegroundColor Green
    Write-Host $outputExe -ForegroundColor Yellow
    $size = (Get-Item $outputExe).Length / 1MB
    Write-Host "Size: $([math]::Round($size, 2)) MB" -ForegroundColor Cyan
} else {
    Write-Host "`nFailed to create installer. Trying alternative method..." -ForegroundColor Red
    
    # Alternative: Create a simple self-extracting archive using PowerShell
    Write-Host "Creating self-extracting archive..." -ForegroundColor Cyan
    $sfxScript = @"
`$ErrorActionPreference = 'Stop'
`$extractPath = `$env:LOCALAPPDATA + '\Jarvis-6.0'
Write-Host 'Extracting Jarvis 6.0...' -ForegroundColor Cyan
if (-not (Test-Path `$extractPath)) { New-Item -ItemType Directory -Path `$extractPath | Out-Null }
Expand-Archive -Path `$PSScriptRoot\app.zip -DestinationPath `$extractPath -Force
Write-Host 'Creating desktop shortcut...' -ForegroundColor Cyan
`$WshShell = New-Object -ComObject WScript.Shell
`$Shortcut = `$WshShell.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Jarvis 6.0.lnk')
`$Shortcut.TargetPath = `"`$extractPath\Jarvis 6.0.exe`"
`$Shortcut.WorkingDirectory = `$extractPath
`$Shortcut.Save()
Write-Host 'Installation complete!' -ForegroundColor Green
Start-Process `"`$extractPath\Jarvis 6.0.exe`"
"@
    
    # Create zip first
    $zipPath = "$tempDir\app.zip"
    Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force
    
    # Combine script and zip into single exe
    $sfxPath = "$env:USERPROFILE\Downloads\Jarvis-6.0-Setup.exe"
    $sfxContent = [System.Text.Encoding]::UTF8.GetBytes($sfxScript)
    $zipContent = [System.IO.File]::ReadAllBytes($zipPath)
    
    # Create a simple batch file that extracts and runs
    $batchContent = @"
@echo off
setlocal
set INSTALL_DIR=%LOCALAPPDATA%\Jarvis-6.0
echo Installing Jarvis 6.0 to %INSTALL_DIR%...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
powershell -Command "Expand-Archive -Path '%~f0' -DestinationPath '%INSTALL_DIR%' -Force" 2>nul
echo Creating shortcuts...
powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Jarvis 6.0.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\Jarvis 6.0.exe'; $Shortcut.WorkingDirectory = '%INSTALL_DIR%'; $Shortcut.Save()"
start "" "%INSTALL_DIR%\Jarvis 6.0.exe"
goto :eof
"@
    
    # This approach won't work well. Let me use 7-Zip SFX if available, or create a simpler solution.
    Write-Host "Creating portable installer..." -ForegroundColor Cyan
    
    # Simple solution: Create a batch file that extracts a zip
    $installerBat = "$env:USERPROFILE\Downloads\Jarvis-6.0-Installer.bat"
    $zipForInstaller = "$env:USERPROFILE\Downloads\Jarvis-6.0-Files.zip"
    Compress-Archive -Path "$tempDir\*" -DestinationPath $zipForInstaller -Force
    
    $installerScript = @"
@echo off
setlocal
set INSTALL_DIR=%LOCALAPPDATA%\Jarvis-6.0
echo Installing Jarvis 6.0...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
powershell -Command "Expand-Archive -Path '%~dp0Jarvis-6.0-Files.zip' -DestinationPath '%INSTALL_DIR%' -Force"
echo Creating desktop shortcut...
powershell -Command "$WshShell = New-Object -ComObject WScript.Shell; $Shortcut = $WshShell.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Jarvis 6.0.lnk'); $Shortcut.TargetPath = '%INSTALL_DIR%\Jarvis 6.0.exe'; $Shortcut.WorkingDirectory = '%INSTALL_DIR%'; $Shortcut.Save()"
echo Installation complete!
start "" "%INSTALL_DIR%\Jarvis 6.0.exe"
"@
    
    Set-Content -Path $installerBat -Value $installerScript
    Write-Host "`nCreated installer files:" -ForegroundColor Green
    Write-Host "  Installer: $installerBat" -ForegroundColor Yellow
    Write-Host "  Files: $zipForInstaller" -ForegroundColor Yellow
    Write-Host "`nNote: These are two files. For a single .exe, you'll need 7-Zip SFX or to run as Administrator." -ForegroundColor Yellow
}

# Cleanup
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $sedFile -ErrorAction SilentlyContinue


