# NeuroPause Gate 20 — Windows runtime acceptance runner (rc.20).
# Runs on the installed Win11 ARM64 guest, in the interactive desktop session
# (so the Electron window really renders). Emits C:\gate20\gate20.out and copies
# the app.log bundle beside it.
$ErrorActionPreference = 'Continue'
$work = 'C:\gate20'; New-Item -ItemType Directory -Force -Path $work | Out-Null
$out = Join-Path $work 'gate20.out'
Remove-Item $out -ErrorAction SilentlyContinue
function Say($m){ $m | Out-File -FilePath $out -Append -Encoding ascii; Write-Host $m }

$installer = Join-Path $work 'np.exe'
$expected  = 'E861228F2AF873A8D67036FBB0407A6E8ACAB07F3BB5B6F009815F824AC8BC90'

Say "== GATE 20 ACCEPTANCE (rc.20) =="
$os = Get-CimInstance Win32_OperatingSystem
Say ("host=" + $env:COMPUTERNAME + " os=" + $os.Caption + " arch=" + $os.OSArchitecture + " build=" + $os.Version)

# --- Provenance: SHA-256 of the installer BEFORE install ---
$h = (Get-FileHash $installer -Algorithm SHA256).Hash
Say "installer.sha256=$h"
Say ("sha256.match=" + ($h -ieq $expected))

# --- Silent install (NSIS per-user) ---
Say "installing..."
Start-Process -FilePath $installer -ArgumentList '/S' -Wait
Start-Sleep -Seconds 10
$exe = Get-ChildItem "$env:LOCALAPPDATA\Programs","$env:ProgramFiles","${env:ProgramFiles(x86)}" -Recurse -Filter 'NeuroPause.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $exe) { Say "INSTALL_FAILED: NeuroPause.exe not found"; return }
Say ("installed.exe=" + $exe.FullName)

$bi = Join-Path $exe.DirectoryName 'resources\build-info.json'
if (Test-Path $bi) {
  $info = Get-Content $bi -Raw | ConvertFrom-Json
  Say ("build-info: version=" + $info.version + " commit=" + $info.commit + " dirty=" + $info.dirty + " channel=" + $info.channel)
}

$appdata = Join-Path $env:APPDATA 'NeuroPause'
$log = Join-Path $appdata 'logs\app.log'
# Launch on the INTERACTIVE desktop session via a logon-scoped scheduled task,
# so the Electron window really renders even when this runner is invoked from a
# non-interactive SSH session. "Run only when user is logged on" (no /ru) makes
# schtasks /run start it inside accept's active session.
function Launch($sec){
  & schtasks /create /tn npq /tr ('"' + $exe.FullName + '"') /sc once /st 23:59 /f | Out-Null
  & schtasks /run /tn npq | Out-Null
  Start-Sleep -Seconds $sec
}
function Quit(){
  Get-Process NeuroPause -ErrorAction SilentlyContinue | ForEach-Object { $_.CloseMainWindow() | Out-Null }
  Start-Sleep -Seconds 6
  Get-Process NeuroPause -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}
function Grep($p){ if(Test-Path $log){ (Select-String -Path $log -Pattern $p -AllMatches -ErrorAction SilentlyContinue).Count } else { -1 } }
function Last($p){ if(Test-Path $log){ (Select-String -Path $log -Pattern $p -ErrorAction SilentlyContinue | Select-Object -Last 1).Line } }

# --- B1: first launch, fresh profile ---
Say "`n-- FIRST LAUNCH (fresh profile) --"
if (Test-Path $appdata) { Rename-Item $appdata "$appdata.pre" -Force -ErrorAction SilentlyContinue }
Launch 35; Quit
if (-not (Test-Path $log)) { Say "APPLOG_NOT_WRITTEN"; return }
Copy-Item $log (Join-Path $work 'app.first.log') -Force
Say ("startup.complete=" + (Grep 'Startup complete'))
Say ("secure.ipc=" + (Last 'Secure IPC handlers registered'))
Say ("org.runtime.ready=" + (Last 'Organization runtime ready'))
Say ("ai.engine=" + (Last 'AI engine configured'))
Say ("tenant.recovered=" + (Grep 'Tenant resolution RECOVERED'))
Say ("shutdown.flush=" + (Last 'Shutdown flush complete'))
Say ("no.handler.errors=" + (Grep 'no handler registered'))
Say ("runtime.init.fail=" + (Grep 'Runtime core failed to initialize'))

# --- B8: repeated launch x5 (IPC race watch) ---
Say "`n-- REPEATED LAUNCH x5 --"
for ($i=1;$i -le 5;$i++){ Launch 18; Quit; Say ("launch$i startups=" + (Grep 'Startup complete') + " no-handler=" + (Grep 'no handler registered') + " init-fail=" + (Grep 'Runtime core failed to initialize')) }
Copy-Item $log (Join-Path $work 'app.repeat.log') -Force

# --- B7: restart persistence ---
Say "`n-- RESTART PERSISTENCE --"
Launch 18; Quit
Say ("tenant.LOST=" + (Grep 'Tenant resolution LOST'))
Say ("workspace.ready=" + (Last 'Workspace manager ready'))
Copy-Item $log (Join-Path $work 'app.final.log') -Force
Say "`n== DONE =="
