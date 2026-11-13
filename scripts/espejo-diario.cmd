@echo off
rem Tarea programada "KinoPulse espejo": copia al dataset espejo lo que falte. Deja el ultimo resultado en espejo-diario.log.
cd /d "%~dp0.."
set PYTHONIOENCODING=utf-8
echo %date% %time% > espejo-diario.log
python -u scripts\mirror-hf-backup.py >> espejo-diario.log 2>&1
