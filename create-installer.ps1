# Create a single .exe installer for Jarvis using IExpress
$sourceDir = "dist\win-unpacked"
$downloadsPath = [Environment]::GetFolderPath("UserProfile") + "\Downloads"
$installerExe = Join-Path $downloadsPath "Jarvis-6.0-Setup.exe"

# Create a temporary directory for the installer package
$tempDir = "$env:TEMP\Jarvis-Installer"
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Copy all files to temp directory
Write-Host "Preparing files for installer..."
Copy-Item "$sourceDir\*" -Destination $tempDir -Recurse -Force

# Create a batch file that will extract and run
$installScript = @"
@echo off
setlocal enabledelayedexpansion

echo Installing Jarvis 6.0...
echo.

set "INSTALL_DIR=%LOCALAPPDATA%\Jarvis-6.0"
if exist "!INSTALL_DIR!" (
    echo Removing old installation...
    rmdir /s /q "!INSTALL_DIR!"
)

echo Creating installation directory...
mkdir "!INSTALL_DIR!" 2>nul

echo Extracting files...
xcopy /E /I /Y "%~dp0*" "!INSTALL_DIR!\" >nul

echo Creating desktop shortcut...
set "DESKTOP=%USERPROFILE%\Desktop"
set "SHORTCUT=!DESKTOP!\Jarvis 6.0.lnk"

powershell -Command "$"ws = New-Object -ComObject WScript.Shell; $"s = $"ws.CreateShortcut('!SHORTCUT!'); $"s.TargetPath = '!INSTALL_DIR!\Jarvis 6.0.exe'; $"s.WorkingDirectory = '!INSTALL_DIR!'; $"s.IconLocation = '!INSTALL_DIR!\Jarvis 6.0.exe,0'; $"s.Save()" 2>nul

echo.
echo Installation complete!
echo.
echo Starting Jarvis 6.0...
start "" "!INSTALL_DIR!\Jarvis 6.0.exe"

timeout /t 2 >nul
exit
"@

Set-Content -Path "$tempDir\install.bat" -Value $installScript

# Create IExpress SED file
$sedContent = @"
[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=0
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=N
InstallPrompt=%AppName% Setup
DisplayLicense=
FinishMessage=Installation complete! Jarvis 6.0 has been installed and will now launch.
TargetName=$installerExe
FriendlyName=Jarvis 6.0 Setup
AppLaunched=install.bat
PostInstallCmd=<None>
AdminQuietInstaller=
UserQuietInstaller=
SourceFiles=$tempDir
[Strings]
AppName=Jarvis 6.0
"@

$sedFile = "$env:TEMP\jarvis-installer.sed"
Set-Content -Path $sedFile -Value $sedContent

Write-Host "Creating installer using IExpress..."
Write-Host "This may take a few minutes..."

# Use IExpress to create the installer
$iexpressPath = "$env:SystemRoot\System32\iexpress.exe"
$process = Start-Process -FilePath $iexpressPath -ArgumentList "/N", $sedFile -Wait -PassThru -NoNewWindow

if ($process.ExitCode -eq 0 -and (Test-Path $installerExe)) {
    Write-Host ""
    Write-Host "Success! Installer created:" -ForegroundColor Green
    Write-Host $installerExe -ForegroundColor Cyan
    $fileInfo = Get-Item $installerExe
    Write-Host "Size: $([math]::Round($fileInfo.Length / 1MB, 2)) MB" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "The installer is ready in your Downloads folder!" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "IExpress method failed. Trying alternative method..." -ForegroundColor Yellow
    
    # Alternative: Create a simple self-extracting PowerShell script
    $ps1Installer = @'
# Jarvis 6.0 Installer
$ErrorActionPreference = 'Stop'

Write-Host "Installing Jarvis 6.0..." -ForegroundColor Cyan
Write-Host ""

$installDir = "$env:LOCALAPPDATA\Jarvis-6.0"
if (Test-Path $installDir) {
    Write-Host "Removing old installation..."
    Remove-Item $installDir -Recurse -Force
}

Write-Host "Creating installation directory..."
New-Item -ItemType Directory -Path $installDir -Force | Out-Null

Write-Host "Extracting files..."
$zipPath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), "Jarvis-Installer.zip")
$embeddedZip = $MyInvocation.MyCommand.Definition -replace '\.ps1$', '.zip'

if (Test-Path $embeddedZip) {
    Copy-Item $embeddedZip $zipPath -Force
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zipPath, $installDir)
    Remove-Item $zipPath
} else {
    Write-Host "Error: Could not find embedded files" -ForegroundColor Red
    pause
    exit 1
}

Write-Host "Creating desktop shortcut..."
$desktop = [Environment]::GetFolderPath("Desktop")
$shortcut = Join-Path $desktop "Jarvis 6.0.lnk"
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($shortcut)
$s.TargetPath = Join-Path $installDir "Jarvis 6.0.exe"
$s.WorkingDirectory = $installDir
$s.IconLocation = "$($s.TargetPath),0"
$s.Save()

Write-Host ""
Write-Host "Installation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "Starting Jarvis 6.0..."
Start-Process (Join-Path $installDir "Jarvis 6.0.exe")
'@

    # Create zip first
    $zipPath = "$env:TEMP\Jarvis-Installer.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force
    
    Write-Host "Created installer components. For a true .exe, you'll need to:" -ForegroundColor Yellow
    Write-Host "1. Use a tool like PS2EXE to convert the PowerShell script to .exe" -ForegroundColor Yellow
    Write-Host "2. Or run the build with Administrator privileges" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "For now, copying the packaged files to Downloads..." -ForegroundColor Yellow
    
    # Just copy the zip as a workaround
    Copy-Item $zipPath "$downloadsPath\Jarvis-6.0-Installer.zip" -Force
    Write-Host "Created: $downloadsPath\Jarvis-6.0-Installer.zip" -ForegroundColor Cyan
}

# Cleanup
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
if (Test-Path $sedFile) { Remove-Item $sedFile -Force -ErrorAction SilentlyContinue }

