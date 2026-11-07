#!/usr/bin/env python3
"""Convert a video you have the right to distribute into streaming-friendly formats.

  python scripts/convert-video.py input.mkv                 # MP4 faststart (H.264 + AAC, max 1080p)
  python scripts/convert-video.py input.mkv --hls           # HLS: 6 s segments + index.m3u8
  python scripts/convert-video.py input.mkv --upload-ia my-item-id --license https://creativecommons.org/licenses/by/4.0/

--upload-ia uses the official `internetarchive` CLI (pip install internetarchive; ia configure)
and prints the direct URL to pass to `npm run add-movie -- --stream ...`.
Requires ffmpeg on PATH.
"""
import argparse
import shutil
import subprocess
import sys
from pathlib import Path

VIDEO = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '21', '-profile:v', 'high', '-level', '4.1',
         '-pix_fmt', 'yuv420p', '-vf', "scale='min(1920,iw)':-2", '-g', '48', '-keyint_min', '48', '-sc_threshold', '0']
AUDIO = ['-c:a', 'aac', '-b:a', '160k', '-ac', '2']


def run(cmd):
    print('$', ' '.join(map(str, cmd)))
    subprocess.run(cmd, check=True)


def main():
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument('input', type=Path)
    p.add_argument('--out', type=Path, default=Path('out'))
    p.add_argument('--hls', action='store_true', help='produce HLS instead of a single MP4')
    p.add_argument('--upload-ia', metavar='ITEM_ID', help='upload result to an Internet Archive item')
    p.add_argument('--license', help='license URL recorded on the Internet Archive item (required with --upload-ia)')
    a = p.parse_args()

    if not shutil.which('ffmpeg'):
        sys.exit('ffmpeg no está instalado (winget install ffmpeg / apt install ffmpeg).')
    if not a.input.exists():
        sys.exit(f'No existe {a.input}')
    if a.upload_ia and not a.license:
        sys.exit('--upload-ia requiere --license con la licencia que te permite distribuir la obra.')

    stem = a.input.stem.replace(' ', '_')
    a.out.mkdir(parents=True, exist_ok=True)

    if a.hls:
        dest = a.out / stem
        dest.mkdir(exist_ok=True)
        run(['ffmpeg', '-y', '-i', a.input, *VIDEO, *AUDIO, '-f', 'hls', '-hls_time', '6', '-hls_playlist_type', 'vod',
             '-hls_segment_filename', str(dest / 'seg_%04d.ts'), str(dest / 'index.m3u8')])
        files = sorted(dest.iterdir())
        main_file = 'index.m3u8'
    else:
        dest = a.out / f'{stem}.mp4'
        run(['ffmpeg', '-y', '-i', a.input, *VIDEO, *AUDIO, '-movflags', '+faststart', str(dest)])
        files = [dest]
        main_file = dest.name

    print(f'\n✓ Listo en {dest}')

    if a.upload_ia:
        if not shutil.which('ia'):
            sys.exit('Instala la CLI de Internet Archive: pip install internetarchive && ia configure')
        run(['ia', 'upload', a.upload_ia, *map(str, files), '--metadata=mediatype:movies', f'--metadata=licenseurl:{a.license}'])
        print(f'\nURL directa: https://archive.org/download/{a.upload_ia}/{main_file}')
        print(f'Póster:      https://archive.org/services/img/{a.upload_ia}')


if __name__ == '__main__':
    main()
