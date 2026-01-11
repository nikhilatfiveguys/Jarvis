# Build a single .exe installer for Jarvis
$sourceDir = "dist\win-unpacked"
$outputExe = "dist\Jarvis-6.0-Setup.exe"
$tempDir = "$env:TEMP\Jarvis-Installer-$(Get-Random)"
$zipPath = "$tempDir\app.zip"

Write-Host "Building single-click installer..." -ForegroundColor Cyan

# Clean up
if (Test-Path $tempDir) { Remove-Item $tempDir -Recurse -Force }
New-Item -ItemType Directory -Path $tempDir | Out-Null

# Verify source exists
if (-not (Test-Path $sourceDir)) {
    Write-Host "ERROR: Source directory not found: $sourceDir" -ForegroundColor Red
    Write-Host "Please run the build first to create win-unpacked folder." -ForegroundColor Yellow
    exit 1
}

# Create zip file
Write-Host "Compressing application files..." -ForegroundColor Yellow
Compress-Archive -Path "$sourceDir\*" -DestinationPath $zipPath -Force

# Read zip content and convert to base64
$zipBytes = [System.IO.File]::ReadAllBytes($zipPath)
$zipBase64 = [System.Convert]::ToBase64String($zipBytes)

# Create the installer script
$installerScript = @'
# Jarvis 6.0 Installer
# Self-extracting installer script

$ErrorActionPreference = 'Stop'

# Show installation window
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Jarvis 6.0 Installer"
$form.Size = New-Object System.Drawing.Size(500, 300)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false

$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(20, 20)
$label.Size = New-Object System.Drawing.Size(440, 200)
$label.Text = "Installing Jarvis 6.0...`n`nPlease wait while the application is being installed."
$label.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$form.Controls.Add($label)

$progressBar = New-Object System.Windows.Forms.ProgressBar
$progressBar.Location = New-Object System.Drawing.Point(20, 230)
$progressBar.Size = New-Object System.Drawing.Size(440, 23)
$progressBar.Style = "Marquee"
$progressBar.MarqueeAnimationSpeed = 50
$form.Controls.Add($progressBar)

$form.Show()
$form.Refresh()
[System.Windows.Forms.Application]::DoEvents()

try {
    $extractPath = $env:LOCALAPPDATA + '\Jarvis-6.0'
    $label.Text = "Installing Jarvis 6.0...`n`nExtracting files..."
    $form.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
    
    # Embedded zip data
    $zipData = '@ZIP_DATA@'
    
    # Extract to temp location first
    $tempZip = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'Jarvis-Install-' + [System.Guid]::NewGuid().ToString() + '.zip')
    [System.IO.File]::WriteAllBytes($tempZip, [System.Convert]::FromBase64String($zipData))
    
    $label.Text = "Installing Jarvis 6.0...`n`nInstalling application files..."
    $form.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
    
    # Close any running instances of Jarvis
    Get-Process | Where-Object { $_.ProcessName -like "*Jarvis*" -or $_.MainWindowTitle -like "*Jarvis*" } | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
    
    # Remove existing installation if it exists (to avoid permission issues)
    if (Test-Path $extractPath) {
        $label.Text = "Installing Jarvis 6.0...`n`nRemoving previous installation..."
        $form.Refresh()
        [System.Windows.Forms.Application]::DoEvents()
        
        # Try to remove with retries
        $retries = 3
        $removed = $false
        while ($retries -gt 0 -and -not $removed) {
            try {
                # Kill any processes that might be locking files
                Get-Process | Where-Object { $_.Path -like "*Jarvis*" } | Stop-Process -Force -ErrorAction SilentlyContinue
                Start-Sleep -Milliseconds 300
                
                Remove-Item -Path $extractPath -Recurse -Force -ErrorAction Stop
                $removed = $true
            } catch {
                $retries--
                if ($retries -gt 0) {
                    Start-Sleep -Milliseconds 500
                }
            }
        }
        
        if (-not $removed) {
            throw "Could not remove existing installation. Please close Jarvis and try again."
        }
    }
    
    # Create install directory
    New-Item -ItemType Directory -Path $extractPath -Force | Out-Null
    
    # Extract with retry logic for locked files
    $retries = 3
    $extracted = $false
    while ($retries -gt 0 -and -not $extracted) {
        try {
            Expand-Archive -Path $tempZip -DestinationPath $extractPath -Force -ErrorAction Stop
            $extracted = $true
        } catch {
            $retries--
            if ($retries -gt 0) {
                # Kill any processes that might have started
                Get-Process | Where-Object { $_.Path -like "*Jarvis*" } | Stop-Process -Force -ErrorAction SilentlyContinue
                Start-Sleep -Milliseconds 500
            } else {
                throw "Failed to extract files: $($_.Exception.Message). Please ensure Jarvis is not running and try again."
            }
        }
    }
    
    Remove-Item $tempZip -ErrorAction SilentlyContinue
    
    $label.Text = "Installing Jarvis 6.0...`n`nCreating shortcuts..."
    $form.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
    
    # Create desktop shortcut
    $WshShell = New-Object -ComObject WScript.Shell
    $Shortcut = $WshShell.CreateShortcut([Environment]::GetFolderPath('Desktop') + '\Jarvis 6.0.lnk')
    $Shortcut.TargetPath = "$extractPath\Jarvis 6.0.exe"
    $Shortcut.WorkingDirectory = $extractPath
    $Shortcut.IconLocation = "$extractPath\Jarvis 6.0.exe,0"
    $Shortcut.Description = "Jarvis 6.0 - AI-powered overlay assistant"
    $Shortcut.Save()
    
    # Create start menu shortcut
    $startMenuPath = [Environment]::GetFolderPath('Programs') + '\Jarvis 6.0'
    if (-not (Test-Path $startMenuPath)) { 
        New-Item -ItemType Directory -Path $startMenuPath | Out-Null 
    }
    $StartShortcut = $WshShell.CreateShortcut("$startMenuPath\Jarvis 6.0.lnk")
    $StartShortcut.TargetPath = "$extractPath\Jarvis 6.0.exe"
    $StartShortcut.WorkingDirectory = $extractPath
    $StartShortcut.IconLocation = "$extractPath\Jarvis 6.0.exe,0"
    $StartShortcut.Description = "Jarvis 6.0 - AI-powered overlay assistant"
    $StartShortcut.Save()
    
    $label.Text = "Installation Complete!`n`nJarvis 6.0 has been successfully installed.`n`nClick OK to launch the application."
    $progressBar.Style = "Continuous"
    $progressBar.Value = 100
    $form.Refresh()
    [System.Windows.Forms.Application]::DoEvents()
    
    # Show completion message
    [System.Windows.Forms.MessageBox]::Show("Jarvis 6.0 has been successfully installed!", "Installation Complete", "OK", "Information")
    
    # Launch the application
    Start-Process "$extractPath\Jarvis 6.0.exe"
    
    $form.Close()
} catch {
    $form.Close()
    [System.Windows.Forms.MessageBox]::Show("An error occurred during installation: $($_.Exception.Message)", "Installation Error", "OK", "Error")
    exit 1
}
'@

