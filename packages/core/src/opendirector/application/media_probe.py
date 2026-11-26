"""Local FFmpeg media probe, intelligent scene breakdown, tail-frame extraction, and zero-cost video post-ops."""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from ..domain.projects import ProjectError


def _find_binary(name: str) -> str | None:
    found = shutil.which(name)
    if found:
        return found
    home_bin = Path.home() / 'bin' / name
    if home_bin.exists() and os.access(home_bin, os.X_OK):
        return str(home_bin)
    return None


def _require_ffmpeg() -> str:
    ffmpeg = _find_binary('ffmpeg')
    if not ffmpeg:
        raise ProjectError('本机未检测到 FFmpeg 媒体引擎，请先在桌面健康中心检查环境。', 503, code='ffmpeg_missing')
    return ffmpeg


def _parse_ffmpeg_stderr_probe(stderr: str, file_path: Path) -> dict:
    duration_sec = 0.0
    m_dur = re.search(r'Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)', stderr)
    if m_dur:
        duration_sec = int(m_dur.group(1)) * 3600 + int(m_dur.group(2)) * 60 + float(m_dur.group(3))

    bitrate_kbps = 0
    m_br = re.search(r'bitrate:\s*(\d+)\s*kb/s', stderr)
    if m_br:
        bitrate_kbps = int(m_br.group(1))

    width = 0
    height = 0
    fps = 24.0
    video_codec = ''
    is_vfr = False

    for line in stderr.splitlines():
        if 'Stream #' in line and 'Video:' in line:
            m_codec = re.search(r'Video:\s*([a-zA-Z0-9_]+)', line)
            if m_codec:
                video_codec = m_codec.group(1)
            m_dim = re.search(r',\s*(\d{2,5})x(\d{2,5})(?:\s|,|\[)', line)
            if m_dim:
                width = int(m_dim.group(1))
                height = int(m_dim.group(2))
            m_fps = re.search(r'(\d+(?:\.\d+)?)\s*fps', line)
            m_tbr = re.search(r'(\d+(?:\.\d+)?)\s*tbr', line)
            if m_fps:
                fps = float(m_fps.group(1))
            elif m_tbr:
                fps = float(m_tbr.group(1))
            if m_fps and m_tbr and abs(float(m_fps.group(1)) - float(m_tbr.group(1))) > 0.8:
                is_vfr = True
            break

    has_audio = False
    audio_codec = ''
    for line in stderr.splitlines():
        if 'Stream #' in line and 'Audio:' in line:
            has_audio = True
            m_ac = re.search(r'Audio:\s*([a-zA-Z0-9_]+)', line)
            if m_ac:
                audio_codec = m_ac.group(1)
            break

    return {
        'width': width,
        'height': height,
        'fps': round(fps, 3),
        'isVfr': is_vfr,
        'durationSec': round(duration_sec, 3),
        'videoCodec': video_codec or 'unknown',
        'audioCodec': audio_codec or None,
        'hasAudio': has_audio,
        'bitrateKbps': bitrate_kbps,
        'fileSizeBytes': file_path.stat().st_size if file_path.exists() else 0,
    }


