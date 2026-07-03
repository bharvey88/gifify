# gifify tray launcher (Windows).
# Runs the server hidden and lives in the system tray:
#   double-click = open gifify, right-click = Open / Output folder / Exit.
# Start via gifify-tray.vbs so no console window appears.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot   # repo root (this file lives in tray\)
$url = 'http://localhost:3111'

function Test-Gifify {
    try {
        (Invoke-RestMethod "$url/api/health" -TimeoutSec 2).ok -eq $true
    } catch { $false }
}

# --- single instance: if gifify already answers, just open the browser ---
if (Test-Gifify) {
    Start-Process $url
    exit 0
}

# --- first run: install dependencies (visible window so progress is obvious) ---
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    $install = Start-Process cmd -ArgumentList '/c', "cd /d `"$root`" && echo First run: installing gifify dependencies... && npm install" -Wait -PassThru
    if ($install.ExitCode -ne 0) {
        [System.Windows.Forms.MessageBox]::Show("npm install failed - run gifify.cmd to see the errors.", 'gifify') | Out-Null
        exit 1
    }
}

# --- start the server (hidden). Server opens the browser itself. ---
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
    [System.Windows.Forms.MessageBox]::Show("Node.js was not found. Install it from https://nodejs.org/", 'gifify') | Out-Null
    exit 1
}
$server = Start-Process $node -ArgumentList (Join-Path $root 'server\index.js') -WorkingDirectory $root -WindowStyle Hidden -PassThru

# --- tray icon ---
$icon = $null
try { $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($node) } catch {}
if (-not $icon) { $icon = [System.Drawing.SystemIcons]::Application }

$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = $icon
$notify.Text = 'gifify - localhost:3111'
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip

$openItem = $menu.Items.Add('Open gifify')
$openItem.Font = New-Object System.Drawing.Font($openItem.Font, [System.Drawing.FontStyle]::Bold)
$openItem.add_Click({ Start-Process $url })

$folderItem = $menu.Items.Add('Open output folder')
$folderItem.add_Click({
    $outputDir = Join-Path $env:USERPROFILE 'Downloads'
    if (-not (Test-Path $outputDir)) { $outputDir = Join-Path $root 'output' }
    $cfg = Join-Path $env:USERPROFILE '.gifify.json'
    if (Test-Path $cfg) {
        try {
            $saved = (Get-Content $cfg -Raw | ConvertFrom-Json).outputDir
            if ($saved) { $outputDir = $saved }
        } catch {}
    }
    if (-not (Test-Path $outputDir)) { New-Item -ItemType Directory -Force $outputDir | Out-Null }
    Start-Process explorer.exe $outputDir
})

$menu.Items.Add('-') | Out-Null

$exitItem = $menu.Items.Add('Exit')
$exitItem.add_Click({
    $notify.Visible = $false
    # /T kills the whole tree, including any ffmpeg mid-conversion
    Start-Process taskkill -ArgumentList '/PID', $server.Id, '/T', '/F' -WindowStyle Hidden -Wait
    [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu
$notify.add_DoubleClick({ Start-Process $url })

# If the server dies on its own (crash, port conflict), don't leave a zombie icon.
$watcher = New-Object System.Windows.Forms.Timer
$watcher.Interval = 3000
$watcher.add_Tick({
    if ($server.HasExited) {
        $watcher.Stop()
        $notify.Visible = $false
        [System.Windows.Forms.MessageBox]::Show("The gifify server stopped unexpectedly. Run gifify.cmd to see the error.", 'gifify') | Out-Null
        [System.Windows.Forms.Application]::Exit()
    }
})
$watcher.Start()

$notify.ShowBalloonTip(3000, 'gifify is running', 'Right-click the tray icon to exit.', [System.Windows.Forms.ToolTipIcon]::Info)

[System.Windows.Forms.Application]::Run((New-Object System.Windows.Forms.ApplicationContext))

$notify.Dispose()
