"""Industry-standard NLE round-trip exports: FCP7 XML (Premiere/DaVinci/CapCut), SRT captions, and Pitch Deck HTML."""
from __future__ import annotations

from html import escape as html_escape
from pathlib import Path
from urllib.parse import quote
from xml.sax.saxutils import escape as xml_escape


def _format_srt_ts(seconds: float) -> str:
    ms_total = max(0, int(round(seconds * 1000)))
    hours = ms_total // 3_600_000
    rem = ms_total % 3_600_000
    minutes = rem // 60_000
    rem %= 60_000
    secs = rem // 1000
    ms = rem % 1000
    return f'{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}'


def _path_to_file_url(local_path: str | None) -> str:
    if not local_path:
        return ''
    normalized = str(Path(local_path)).replace('\\', '/')
    if not normalized.startswith('/'):
        normalized = '/' + normalized
    return 'file://localhost' + quote(normalized, safe='/:')


def build_srt(shots: list[dict]) -> str:
    """Build frame-accurate .srt subtitle file from storyboard voiceovers or titles."""
    lines: list[str] = []
    cursor = 0.0
    cue_idx = 1
    for shot in shots:
        duration = max(float(shot.get('durationSec') or 4.0), 0.5)
        voice = str(shot.get('voiceover') or '').strip()
        text = voice or str(shot.get('title') or '').strip()
        if text:
            lines.append(str(cue_idx))
            lines.append(f'{_format_srt_ts(cursor)} --> {_format_srt_ts(cursor + duration)}')
            lines.append(text)
            lines.append('')
            cue_idx += 1
        cursor += duration
    return '\n'.join(lines).strip() + '\n'


def build_fcpxml(
    project_title: str,
    shots: list[dict],
    *,
    fps: int = 24,
    width: int = 1920,
    height: int = 1080,
) -> str:
    """Generate Premiere Pro / DaVinci Resolve / CapCut compatible FCP7 xmeml v5 sequence."""
    safe_fps = max(1, int(fps))
    safe_title = xml_escape(project_title or 'OpenDirector Sequence')
    total_frames = 0
    clip_xml_parts: list[str] = []
    marker_xml_parts: list[str] = []

    for idx, shot in enumerate(shots, start=1):
        duration_sec = max(float(shot.get('durationSec') or 4.0), 0.5)
        clip_frames = max(1, int(round(duration_sec * safe_fps)))
        start_frame = total_frames
        end_frame = total_frames + clip_frames
        total_frames = end_frame

        name = xml_escape(str(shot.get('title') or f'Shot {idx:02d}'))
        camera = xml_escape(str(shot.get('camera') or ''))
        prompt = xml_escape(str(shot.get('prompt') or ''))
        voiceover = xml_escape(str(shot.get('voiceover') or ''))
        local_path = shot.get('localPath')
        path_url = xml_escape(_path_to_file_url(local_path) or f'file://localhost/OpenDirector/shot_{idx:02d}.mp4')
        comment = xml_escape(' | '.join(part for part in [camera, prompt, voiceover] if part))

        clip_xml_parts.append(
            f"""          <clipitem id="clipitem-{idx}">
            <name>{name}</name>
            <duration>{clip_frames}</duration>
            <rate><timebase>{safe_fps}</timebase><ntsc>FALSE</ntsc></rate>
            <start>{start_frame}</start>
            <end>{end_frame}</end>
            <in>0</in>
            <out>{clip_frames}</out>
            <file id="file-{idx}">
              <name>{name}</name>
              <pathurl>{path_url}</pathurl>
              <rate><timebase>{safe_fps}</timebase><ntsc>FALSE</ntsc></rate>
              <duration>{clip_frames}</duration>
              <media>
                <video>
                  <samplecharacteristics>
                    <width>{width}</width>
                    <height>{height}</height>
                  </samplecharacteristics>
                </video>
              </media>
            </file>
            <labels><label2>Violet</label2></labels>
            <comments><mastercomment1>{comment}</mastercomment1></comments>
          </clipitem>"""
        )

        marker_xml_parts.append(
            f"""      <marker>
        <name>{name}</name>
        <comment>{comment}</comment>
        <in>{start_frame}</in>
        <out>-1</out>
      </marker>"""
        )

    clips_joined = '\n'.join(clip_xml_parts)
    markers_joined = '\n'.join(marker_xml_parts)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="opendirector-sequence-1">
    <name>{safe_title}</name>
    <duration>{total_frames}</duration>
    <rate>
      <timebase>{safe_fps}</timebase>
      <ntsc>FALSE</ntsc>
    </rate>
    <timecode>
      <rate><timebase>{safe_fps}</timebase><ntsc>FALSE</ntsc></rate>
      <string>00:00:00:00</string>
      <frame>0</frame>
      <displayformat>NDF</displayformat>
    </timecode>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>{width}</width>
            <height>{height}</height>
            <pixelaspectratio>square</pixelaspectratio>
            <rate><timebase>{safe_fps}</timebase><ntsc>FALSE</ntsc></rate>
          </samplecharacteristics>
        </format>
        <track>
{clips_joined}
        </track>
      </video>
    </media>
{markers_joined}
  </sequence>
