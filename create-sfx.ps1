# Create a self-extracting archive that runs Jarvis automatically
$downloadsPath = [Environment]::GetFolderPath("UserProfile") + "\Downloads"
$sourceDir = "dist\win-unpacked"
$tempDir = "$env:TEMP\Jarvis-SFX"
$sfxExe = Join-Path $downloadsPath "Jarvis-6.0-Setup.exe"

# Clean up
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Copy all files
Write-Host "Copying files..."
Copy-Item "$sourceDir\*" -Destination $tempDir -Recurse -Force

# Create a launcher script
$launcherScript = @"
@echo off
cd /d "%~dp0"
start "" "Jarvis 6.0.exe"
"@
Set-Content -Path "$tempDir\RunJarvis.bat" -Value $launcherScript

# Create installer script
$installerScript = @"
`$ErrorActionPreference = 'Stop'
`$extractPath = `$env:LOCALAPPDATA + '\Jarvis-6.0'
Write-Host 'Extracting Jarvis 6.0...' -ForegroundColor Cyan

# Extract files
`$zipPath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'Jarvis-Temp.zip')
[System.IO.File]::WriteAllBytes(`$zipPath, [System.Convert]::FromBase64String('BASE64_ZIP_DATA'))

Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory(`$zipPath, `$extractPath)
Remove-Item `$zipPath

# Run the app
Start-Process (Join-Path `$extractPath 'Jarvis 6.0.exe')
"@

# Create ZIP first
$zipPath = "$env:TEMP\Jarvis-Temp.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
Compress-Archive -Path "$tempDir\*" -DestinationPath $zipPath -Force

Write-Host "ZIP created: $zipPath"
Write-Host "Size: $([math]::Round((Get-Item $zipPath).Length / 1MB, 2)) MB"

# Note: To create a true single .exe, you'd need a tool like IExpress, WinRAR SFX, or 7-Zip SFX
# For now, the best solution is the Windows installer from electron-builder
Write-Host "`nTo create a single .exe installer, you need to:"
Write-Host "1. Build the Windows installer with: npm run build:win:unsigned (as Administrator)"
Write-Host "2. Or use a tool like 7-Zip SFX or WinRAR to create a self-extracting archive"
Write-Host "`nThe installer .exe will be in: dist\Jarvis-6.0 Setup x.x.x.exe"

