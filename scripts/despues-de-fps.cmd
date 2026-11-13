@echo off
rem Lo que va detras del arreglo de fps, encadenado: espera a que termine, pone el espejo al dia
rem y baja a E:\ las peliculas publicadas. Se lanza una vez y se deja; el progreso va a despues-de-fps.log.
rem No publica el catalogo ni borra nada: eso queda para hacerlo a mano.
cd /d "%~dp0.."
set PYTHONIOENCODING=utf-8
python -u scripts\backup-to-drive-e.py --esperar-fps --simular
echo ===== Espejo =====
python -u scripts\mirror-hf-backup.py
echo ===== Publicadas a E:\ =====
python -u scripts\backup-to-drive-e.py --desde-hf
echo ===== Fin =====
