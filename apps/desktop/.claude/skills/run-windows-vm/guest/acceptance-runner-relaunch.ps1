# Gate 20 — launch matrix with corrected log path + diagnostics (app already installed).
$ErrorActionPreference = 'Continue'
$work = 'C:\gate20'; New-Item -ItemType Directory -Force -Path $work | Out-Null
$out = Join-Path $work 'gate20b.out'; Remove-Item $out -ErrorAction SilentlyContinue
function Say($m){ $m | Out-File -FilePath $out -Append -Encoding ascii; Write-Host $m }

$exe = Get-ChildItem "$env:LOCALAPPDATA\Programs" -Recurse -Filter 'NeuroPause.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
Say ("exe=" + $exe.FullName)

# The Electron userData dir is '@neuropause\desktop' (see macOS run), not 'NeuroPause'.
$cand = @(
  (Join-Path $env:APPDATA '@neuropause\desktop\logs\app.log'),
  (Join-Path $env:APPDATA 'NeuroPause\logs\app.log')
)
function FindLog(){
  foreach($c in $cand){ if(Test-Path $c){ return $c } }
  $f = Get-ChildItem $env:APPDATA,$env:LOCALAPPDATA -Recurse -Filter 'app.log' -ErrorAction SilentlyContinue | Select-Object -First 1
  if($f){ return $f.FullName }
  return $null
}

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

Say "-- FIRST LAUNCH (fresh profile) --"
$ad = Join-Path $env:APPDATA '@neuropause\desktop'
if (Test-Path $ad) { Rename-Item $ad ($ad + '.pre') -Force -ErrorAction SilentlyContinue }
Launch 8
Say ("process.running.after.launch=" + [bool](Get-Process NeuroPause -ErrorAction SilentlyContinue))
Start-Sleep -Seconds 27
$log = FindLog
Say ("log.path=" + $log)
if (-not $log) {
  Say "APPDATA.dirs=" ; (Get-ChildItem $env:APPDATA -Directory -ErrorAction SilentlyContinue | Select-Object -Expand Name) -join ',' | ForEach-Object { Say $_ }
  Quit; Say "== NO LOG =="; return
}
Quit
function Grep($p){ (Select-String -Path $log -Pattern $p -AllMatches -ErrorAction SilentlyContinue).Count }
function Last($p){ (Select-String -Path $log -Pattern $p -ErrorAction SilentlyContinue | Select-Object -Last 1).Line }
Copy-Item $log (Join-Path $work 'app.first.log') -Force
Say ("startup.complete=" + (Grep 'Startup complete'))
Say ("secure.ipc=" + (Last 'Secure IPC handlers registered'))
Say ("org.runtime.ready=" + (Last 'Organization runtime ready'))
Say ("ai.engine=" + (Last 'AI engine configured'))
Say ("tenant.recovered=" + (Grep 'Tenant resolution RECOVERED'))
Say ("tenant.refused=" + (Grep 'Tenant refused'))
Say ("shutdown.flush=" + (Last 'Shutdown flush complete'))
Say ("no.handler.errors=" + (Grep 'no handler registered'))
Say ("runtime.init.fail=" + (Grep 'Runtime core failed to initialize'))

Say "-- REPEATED LAUNCH x5 --"
for ($i=1;$i -le 5;$i++){ Launch 16; Quit; Say ("launch$i startups=" + (Grep 'Startup complete') + " no-handler=" + (Grep 'no handler registered') + " init-fail=" + (Grep 'Runtime core failed to initialize')) }
Copy-Item $log (Join-Path $work 'app.repeat.log') -Force

Say "-- RESTART PERSISTENCE --"
Launch 16; Quit
Say ("tenant.LOST=" + (Grep 'Tenant resolution LOST'))
Say ("workspace.ready=" + (Last 'Workspace manager ready'))
Copy-Item $log (Join-Path $work 'app.final.log') -Force
Say "== DONE =="
