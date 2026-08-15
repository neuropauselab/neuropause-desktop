@echo off
rem Guest bootstrap: pull the runner + installer from the host over QEMU NAT
rem (10.0.2.2 IS the host), run the acceptance, hand results back via HTTP PUT.
rem Serve these from the host with scripts/uploadserver.py on :8099 (put np.exe
rem = the installer, and acceptance-runner.ps1, in the served dir).
rem
rem Trigger it from a FOCUSED elevated cmd with ONE lowercase line
rem (open cmd via Win+R -> "cmd"; UAC is off in the sample autounattend):
rem   curl -s -o c:\b.cmd http://10.0.2.2:8099/bootstrap.cmd & c:\b.cmd
rem
rem After it runs, read the results on the host at <served-dir>/uploads/.
if not exist C:\gate20 mkdir C:\gate20
curl -s -o C:\gate20\run.ps1 http://10.0.2.2:8099/acceptance-runner.ps1
curl -s -o C:\gate20\np.exe  http://10.0.2.2:8099/np.exe
powershell -ExecutionPolicy Bypass -File C:\gate20\run.ps1
curl -s --upload-file C:\gate20\gate20.out    http://10.0.2.2:8099/gate20.out
curl -s --upload-file C:\gate20\app.first.log http://10.0.2.2:8099/app.first.log
curl -s --upload-file C:\gate20\app.repeat.log http://10.0.2.2:8099/app.repeat.log
curl -s --upload-file C:\gate20\app.final.log http://10.0.2.2:8099/app.final.log
echo DONE > C:\gate20\bootdone.txt
curl -s --upload-file C:\gate20\bootdone.txt http://10.0.2.2:8099/bootdone.txt