# Replace the placeholder with actual zip data
$installerScript = $installerScript -replace '@ZIP_DATA@', $zipBase64

# Save as PowerShell script
$ps1Path = "$tempDir\installer.ps1"
Set-Content -Path $ps1Path -Value $installerScript -Encoding UTF8

# Try to convert to .exe using ps2exe if available
if (Get-Command ps2exe -ErrorAction SilentlyContinue) {
    Write-Host "Converting to .exe using ps2exe..." -ForegroundColor Yellow
    if (Test-Path "icon.ico") {
        ps2exe -inputFile $ps1Path -outputFile $outputExe -iconFile "icon.ico" -noConsole -title "Jarvis 6.0 Installer"
    } else {
        ps2exe -inputFile $ps1Path -outputFile $outputExe -noConsole -title "Jarvis 6.0 Installer"
    }
    
    if (Test-Path $outputExe) {
        Write-Host "`nSuccess! Created installer:" -ForegroundColor Green
        Write-Host $outputExe -ForegroundColor Yellow
        $size = (Get-Item $outputExe).Length / 1MB
        Write-Host "Size: $([math]::Round($size, 2)) MB" -ForegroundColor Cyan
        
        # Copy to Downloads
        $downloadsPath = [Environment]::GetFolderPath('UserProfile') + '\Downloads'
        $destPath = Join-Path $downloadsPath "Jarvis-6.0-Setup.exe"
        Copy-Item $outputExe -Destination $destPath -Force
        Write-Host "`nAlso copied to: $destPath" -ForegroundColor Green
        exit 0
    }
}

# If ps2exe not available, create a batch wrapper that looks like an exe
Write-Host "ps2exe not found. Creating alternative installer..." -ForegroundColor Yellow

# Create a VBScript that runs PowerShell invisibly
$vbsContent = @"
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "powershell.exe -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -File """ & WScript.ScriptFullName & ".ps1""", 0, False
Set WshShell = Nothing
"@

$vbsPath = "$tempDir\installer.vbs"
Set-Content -Path $vbsPath -Value $vbsContent

# Copy both files and create a simple launcher
# Actually, let's create a better solution - a compiled batch to exe or use IExpress

Write-Host "`nFor a true .exe installer, please install ps2exe:" -ForegroundColor Yellow
Write-Host "  Install-Module -Name ps2exe -Force -Scope CurrentUser" -ForegroundColor White
Write-Host "`nOr run electron-builder as Administrator to create NSIS installer." -ForegroundColor Yellow

# Cleanup
Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue

