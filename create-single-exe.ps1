# Create a single self-extracting .exe installer for Jarvis
$sourceDir = "dist\win-unpacked"
$outputExe = "$env:USERPROFILE\Downloads\Jarvis-6.0-Setup.exe"
$tempDir = "$env:TEMP\Jarvis-SFX-$(Get-Random)"
$zipPath = "$tempDir\app.zip"

# Clean up
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

Write-Host "Creating self-extracting installer..." -ForegroundColor Cyan

# Create zip file
Write-Host "Compressing files..." -ForegroundColor Yellow
Compress-Archive -Path "$sourceDir\*" -DestinationPath $zipPath -Force

# Read zip content and convert to base64
$zipBytes = [System.IO.File]::ReadAllBytes($zipPath)
$zipBase64 = [System.Convert]::ToBase64String($zipBytes)

# Create PowerShell installer script
$installScript = @"
`$ErrorActionPreference = 'Stop'
`$extractPath = `$env:LOCALAPPDATA + '\Jarvis-6.0'
Write-Host 'Installing Jarvis 6.0...' -ForegroundColor Cyan

`$zipData = '$zipBase64'

`$tempZip = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'Jarvis-Install-' + [System.Guid]::NewGuid().ToString() + '.zip')
[System.IO.File]::WriteAllBytes(`$tempZip, [System.Convert]::FromBase64String(`$zipData))

if (-not (Test-Path `$extractPath)) { New-Item -ItemType Directory -Path `$extractPath | Out-Null }
Expand-Archive -Path `$tempZip -DestinationPath `$extractPath -Force
Remove-Item `$tempZip

Write-Host 'Creating shortcuts...' -ForegroundColor Yellow
`$WshShell = New-Object -ComObject WScript.Shell
`$Shortcut = `$WshShell.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Jarvis 6.0.lnk')
`$Shortcut.TargetPath = "`$extractPath\Jarvis 6.0.exe"
`$Shortcut.WorkingDirectory = `$extractPath
`$Shortcut.IconLocation = "`$extractPath\Jarvis 6.0.exe,0"
`$Shortcut.Save()

`$startMenuPath = [Environment]::GetFolderPath('Programs') + '\Jarvis 6.0'
if (-not (Test-Path `$startMenuPath)) { New-Item -ItemType Directory -Path `$startMenuPath | Out-Null }
`$StartShortcut = `$WshShell.CreateShortcut("`$startMenuPath\Jarvis 6.0.lnk")
`$StartShortcut.TargetPath = "`$extractPath\Jarvis 6.0.exe"
`$StartShortcut.WorkingDirectory = `$extractPath
`$StartShortcut.IconLocation = "`$extractPath\Jarvis 6.0.exe,0"
`$StartShortcut.Save()

Write-Host 'Installation complete!' -ForegroundColor Green
Start-Process "`$extractPath\Jarvis 6.0.exe"
"@

# Save as PowerShell script
$ps1Path = "$env:USERPROFILE\Downloads\Jarvis-6.0-Setup.ps1"
Set-Content -Path $ps1Path -Value $installScript

# Create a batch file that runs the PowerShell script
$batContent = @"
@echo off
title Jarvis 6.0 Installer
powershell -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File "%~dp0Jarvis-6.0-Setup.ps1"
"@

$batPath = "$env:USERPROFILE\Downloads\Jarvis-6.0-Setup.bat"
Set-Content -Path $batPath -Value $batContent

# Try to use ps2exe if available to create a real .exe
if (Get-Command ps2exe -ErrorAction SilentlyContinue) {
    Write-Host "Converting to .exe using ps2exe..." -ForegroundColor Yellow
    ps2exe -inputFile $ps1Path -outputFile $outputExe -iconFile "icon.ico" -noConsole
    if (Test-Path $outputExe) {
        Write-Host "`nSuccess! Created single .exe installer:" -ForegroundColor Green
        Write-Host $outputExe -ForegroundColor Yellow
        $size = (Get-Item $outputExe).Length / 1MB
        Write-Host "Size: $([math]::Round($size, 2)) MB" -ForegroundColor Cyan
        Remove-Item $ps1Path -ErrorAction SilentlyContinue
        Remove-Item $batPath -ErrorAction SilentlyContinue
    }
} else {
    Write-Host "`nps2exe not found. Install it with: Install-Module -Name ps2exe -Force" -ForegroundColor Yellow
    Write-Host "`nFor now, created installer files:" -ForegroundColor Green
    Write-Host "  Batch installer: $batPath" -ForegroundColor Yellow
    Write-Host "  Script file: $ps1Path" -ForegroundColor Yellow
    Write-Host "`nTo create a true .exe, either:" -ForegroundColor Cyan
    Write-Host "  1. Install ps2exe: Install-Module -Name ps2exe -Force" -ForegroundColor White
    Write-Host "  2. Or run electron-builder as Administrator to create NSIS installer" -ForegroundColor White
}

# Cleanup
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

Write-Host "`nDone!" -ForegroundColor Green


