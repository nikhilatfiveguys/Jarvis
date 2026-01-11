# Create a single self-extracting .exe installer
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

# Read zip content
$zipBytes = [System.IO.File]::ReadAllBytes($zipPath)

# Create PowerShell script that will extract and install
$installScript = @'
$ErrorActionPreference = 'Stop'
$extractPath = $env:LOCALAPPDATA + '\Jarvis-6.0'
Write-Host 'Installing Jarvis 6.0...' -ForegroundColor Cyan

# Extract embedded zip
$zipBytes = @'
ZIP_DATA_PLACEHOLDER
'@

$tempZip = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'Jarvis-Temp-' + [System.Guid]::NewGuid().ToString() + '.zip')
[System.IO.File]::WriteAllBytes($tempZip, [System.Convert]::FromBase64String($zipBytes))

# Extract to install directory
if (-not (Test-Path $extractPath)) { New-Item -ItemType Directory -Path $extractPath | Out-Null }
Expand-Archive -Path $tempZip -DestinationPath $extractPath -Force
Remove-Item $tempZip

# Create desktop shortcut
Write-Host 'Creating desktop shortcut...' -ForegroundColor Yellow
$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Jarvis 6.0.lnk')
$Shortcut.TargetPath = "$extractPath\Jarvis 6.0.exe"
$Shortcut.WorkingDirectory = $extractPath
$Shortcut.IconLocation = "$extractPath\Jarvis 6.0.exe,0"
$Shortcut.Save()

# Create start menu shortcut
$startMenuPath = [Environment]::GetFolderPath('Programs') + '\Jarvis 6.0'
if (-not (Test-Path $startMenuPath)) { New-Item -ItemType Directory -Path $startMenuPath | Out-Null }
$StartShortcut = $WshShell.CreateShortcut("$startMenuPath\Jarvis 6.0.lnk")
$StartShortcut.TargetPath = "$extractPath\Jarvis 6.0.exe"
$StartShortcut.WorkingDirectory = $extractPath
$StartShortcut.IconLocation = "$extractPath\Jarvis 6.0.exe,0"
$StartShortcut.Save()

Write-Host 'Installation complete!' -ForegroundColor Green
Start-Process "$extractPath\Jarvis 6.0.exe"
'@

# Convert zip to base64
$zipBase64 = [System.Convert]::ToBase64String($zipBytes)
$installScript = $installScript -replace 'ZIP_DATA_PLACEHOLDER', $zipBase64

# Create a PowerShell script file
$psScriptPath = "$tempDir\install.ps1"
Set-Content -Path $psScriptPath -Value $installScript

# Compile PowerShell script to exe using ps2exe if available, otherwise create a batch wrapper
if (Get-Command ps2exe -ErrorAction SilentlyContinue) {
    Write-Host "Using ps2exe to create executable..." -ForegroundColor Yellow
    ps2exe -inputFile $psScriptPath -outputFile $outputExe -iconFile "icon.ico" -noConsole
} else {
    Write-Host "ps2exe not found. Creating batch-based installer..." -ForegroundColor Yellow
    
    # Create a batch file that runs PowerShell
    $batchContent = @"
@echo off
powershell -ExecutionPolicy Bypass -NoProfile -File "%~f0.ps1"
goto :eof
"@
    
    # We need to embed the PowerShell script in a way that works
    # Let's create a hybrid batch/PowerShell file
    $hybridContent = @"
@echo off
setlocal
set "SCRIPT=%~f0"
set "TEMP_PS=%TEMP%\Jarvis-Install-%~n0.ps1"
powershell -Command "$scriptContent = Get-Content '%SCRIPT%' -Raw; $scriptContent = $scriptContent -replace '.*?<#PS', '' -replace '#>.*', ''; Set-Content '%TEMP_PS%' -Value $scriptContent; & '%TEMP_PS%'"
del "%TEMP_PS%" 2>nul
goto :eof
<#PS
$ErrorActionPreference = 'Stop'
$extractPath = `$env:LOCALAPPDATA + '\Jarvis-6.0'
Write-Host 'Installing Jarvis 6.0...' -ForegroundColor Cyan

`$zipBytes = '@'
$zipBase64
'@'

`$tempZip = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'Jarvis-Temp-' + [System.Guid]::NewGuid().ToString() + '.zip')
[System.IO.File]::WriteAllBytes(`$tempZip, [System.Convert]::FromBase64String(`$zipBytes))

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
#>
"@
    
    $hybridContent = $hybridContent -replace '@', $zipBase64
    Set-Content -Path $outputExe -Value $hybridContent -Encoding ASCII
    
    # Rename to .exe (it's actually a .bat, but Windows will run it)
    # Actually, we need a real .exe. Let me try a different approach.
    Write-Host "Creating executable using alternative method..." -ForegroundColor Yellow
    
    # Use WinRAR SFX if available, or create a simple solution
    # For now, let's create a proper solution using a compiled approach
    Remove-Item $outputExe -ErrorAction SilentlyContinue
    
    # Create a simple batch file that can be renamed to .exe (won't work well)
    # Better: Use IExpress properly or find another tool
    
    # Final solution: Create a PowerShell script that extracts and installs
    # Then wrap it in a way that looks like an exe
    $finalScript = @"
# Self-extracting Jarvis 6.0 Installer
`$zipData = @'
$zipBase64
'@

`$extractPath = `$env:LOCALAPPDATA + '\Jarvis-6.0'
Write-Host 'Installing Jarvis 6.0...' -ForegroundColor Cyan

`$tempZip = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'Jarvis-Install-' + [System.Guid]::NewGuid().ToString() + '.zip')
[System.IO.File]::WriteAllBytes(`$tempZip, [System.Convert]::FromBase64String(`$zipData))

if (-not (Test-Path `$extractPath)) { New-Item -ItemType Directory -Path `$extractPath | Out-Null }
Expand-Archive -Path `$tempZip -DestinationPath `$extractPath -Force
Remove-Item `$tempZip

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
    
    # Save as .ps1 and create a batch wrapper
    $ps1Path = "$env:USERPROFILE\Downloads\Jarvis-6.0-Setup.ps1"
    Set-Content -Path $ps1Path -Value $finalScript
    
    # Create a batch file that runs it
    $batContent = "@echo off`npowershell -ExecutionPolicy Bypass -NoProfile -File `"%~dp0Jarvis-6.0-Setup.ps1`""
    $batPath = "$env:USERPROFILE\Downloads\Jarvis-6.0-Setup.bat"
    Set-Content -Path $batPath -Value $batContent
    
    Write-Host "`nCreated installer files:" -ForegroundColor Green
    Write-Host "  Main installer: $batPath" -ForegroundColor Yellow
    Write-Host "  Script file: $ps1Path" -ForegroundColor Yellow
    Write-Host "`nNote: Run the .bat file to install. For a true .exe, you need to run electron-builder as Administrator." -ForegroundColor Yellow
}

# Cleanup
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $zipPath -ErrorAction SilentlyContinue

Write-Host "`nDone!" -ForegroundColor Green