</xmeml>
"""


def build_pitch_deck_html(
    project_title: str,
    *,
    style_label: str = 'Cinema 16:9',
    aspect_ratio: str = '16:9',
    bible: list[dict] | None = None,
    shots: list[dict] | None = None,
) -> str:
    """Generate a cinema-grade printable client Pitch Deck / Storyboard Book HTML."""
    safe_title = html_escape(project_title or 'OpenDirector Pitch Deck')
    safe_style = html_escape(style_label or 'Cinema')
    safe_ratio = html_escape(aspect_ratio or '16:9')
    shot_list = shots or []
    bible_list = bible or []
    total_sec = sum(max(float(s.get('durationSec') or 4.0), 0.5) for s in shot_list)

    bible_cards = '\n'.join(
        f"""<div class="bible-card">
          <span class="tag">{html_escape(str(item.get('kind') or 'Asset'))}</span>
          <h3>{html_escape(str(item.get('name') or ''))}</h3>
          <p>{html_escape(str(item.get('description') or ''))}</p>
          {f'<small>Voice: {html_escape(str(item.get("voice") or ""))}</small>' if item.get('voice') else ''}
        </div>"""
        for item in bible_list
    )

    shot_rows = '\n'.join(
        f"""<article class="shot-card">
          <div class="shot-head">
            <span class="badge">#{idx:02d}</span>
            <strong>{html_escape(str(s.get('title') or f'Shot {idx:02d}'))}</strong>
            <span class="meta">{html_escape(str(s.get('camera') or ''))} · {float(s.get('durationSec') or 4.0):.1f}s</span>
          </div>
          <p class="prompt">{html_escape(str(s.get('prompt') or ''))}</p>
          {f'<p class="vo">🎙 {html_escape(str(s.get("voiceover") or ""))}</p>' if s.get('voiceover') else ''}
        </article>"""
        for idx, s in enumerate(shot_list, start=1)
    )

    return f"""<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>{safe_title} — OpenDirector Pitch Deck</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{ margin: 0; font-family: "Noto Sans SC", system-ui, -apple-system, sans-serif; background: #0f1018; color: #f2f2fa; padding: 36px; }}
    header {{ display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 1px solid rgba(255,255,255,0.14); padding-bottom: 18px; margin-bottom: 24px; }}
    h1 {{ margin: 0; font-size: 28px; }}
    .sub {{ color: #a0a0be; font-size: 13px; margin-top: 6px; }}
    .stats {{ display: flex; gap: 10px; }}
    .pill {{ padding: 4px 12px; border-radius: 999px; background: rgba(108,99,255,0.2); border: 1px solid rgba(108,99,255,0.45); font-size: 12px; }}
    h2 {{ font-size: 15px; text-transform: uppercase; letter-spacing: 0.08em; color: #9c96ff; margin: 26px 0 12px; }}
    .bible-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }}
    .bible-card {{ background: #181927; border: 1px solid rgba(255,255,255,0.1); border-radius: 10px; padding: 14px; }}
    .bible-card .tag {{ font-size: 11px; color: #6ee7b7; text-transform: uppercase; }}
    .bible-card h3 {{ margin: 4px 0 6px; font-size: 15px; }}
    .bible-card p {{ margin: 0; font-size: 12.5px; color: #c4c4dc; line-height: 1.5; }}
    .shot-grid {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 14px; }}
    .shot-card {{ background: #181927; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 16px; break-inside: avoid; }}
    .shot-head {{ display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 8px; }}
    .badge {{ background: #6c63ff; color: #fff; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 999px; }}
    .meta {{ margin-left: auto; font-size: 11.5px; color: #9898b8; }}
    .prompt {{ margin: 0 0 8px; font-size: 13px; line-height: 1.55; color: #e2e2f2; }}
    .vo {{ margin: 0; font-size: 12px; color: #93c5fd; background: rgba(59,130,246,0.1); padding: 6px 10px; border-radius: 6px; }}
    @media print {{
      body {{ background: #fff; color: #111; padding: 18px; }}
      .bible-card, .shot-card {{ background: #f8f9fc; border-color: #d8dce8; }}
      .prompt {{ color: #1e2030; }}
    }}
  </style>
</head>
<body>
  <header>
    <div>
      <h1>{safe_title}</h1>
      <div class="sub">Generated by OpenDirector Flagship Studio · Director Storyboard Pitch Deck</div>
    </div>
    <div class="stats">
      <span class="pill">{safe_style}</span>
      <span class="pill">{safe_ratio}</span>
      <span class="pill">{len(shot_list)} Shots · {total_sec:.1f}s</span>
    </div>
  </header>
  {f'<h2>Production Bible · 角色与场景资产圣经</h2><section class="bible-grid">{bible_cards}</section>' if bible_cards else ''}
  <h2>Storyboard Sequence · 分镜脚本序列</h2>
  <section class="shot-grid">{shot_rows}</section>
</body>
</html>
"""
