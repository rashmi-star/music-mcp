import React, { useState, useRef, useEffect, useCallback } from "react";
import { z } from "zod";
import { useWidget, type WidgetMetadata } from "mcp-use/react";
import "./styles.css";

const propSchema = z.object({
  title: z.string().describe("Track title"),
  artist: z.string().describe("Artist name"),
  album: z.string().optional().describe("Album name"),
  coverUrl: z.string().optional().describe("Album cover image URL"),
  audiusTrackId: z.string().optional().describe("Audius track ID for full song streaming"),
  audiusDuration: z.number().optional().describe("Full track duration in seconds"),
  previewUrl: z.string().optional().describe("Deezer 30s preview URL (fallback)"),
  deezerUrl: z.string().optional().describe("Link to track on Deezer"),
  audiusUrl: z.string().optional().describe("Link to track on Audius"),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Premium inline music player with layered audio visualizer",
  inputs: propSchema,
  metadata: {
    prefersBorder: false,
    autoResize: true,
    csp: {
      resourceDomains: [
        "https://*.dzcdn.net",
        "https://cdnt-preview.dzcdn.net",
        "https://cdn-images.dzcdn.net",
        "https://e-cdns-images.dzcdn.net",
        "https://api.deezer.com",
      ],
    },
  },
};

type Props = z.infer<typeof propSchema>;

function fmt(s: number): string {
  if (!s || isNaN(s)) return "0:00";
  return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}

// ── Multi-layer Visualizer ──

function Visualizer({
  analyser,
  playing,
}: {
  analyser: AnalyserNode | null;
  playing: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number>(0);
  const timeRef = useRef(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = 440 * dpr;
    canvas.height = 260 * dpr;
    ctx.scale(dpr, dpr);

    const W = 440;
    const H = 260;

    let freqData: Uint8Array;
    let waveData: Uint8Array;

    if (analyser) {
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.82;
      freqData = new Uint8Array(analyser.frequencyBinCount);
      waveData = new Uint8Array(analyser.frequencyBinCount);
    } else {
      freqData = new Uint8Array(256);
      waveData = new Uint8Array(256);
    }

    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      timeRef.current += 0.016;
      const t = timeRef.current;

      ctx.clearRect(0, 0, W, H);

      if (analyser && playing) {
        analyser.getByteFrequencyData(freqData);
        analyser.getByteTimeDomainData(waveData);
      }

      // ── Layer 1: Ambient glow orbs (background) ──
      const bass = playing ? (freqData[2] + freqData[3] + freqData[4]) / 3 / 255 : 0.05;
      const mid = playing ? (freqData[20] + freqData[25] + freqData[30]) / 3 / 255 : 0.03;

      // Left orb (bass-reactive)
      const grad1 = ctx.createRadialGradient(
        W * 0.25, H * 0.6, 0,
        W * 0.25, H * 0.6, 100 + bass * 60
      );
      grad1.addColorStop(0, `rgba(139, 92, 246, ${0.15 + bass * 0.25})`);
      grad1.addColorStop(0.5, `rgba(139, 92, 246, ${0.05 + bass * 0.1})`);
      grad1.addColorStop(1, "rgba(139, 92, 246, 0)");
      ctx.fillStyle = grad1;
      ctx.fillRect(0, 0, W, H);

      // Right orb (mid-reactive)
      const grad2 = ctx.createRadialGradient(
        W * 0.75, H * 0.4, 0,
        W * 0.75, H * 0.4, 80 + mid * 50
      );
      grad2.addColorStop(0, `rgba(236, 72, 153, ${0.12 + mid * 0.2})`);
      grad2.addColorStop(0.5, `rgba(236, 72, 153, ${0.04 + mid * 0.08})`);
      grad2.addColorStop(1, "rgba(236, 72, 153, 0)");
      ctx.fillStyle = grad2;
      ctx.fillRect(0, 0, W, H);

      // ── Layer 2: Smooth waveform (oscilloscope) ──
      ctx.beginPath();
      ctx.lineWidth = 2;
      const waveGrad = ctx.createLinearGradient(0, 0, W, 0);
      waveGrad.addColorStop(0, "rgba(139, 92, 246, 0.0)");
      waveGrad.addColorStop(0.15, "rgba(139, 92, 246, 0.5)");
      waveGrad.addColorStop(0.5, "rgba(168, 85, 247, 0.7)");
      waveGrad.addColorStop(0.85, "rgba(236, 72, 153, 0.5)");
      waveGrad.addColorStop(1, "rgba(236, 72, 153, 0.0)");
      ctx.strokeStyle = waveGrad;

      const sliceW = W / waveData.length;
      for (let i = 0; i < waveData.length; i++) {
        const v = playing ? waveData[i] / 128.0 : 1 + Math.sin(t * 1.5 + i * 0.04) * 0.02;
        const y = (v * H) / 2;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * sliceW, y);
      }
      ctx.stroke();

      // Waveform glow
      ctx.lineWidth = 6;
      ctx.strokeStyle = playing
        ? `rgba(168, 85, 247, ${0.08 + bass * 0.12})`
        : "rgba(168, 85, 247, 0.03)";
      ctx.beginPath();
      for (let i = 0; i < waveData.length; i++) {
        const v = playing ? waveData[i] / 128.0 : 1 + Math.sin(t * 1.5 + i * 0.04) * 0.02;
        const y = (v * H) / 2;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * sliceW, y);
      }
      ctx.stroke();

      // ── Layer 3: Frequency bars (main visual) ──
      const barCount = 48;
      const totalGap = (barCount - 1) * 3;
      const barW = (W - 40 - totalGap) / barCount;
      const startX = 20;
      const baseY = H - 20;

      for (let i = 0; i < barCount; i++) {
        const idx = Math.floor((i / barCount) * freqData.length * 0.7);
        const raw = freqData[idx] / 255;
        const val = playing ? Math.pow(raw, 0.85) : 0.02 + Math.sin(t * 0.8 + i * 0.15) * 0.015;
        const barH = Math.max(3, val * (H * 0.65));

        const x = startX + i * (barW + 3);

        // Main bar gradient
        const barGrad = ctx.createLinearGradient(x, baseY, x, baseY - barH);
        const hue1 = 265 + (i / barCount) * 50;
        const hue2 = 275 + (i / barCount) * 50;
        barGrad.addColorStop(0, `hsla(${hue1}, 70%, 60%, ${playing ? 0.6 + val * 0.4 : 0.15})`);
        barGrad.addColorStop(0.5, `hsla(${hue2}, 75%, 65%, ${playing ? 0.5 + val * 0.5 : 0.1})`);
        barGrad.addColorStop(1, `hsla(${hue2 + 15}, 80%, 70%, ${playing ? 0.3 + val * 0.4 : 0.06})`);
        ctx.fillStyle = barGrad;

        // Rounded bar
        const r = Math.min(barW / 2, 2.5);
        ctx.beginPath();
        ctx.moveTo(x, baseY);
        ctx.lineTo(x, baseY - barH + r);
        ctx.quadraticCurveTo(x, baseY - barH, x + r, baseY - barH);
        ctx.lineTo(x + barW - r, baseY - barH);
        ctx.quadraticCurveTo(x + barW, baseY - barH, x + barW, baseY - barH + r);
        ctx.lineTo(x + barW, baseY);
        ctx.closePath();
        ctx.fill();

        // Bar cap (bright dot at top)
        if (playing && val > 0.1) {
          ctx.fillStyle = `hsla(${hue1}, 85%, 80%, ${0.6 + val * 0.4})`;
          ctx.beginPath();
          ctx.arc(x + barW / 2, baseY - barH, barW / 2, 0, Math.PI * 2);
          ctx.fill();
        }

        // Reflection
        const reflGrad = ctx.createLinearGradient(x, baseY, x, baseY + barH * 0.3);
        reflGrad.addColorStop(0, `hsla(${hue1}, 70%, 60%, ${playing ? 0.08 + val * 0.06 : 0.02})`);
        reflGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = reflGrad;
        ctx.fillRect(x, baseY + 2, barW, barH * 0.25);
      }

      // ── Layer 4: Horizontal pulse line ──
      ctx.beginPath();
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(255, 255, 255, ${playing ? 0.06 + bass * 0.08 : 0.03})`;
      ctx.moveTo(0, baseY);
      ctx.lineTo(W, baseY);
      ctx.stroke();
    };

    draw();
    return () => cancelAnimationFrame(rafRef.current);
  }, [analyser, playing]);

  return (
    <canvas
      ref={canvasRef}
      className="viz-canvas"
      style={{ width: 440, height: 260 }}
    />
  );
}

// ── Main Player ──

const MusicPlayer: React.FC = () => {
  const { props, isPending, theme } = useWidget<Props>();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(80);
  const [muted, setMuted] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [isFullTrack, setIsFullTrack] = useState(false);
  const [analyserReady, setAnalyserReady] = useState(false);

  const dark = theme !== "light";

  useEffect(() => {
    if (!props) return;
    let audioUrl = "";
    if (props.audiusTrackId) {
      audioUrl = `${window.location.origin}/stream/${props.audiusTrackId}`;
      setIsFullTrack(true);
    } else if (props.previewUrl) {
      audioUrl = props.previewUrl;
      setIsFullTrack(false);
    }
    if (!audioUrl) return;

    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audio.volume = volume / 100;
    audio.preload = "auto";
    audio.src = audioUrl;
    audioRef.current = audio;

    const onTime = () => setCurrentTime(audio.currentTime);
    const onDur = () => {
      if (audio.duration && isFinite(audio.duration)) setDuration(audio.duration);
    };
    const onEnd = () => setPlaying(false);
    const onError = () => {
      if (props.audiusTrackId && props.previewUrl && audio.src !== props.previewUrl) {
        audio.src = props.previewUrl;
        setIsFullTrack(false);
      }
    };

    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("durationchange", onDur);
    audio.addEventListener("loadedmetadata", onDur);
    audio.addEventListener("ended", onEnd);
    audio.addEventListener("error", onError);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("durationchange", onDur);
      audio.removeEventListener("loadedmetadata", onDur);
      audio.removeEventListener("ended", onEnd);
      audio.removeEventListener("error", onError);
      audio.src = "";
    };
  }, [props?.audiusTrackId, props?.previewUrl]);

  const initAnalyser = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || analyserRef.current) return;
    try {
      const actx = new AudioContext();
      const source = actx.createMediaElementSource(audio);
      const analyser = actx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.82;
      source.connect(analyser);
      analyser.connect(actx.destination);
      ctxRef.current = actx;
      analyserRef.current = analyser;
      setAnalyserReady(true);
    } catch { /* sandbox may block AudioContext */ }
  }, []);

  const toggle = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!analyserRef.current) initAnalyser();
    if (playing) {
      audio.pause();
    } else {
      if (ctxRef.current?.state === "suspended") ctxRef.current.resume();
      audio.play().catch(() => {});
    }
    setPlaying((p) => !p);
  }, [playing, initAnalyser]);

  const seek = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || !duration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      audio.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
    },
    [duration]
  );

  const onVol = useCallback((val: number) => {
    setVolume(val);
    if (audioRef.current) audioRef.current.volume = val / 100;
  }, []);

  const onMute = useCallback(() => {
    setMuted((m) => {
      if (audioRef.current) audioRef.current.muted = !m;
      return !m;
    });
  }, []);

  if (isPending) {
    return (
      <div className="mp-root mp-loading">
        <div className="mp-spinner" />
        <p className="mp-loading-text">Finding your song...</p>
      </div>
    );
  }

  if (!props?.audiusTrackId && !props?.previewUrl) {
    return (
      <div className="mp-root mp-error">
        <p>No audio available</p>
      </div>
    );
  }

  const { title, artist, album, coverUrl, deezerUrl, audiusUrl } = props;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="mp-root">
      {/* Blurred BG */}
      {coverUrl && (
        <img
          src={coverUrl}
          alt=""
          onLoad={() => setImgLoaded(true)}
          className={`mp-bg ${imgLoaded ? "loaded" : ""}`}
        />
      )}
      <div className="mp-bg-overlay" />

      {/* Visualizer hero */}
      <div className="mp-viz">
        <Visualizer analyser={analyserRef.current} playing={playing} />
      </div>

      {/* Content */}
      <div className="mp-content">
        {/* Track info row */}
        <div className="mp-track-row">
          {coverUrl && (
            <div className="mp-thumb-wrap">
              <img
                src={coverUrl}
                alt=""
                className={`mp-thumb ${imgLoaded ? "loaded" : ""}`}
              />
            </div>
          )}
          <div className="mp-track-info">
            <h1 className="mp-title">{title}</h1>
            <p className="mp-artist">
              {artist}{album ? ` \u00b7 ${album}` : ""}
            </p>
            {isFullTrack ? (
              <span className="mp-badge mp-badge-full">Full Track</span>
            ) : (
              <span className="mp-badge mp-badge-preview">Preview</span>
            )}
          </div>
        </div>

        {/* Progress */}
        <div className="mp-progress-wrap">
          <div className="mp-progress" onClick={seek}>
            <div className="mp-progress-fill" style={{ width: `${progress}%` }}>
              <div className="mp-progress-glow" />
              <div className="mp-progress-knob" />
            </div>
          </div>
          <div className="mp-times">
            <span>{fmt(currentTime)}</span>
            <span>{duration > 0 ? fmt(duration) : "--:--"}</span>
          </div>
        </div>

        {/* Controls */}
        <div className="mp-controls">
          <button
            className="mp-btn"
            onClick={() => audioRef.current && (audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 10))}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6zm3.5 6l8.5 6V6z"/></svg>
          </button>
          <button className="mp-btn mp-play" onClick={toggle}>
            {playing ? (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
            ) : (
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            )}
          </button>
          <button
            className="mp-btn"
            onClick={() => audioRef.current && (audioRef.current.currentTime = Math.min(audioRef.current.duration || 30, audioRef.current.currentTime + 10))}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/></svg>
          </button>
        </div>

        {/* Volume */}
        <div className="mp-vol-row">
          <button className="mp-btn mp-btn-sm" onClick={onMute}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              {muted || volume === 0 ? (
                <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
              ) : (
                <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
              )}
            </svg>
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => onVol(Number(e.target.value))}
            className="mp-vol-slider"
          />
          <span className="mp-vol-val">{volume}%</span>
        </div>

        {/* Links */}
        {(audiusUrl || deezerUrl) && (
          <div className="mp-links">
            {audiusUrl && <a href={audiusUrl} target="_blank" rel="noopener noreferrer" className="mp-link">Audius</a>}
            {deezerUrl && <a href={deezerUrl} target="_blank" rel="noopener noreferrer" className="mp-link">Deezer</a>}
          </div>
        )}
      </div>
    </div>
  );
};

export default MusicPlayer;
