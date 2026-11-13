# Sube el lote pendiente de una en una: cuando termina una pelicula arranca la siguiente
# sola, sin tocar nada. Es reanudable, asi que si se corta la luz o cierras la ventana,
# lo vuelves a lanzar y sigue donde iba (salta lo que ya esta en el catalogo).
#
#   .\scripts\subir-lote.ps1              # todo el lote pendiente
#   .\scripts\subir-lote.ps1 -Only rango  # solo una
#
# Deja el registro completo en upload-lote.log por si quieres revisar que paso.

param(
    [string]$Only = "",
    # Si una pelicula falla por red, el script de Python pasa a la siguiente; estas vueltas
    # extra reintentan las que quedaron pendientes al terminar la pasada.
    [int]$Vueltas = 3
)

$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

# El token sale de .env si existe; si no, del entorno. Nunca se escribe en el log.
if (-not $env:HF_TOKEN) {
    if (Test-Path ".env") {
        Get-Content ".env" | ForEach-Object {
            if ($_ -match '^\s*HF_TOKEN\s*=\s*(.+?)\s*$') { $env:HF_TOKEN = $Matches[1] }
        }
    }
}
if (-not $env:HF_TOKEN) {
    Write-Host "Sin HF_TOKEN en el entorno ni en .env: se usara el que trae el script viejo." -ForegroundColor Yellow
}

$log = "upload-lote.log"
$argsPy = @("-u", "scripts/upload-batch10.py")
if ($Only) { $argsPy += @("--only", $Only) }

for ($v = 1; $v -le $Vueltas; $v++) {
    Write-Host ""
    Write-Host "=== Pasada $v de $Vueltas ===" -ForegroundColor Cyan
    "`n=== Pasada $v  $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===" | Add-Content -Path $log -Encoding utf8

    # Tee-Object para verlo en pantalla y guardarlo en el log a la vez.
    python @argsPy 2>&1 | Tee-Object -FilePath $log -Append

    # La ultima linea del script dice cuantas quedaron; si no proceso ninguna, no hay
    # nada mas que hacer y no tiene sentido gastar otra pasada.
    $ultimas = Get-Content $log -Tail 5
    if ($ultimas -match "Lote terminado: 0/") {
        Write-Host "No queda nada pendiente." -ForegroundColor Green
        break
    }
}

Write-Host ""
Write-Host "Listo. Registro completo en $log" -ForegroundColor Green
Write-Host "Para ver el avance en vivo mientras corre, en otra ventana: python scripts/live-monitor.py"
