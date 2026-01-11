# Script to build Jarvis installer - run this as Administrator
Write-Host "Building Jarvis 6.0 Windows Installer..." -ForegroundColor Cyan
Write-Host "This script should be run as Administrator" -ForegroundColor Yellow
Write-Host ""

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ERROR: This script must be run as Administrator!" -ForegroundColor Red
    Write-Host "Right-click PowerShell and select 'Run as Administrator', then run this script again." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Or, you can run this command directly:" -ForegroundColor Cyan
    Write-Host "  npm run build:win:unsigned" -ForegroundColor White
    pause
    exit 1
}

Write-Host "Running build command..." -ForegroundColor Green
npm run build:win:unsigned

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "Build successful! Looking for installer..." -ForegroundColor Green
    
    # Find the installer
    $installer = Get-ChildItem -Path "dist" -Filter "*.exe" -Recurse | Where-Object { $_.Name -like "*Setup*" -or $_.Name -like "*Jarvis*" } | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    
    if ($installer) {
        Write-Host ""
        Write-Host "Installer created: $($installer.FullName)" -ForegroundColor Green
        $size = $installer.Length / 1MB
        Write-Host "Size: $([math]::Round($size, 2)) MB" -ForegroundColor Cyan
        
        # Copy to Downloads
        $downloadsPath = [Environment]::GetFolderPath('UserProfile') + '\Downloads'
        $destPath = Join-Path $downloadsPath $installer.Name
        Copy-Item $installer.FullName -Destination $destPath -Force
        Write-Host ""
        Write-Host "Copied to Downloads: $destPath" -ForegroundColor Green
    } else {
        Write-Host "Installer not found in dist folder. Check dist\ folder for output." -ForegroundColor Yellow
    }
} else {
    Write-Host ""
    Write-Host "Build failed. Check the error messages above." -ForegroundColor Red
}