def probe_local_media(file_path: Path) -> dict:
    """Inspect a local video/image/audio file via ffprobe (or ffmpeg -i fallback)."""
    if not file_path.exists() or not file_path.is_file():
        raise ProjectError('本地媒体文件不存在。', 404, code='media_missing')

    ffprobe = _find_binary('ffprobe')
    if ffprobe:
        proc = subprocess.run(
            [
                ffprobe,
                '-v', 'quiet',
                '-print_format', 'json',
                '-show_format',
                '-show_streams',
                str(file_path),
            ],
            capture_output=True,
            text=True,
            timeout=20,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            payload = json.loads(proc.stdout)
            streams = payload.get('streams') or []
            fmt = payload.get('format') or {}
            v_stream = next((s for s in streams if s.get('codec_type') == 'video'), None)
            a_stream = next((s for s in streams if s.get('codec_type') == 'audio'), None)

            def _parse_rate(val: str | None) -> float:
                if not val or val == '0/0':
                    return 0.0
                if '/' in val:
                    n, d = val.split('/', 1)
                    return float(n) / float(d) if float(d) else 0.0
                return float(val)

            avg_fps = _parse_rate(v_stream.get('avg_frame_rate')) if v_stream else 0.0
            r_fps = _parse_rate(v_stream.get('r_frame_rate')) if v_stream else 0.0
            fps = avg_fps or r_fps or 24.0
            is_vfr = bool(avg_fps and r_fps and abs(avg_fps - r_fps) > 0.8)
            duration = float(fmt.get('duration') or (v_stream or {}).get('duration') or 0.0)
            bitrate_kbps = int(int(fmt.get('bit_rate') or 0) / 1000)
            return {
                'width': int((v_stream or {}).get('width') or 0),
                'height': int((v_stream or {}).get('height') or 0),
                'fps': round(fps, 3),
                'isVfr': is_vfr,
                'durationSec': round(duration, 3),
                'videoCodec': (v_stream or {}).get('codec_name') or 'unknown',
                'audioCodec': (a_stream or {}).get('codec_name') if a_stream else None,
                'hasAudio': bool(a_stream),
                'bitrateKbps': bitrate_kbps,
                'fileSizeBytes': file_path.stat().st_size,
            }

    ffmpeg = _require_ffmpeg()
    proc = subprocess.run([ffmpeg, '-hide_banner', '-i', str(file_path)], capture_output=True, text=True, timeout=20)
    return _parse_ffmpeg_stderr_probe(proc.stderr or '', file_path)


def extract_media_frames(
    file_path: Path,
    out_dir: Path,
    *,
    mode: str = 'scene',
    threshold: float = 0.28,
    max_frames: int = 8,
) -> list[dict]:
    """Extract storyboard cut frames or exact tail frame using local FFmpeg."""
    ffmpeg = _require_ffmpeg()
    out_dir.mkdir(parents=True, exist_ok=True)
    probe = probe_local_media(file_path)
    duration = max(float(probe.get('durationSec') or 0.0), 0.1)
    safe_max = max(1, min(int(max_frames), 16))

    if mode == 'last_frame':
        target = out_dir / 'tail_frame.png'
        seek_sec = max(duration - 0.08, 0.0)
        proc = subprocess.run(
            [
                ffmpeg, '-y', '-hide_banner', '-loglevel', 'error',
                '-ss', f'{seek_sec:.3f}',
                '-i', str(file_path),
                '-frames:v', '1',
                str(target),
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode != 0 or not target.exists():
            # Fallback without -ss for very short clips
            subprocess.run(
                [ffmpeg, '-y', '-hide_banner', '-loglevel', 'error', '-i', str(file_path), '-frames:v', '1', str(target)],
                capture_output=True,
                text=True,
                timeout=30,
            )
        if not target.exists():
            raise ProjectError('提取视频尾帧失败，请确认该文件为有效视频。', 422, code='extract_failed')
        return [
            {
                'index': 1,
                'timestampSec': round(duration, 2),
                'durationSec': round(duration, 2),
                'filePath': target,
                'label': 'tail-frame',
            }
        ]

    extracted: list[dict] = []
    if mode == 'scene':
        safe_thresh = max(0.05, min(float(threshold), 0.9))
        pattern = str(out_dir / 'scene_%03d.png')
        proc = subprocess.run(
            [
                ffmpeg, '-y', '-hide_banner',
                '-i', str(file_path),
                '-vf', f"select='eq(n,0)+gt(scene,{safe_thresh:.2f})',showinfo",
                '-vsync', 'vfr',
                '-frames:v', str(safe_max),
                pattern,
            ],
            capture_output=True,
            text=True,
            timeout=60,
        )
        timestamps = [
            float(m.group(1))
            for m in re.finditer(r'pts_time:(\d+(?:\.\d+)?)', proc.stderr or '')
        ]
        files = sorted(out_dir.glob('scene_*.png'))
        for idx, img_path in enumerate(files):
            ts = timestamps[idx] if idx < len(timestamps) else round((idx / max(len(files), 1)) * duration, 2)
            extracted.append({'index': idx + 1, 'timestampSec': round(ts, 2), 'filePath': img_path, 'label': f'shot-{idx + 1:02d}'})

    # If keyframes mode OR single continuous shot (<= 1 scene cut), sample evenly across timeline
    if mode == 'keyframes' or len(extracted) <= 1:
        for f in out_dir.glob('*.png'):
            f.unlink(missing_ok=True)
        extracted = []
        count = min(safe_max, max(2, int(round(duration / 2.0)) if duration >= 2.0 else 2))
        for i in range(count):
            ts = round((duration * i) / max(count, 1), 2)
            target = out_dir / f'shot_{i + 1:03d}.png'
            subprocess.run(
                [
                    ffmpeg, '-y', '-hide_banner', '-loglevel', 'error',
                    '-ss', f'{ts:.3f}',
                    '-i', str(file_path),
                    '-frames:v', '1',
                    str(target),
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            if target.exists():
                extracted.append({'index': i + 1, 'timestampSec': ts, 'filePath': target, 'label': f'shot-{i + 1:02d}'})

    if not extracted:
        raise ProjectError('未能从该视频提取出有效关键帧。', 422, code='extract_empty')

    for i, item in enumerate(extracted):
        next_ts = extracted[i + 1]['timestampSec'] if i + 1 < len(extracted) else duration
        item['durationSec'] = round(max(next_ts - item['timestampSec'], 0.5), 2)
    return extracted


SUPPORTED_VIDEO_OPS = {'reframe_9x16', 'reframe_16x9', 'cfr_24', 'film_grain', 'reverse'}


def run_local_video_transform(file_path: Path, out_path: Path, *, op: str) -> dict:
    """Zero-API-cost local FFmpeg video post-processing for creators."""
    if op not in SUPPORTED_VIDEO_OPS:
        raise ProjectError(f'不支持的视频本地处理操作：{op}', 400, code='invalid_video_op')
    ffmpeg = _require_ffmpeg()
    probe = probe_local_media(file_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    vf = None
    af = None
    if op == 'reframe_9x16':
        vf = 'crop=min(iw\\,ih*9/16):min(ih\\,iw*16/9),scale=720:1280:force_original_aspect_ratio=decrease,pad=720:1280:(ow-iw)/2:(oh-ih)/2'
    elif op == 'reframe_16x9':
        vf = 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2'
    elif op == 'cfr_24':
        vf = 'fps=24'
    elif op == 'film_grain':
        vf = 'noise=alls=9:allf=t+u'
    elif op == 'reverse':
        vf = 'reverse'
        if probe.get('hasAudio'):
            af = 'areverse'

    cmd = [ffmpeg, '-y', '-hide_banner', '-loglevel', 'error', '-i', str(file_path)]
    if vf:
        cmd.extend(['-vf', vf])
    if af:
        cmd.extend(['-af', af])
    cmd.extend([
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
    ])
    if probe.get('hasAudio'):
        cmd.extend(['-c:a', 'aac', '-b:a', '128k'])
    else:
        cmd.append('-an')
    cmd.append(str(out_path))

    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if proc.returncode != 0 or not out_path.exists():
        raise ProjectError(f'本机 FFmpeg 处理失败：{proc.stderr.strip() or proc.returncode}', 500, code='ffmpeg_failed')
    return probe_local_media(out_path)
