import os
import re
import time
import json
import hashlib
import subprocess
from datetime import datetime
from pathlib import Path

WORKSPACE = Path(r"C:\Users\DELL\orca\workspaces\KinoPulse\seafan")
TELEGRAM_DIR = Path(r"C:\Users\DELL\Downloads\Telegram Desktop")
CATALOG_PATH = WORKSPACE / "src/data/catalog.json"

def build_hash_lookup():
    """Mapea cada hash kp_asset_XXXX al nombre real de la película leyendo tus scripts."""
    lookup = {}
    for sname in ["upload-batch10.py", "batch-upload.py", "upload-pending51.py", "upload-extra4.py", "upload-hf.py"]:
        sp = WORKSPACE / "scripts" / sname
        if sp.exists():
            txt = sp.read_text(encoding="utf-8", errors="ignore")
            for m in re.finditer(r'\(\s*"([^"]+\.(?:mp4|mkv|avi))"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(\d{4})', txt, re.I):
                fname, title, _, year = m.groups()
                h1 = hashlib.sha256(title.lower().strip().encode()).hexdigest()[:10]
                h2 = hashlib.sha256(f"{title.lower().strip()}_{year}".encode()).hexdigest()[:10]
                lookup[f"temp_kp_asset_{h1}.mp4"] = (title, fname)
                lookup[f"temp_kp_asset_{h2}.mp4"] = (title, fname)
    return lookup

def get_active_processes():
    """Detecta si ffmpeg.exe o python.exe están corriendo y extrae el archivo que tienen abierto."""
    try:
        cmd = [
            "powershell", "-NoProfile", "-Command",
            "Get-CimInstance Win32_Process -Filter \"Name='ffmpeg.exe' OR Name='python.exe'\" | Select-Object Name,ProcessId,CommandLine | ConvertTo-Json -Compress"
        ]
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=3)
        if not res.stdout.strip():
            return []
        data = json.loads(res.stdout)
        return [data] if isinstance(data, dict) else data
    except Exception:
        return []

lookup = build_hash_lookup()
prev_size = {}
prev_time = {}

try:
    while True:
        os.system("cls")
        now_str = datetime.now().strftime("%H:%M:%S")
        print("======================================================================")
        print(f"📡 MONITOR EN TIEMPO REAL KINOPULSE | 🕒 {now_str} (Ctrl+C para salir)")
        print("======================================================================")

        # 1. Leer catálogo actual
        try:
            catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
            movies = [m for m in catalog.get("movies", []) if m.get("id") != "kp_900"]
        except Exception:
            movies = []

        # 2. Revisar procesos activos (FFmpeg / Python) y archivos temporales
        procs = get_active_processes()
        ffmpeg_procs = [p for p in procs if "ffmpeg" in (p.get("Name") or "").lower()]
        upload_procs = [
            p for p in procs
            if "python" in (p.get("Name") or "").lower()
            and any(k in (p.get("CommandLine") or "") for k in ["upload", "batch"])
        ]

        temp_files = list(WORKSPACE.glob("temp_kp_asset_*.mp4"))

        if not temp_files and not ffmpeg_procs and not upload_procs:
            print("\n⏸️  ESTADO ACTUAL: No hay ningún script de subida corriendo en este momento.")
            print("   👉 Si quieres iniciar la subida en otra ventana usa: python scripts/upload-batch10.py")
        else:
            if upload_procs:
                pids = ", ".join(str(p.get("ProcessId")) for p in upload_procs)
                print(f"\n🟢 SCRIPT DE SUBIDA ACTIVO (PID: {pids})")

            if ffmpeg_procs:
                for fp in ffmpeg_procs:
                    cmdline = fp.get("CommandLine") or ""
                    m_in = re.search(r'-i\s+"?([^"]+?\.(?:mp4|mkv|avi))"?', cmdline, re.I)
                    in_name = Path(m_in.group(1)).name if m_in else "Video en proceso"
                    print(f"⚙️  FFMPEG PROCESANDO VIDEO: {in_name}")

            if temp_files:
                for tf in temp_files:
                    tname = tf.name
                    cur_bytes = tf.stat().st_size
                    cur_mb = cur_bytes / (1024 ** 2)
                    t_now = time.time()

                    # Calcular velocidad en MB/s
                    speed_mb = 0.0
                    if tname in prev_size:
                        dt = max(0.1, t_now - prev_time[tname])
                        speed_mb = max(0.0, (cur_bytes - prev_size[tname]) / (1024 ** 2) / dt)
                    prev_size[tname] = cur_bytes
                    prev_time[tname] = t_now

                    title_info, orig_fname = lookup.get(tname, ("Película en proceso", None))
                    orig_mb = 0.0
                    if orig_fname and (TELEGRAM_DIR / orig_fname).exists():
                        orig_mb = (TELEGRAM_DIR / orig_fname).stat().st_size / (1024 ** 2)

                    if ffmpeg_procs and speed_mb > 0.1:
                        stage = f"⚡ Empaquetando/Comprimiendo en disco ({speed_mb:.1f} MB/s)"
                    else:
                        stage = "🚀 SUBIENDO A HUGGING FACE CDN (Enviando paquetes a la nube...)"

                    pct_str = f" / ~{orig_mb:.0f} MB ({min(100, int((cur_mb/orig_mb)*100))}%)" if orig_mb > 0 else ""
                    print(f"\n🎬 PELÍCULA ACTUAL : {title_info}")
                    print(f"   📦 Archivo temp : {tname} ({cur_mb:.1f} MB{pct_str})")
                    print(f"   📡 Fase         : {stage}")
            elif upload_procs:
                print("\n🔍 Preparando siguiente película o consultando póster en API...")

        # 3. Mostrar las últimas 5 que ya terminaron de subirse
        print("\n----------------------------------------------------------------------")
        print(f"✅ ÚLTIMAS SUBIDAS COMPLETADAS (Total en catálogo: {len(movies)}):")
        for m in movies[-5:]:
            print(f"   ✔ [{m.get('id')}] {m.get('title')} ({m.get('year')}) -> Lista en Hugging Face")

        # 4. Mostrar las próximas en la cola de upload-pending51.py
        pub_titles = {m.get("title", "").lower() for m in movies}
        pending_script = WORKSPACE / "scripts/upload-batch10.py"
        upcoming = []
        if pending_script.exists():
            txt = pending_script.read_text(encoding="utf-8", errors="ignore")
            for m in re.finditer(r'\(\s*"([^"]+\.(?:mp4|mkv|avi))"\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"\s*,\s*(\d{4})', txt, re.I):
                fn, t_es, _, yr = m.groups()
                if t_es.lower() not in pub_titles and (TELEGRAM_DIR / fn).exists():
                    upcoming.append(f"{t_es} ({yr})")

        print("\n----------------------------------------------------------------------")
        print(f"⏳ PRÓXIMAS EN LA COLA ({len(upcoming)} restantes en el lote):")
        if upcoming:
            for idx, item in enumerate(upcoming[:6], 1):
                marker = "👉 [EN CURSO / SIGUIENTE]" if idx == 1 else f"   {idx}."
                print(f"  {marker} {item}")
            if len(upcoming) > 6:
                print(f"   ... y {len(upcoming) - 6} películas más en fila.")
        else:
            print("   🎉 ¡No quedan películas pendientes en la cola del script!")

        time.sleep(2)
except KeyboardInterrupt:
    print("\n👋 Monitor en vivo cerrado.")
