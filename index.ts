import { MCPServer, text, object, widget } from "mcp-use/server";
import { z } from "zod";
import { exec } from "child_process";

const port = process.env.PORT ? parseInt(process.env.PORT) : 5000;

const server = new MCPServer({
  name: "music-player-mcp",
  title: "Music Player",
  version: "3.0.0",
  description: "Search and play full songs inline with a beautiful audio player widget.",
  host: process.env.HOST ?? "0.0.0.0",
  baseUrl: process.env.MCP_URL || `http://localhost:${port}`,
});

// ── State ──

interface NowPlaying {
  title: string;
  url: string;
  startedAt: string;
  status: "playing" | "paused" | "stopped";
}

let nowPlaying: NowPlaying | null = null;
let queue: { title: string; url: string }[] = [];

// ── Helpers ──

function fmt(s: number): string {
  if (!s || isNaN(s)) return "0:00";
  return Math.floor(s / 60) + ":" + String(Math.floor(s % 60)).padStart(2, "0");
}

function runPowerShell(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(
      `powershell -NoProfile -NonInteractive -Command "${command.replace(/"/g, '\\"')}"`,
      { timeout: 15000 },
      (err, stdout, stderr) => {
        if (err) reject(new Error(stderr || err.message));
        else resolve(stdout.trim());
      }
    );
  });
}

// ── Audius API (full song streaming, free, no auth) ──

interface AudiusTrack {
  id: string;
  title: string;
  artist: string;
  duration: number;
  artworkUrl: string;
  audiusUrl: string;
}

async function searchAudius(query: string): Promise<AudiusTrack[]> {
  try {
    const res = await fetch(
      `https://api.audius.co/v1/tracks/search?query=${encodeURIComponent(query)}&limit=5`,
      { signal: AbortSignal.timeout(10000) }
    );
    const data = await res.json();
    if (!data.data) return [];
    return data.data
      .filter((t: any) => t.id && t.duration > 0)
      .map((t: any) => ({
        id: t.id,
        title: t.title || "Unknown",
        artist: t.user?.name || "",
        duration: t.duration,
        artworkUrl: t.artwork?.["480x480"] || t.artwork?.["150x150"] || "",
        audiusUrl: `https://audius.co/tracks/${t.id}`,
      }));
  } catch {
    return [];
  }
}

// ── Audio proxy: streams Audius audio through our server (same-origin, no CSP) ──

server.get("/stream/:trackId", async (c) => {
  const trackId = c.req.param("trackId");
  const streamUrl = `https://api.audius.co/v1/tracks/${trackId}/stream`;

  const reqHeaders: Record<string, string> = {
    "User-Agent": "MusicPlayerMCP/1.0",
  };
  const range = c.req.header("Range");
  if (range) reqHeaders["Range"] = range;

  try {
    const audioRes = await fetch(streamUrl, { headers: reqHeaders, redirect: "follow" });

    if (!audioRes.ok && audioRes.status !== 206) {
      return c.text("Stream not available", 404);
    }

    const respHeaders: Record<string, string> = {
      "Content-Type": audioRes.headers.get("Content-Type") || "audio/mpeg",
      "Access-Control-Allow-Origin": "*",
      "Accept-Ranges": "bytes",
      "Cache-Control": "public, max-age=600",
    };

    const cl = audioRes.headers.get("Content-Length");
    if (cl) respHeaders["Content-Length"] = cl;
    const cr = audioRes.headers.get("Content-Range");
    if (cr) respHeaders["Content-Range"] = cr;

    return new Response(audioRes.body, { status: audioRes.status, headers: respHeaders });
  } catch {
    return c.text("Stream error", 502);
  }
});

// ── Deezer Search (for metadata + album art + fallback preview) ──

interface DeezerTrack {
  title: string;
  artist: string;
  album: string;
  previewUrl: string;
  coverUrl: string;
  duration: number;
  deezerUrl: string;
}

async function searchDeezer(query: string): Promise<DeezerTrack[]> {
  try {
    const res = await fetch(
      `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=5`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    if (!data.data) return [];
    return data.data.map((t: any) => ({
      title: t.title,
      artist: t.artist?.name || "",
      album: t.album?.title || "",
      previewUrl: t.preview,
      coverUrl: t.album?.cover_big || t.album?.cover_medium || "",
      duration: t.duration,
      deezerUrl: t.link,
    }));
  } catch {
    return [];
  }
}

// ── Tools ──

server.tool(
  {
    name: "play",
    description: "Play a song by name. Streams the full track inline in chat.",
    schema: z.object({
      query: z.string().describe("Song name, artist, or keywords"),
    }),
    widget: {
      name: "music-player",
      invoking: "Searching for your song...",
      invoked: "Now playing",
    },
  },
  async ({ query }) => {
    const [audiusResults, deezerResults] = await Promise.all([
      searchAudius(query),
      searchDeezer(query),
    ]);

    const audiusTrack = audiusResults[0];
    const deezerTrack = deezerResults[0];

    if (!audiusTrack && !deezerTrack) return text(`No results found for "${query}"`);

    const title = deezerTrack?.title || audiusTrack?.title || query;
    const artist = deezerTrack?.artist || audiusTrack?.artist || "";

    nowPlaying = {
      title,
      url: audiusTrack?.audiusUrl || deezerTrack?.deezerUrl || "",
      startedAt: new Date().toISOString(),
      status: "playing",
    };

    return widget({
      props: {
        title,
        artist,
        album: deezerTrack?.album || "",
        coverUrl: deezerTrack?.coverUrl || audiusTrack?.artworkUrl || "",
        audiusTrackId: audiusTrack?.id || "",
        audiusDuration: audiusTrack?.duration || 0,
        previewUrl: deezerTrack?.previewUrl || "",
        deezerUrl: deezerTrack?.deezerUrl || "",
        audiusUrl: audiusTrack?.audiusUrl || "",
      },
      output: text(`▶ Now playing: ${title} by ${artist}${audiusTrack ? " (full track)" : " (preview)"}`),
    });
  }
);

server.tool(
  {
    name: "search",
    description: "Search for songs. Returns a list of results to pick from.",
    schema: z.object({
      query: z.string().describe("Song name, artist, or keywords"),
    }),
  },
  async ({ query }) => {
    const [audiusResults, deezerResults] = await Promise.all([
      searchAudius(query),
      searchDeezer(query),
    ]);

    if (audiusResults.length === 0 && deezerResults.length === 0) {
      return text(`No results found for "${query}"`);
    }

    const lines: string[] = [];
    audiusResults.slice(0, 3).forEach((r, i) => {
      lines.push(`${i + 1}. ${r.title} - ${r.artist} (${fmt(r.duration)}, full track)`);
    });
    deezerResults.slice(0, 3).forEach((r, i) => {
      lines.push(`${audiusResults.length + i + 1}. ${r.title} - ${r.artist} (${r.album})`);
    });

    return text(`🔍 Results for "${query}":\n\n${lines.join("\n")}\n\nSay "play <name>" to play.`);
  }
);

server.tool(
  {
    name: "add-to-queue",
    description: "Add a song to the play queue.",
    schema: z.object({
      query: z.string().describe("Song name or YouTube URL"),
    }),
  },
  async ({ query }) => {
    let entry: { title: string; url: string };
    if (query.startsWith("http")) {
      entry = { title: query, url: query };
    } else {
      const results = await searchAudius(query);
      if (results.length === 0) return text(`No results found for "${query}"`);
      entry = { title: results[0].title, url: results[0].audiusUrl };
    }
    queue.push(entry);
    return text(`Added to queue (#${queue.length}): ${entry.title}`);
  }
);

server.tool(
  {
    name: "play-next",
    description: "Play the next song from the queue.",
    schema: z.object({}),
  },
  async () => {
    if (queue.length === 0) return text("Queue is empty.");
    const next = queue.shift()!;
    nowPlaying = { title: next.title, url: next.url, startedAt: new Date().toISOString(), status: "playing" };
    return text(`▶ Now playing: ${next.title}\n📋 ${queue.length} song(s) remaining`);
  }
);

server.tool(
  {
    name: "show-queue",
    description: "Show all songs in the play queue.",
    schema: z.object({}),
  },
  async () => {
    if (queue.length === 0) return text("Queue is empty.");
    const formatted = queue.map((s, i) => `${i + 1}. ${s.title}`).join("\n");
    return text(`📋 Queue (${queue.length}):\n\n${formatted}`);
  }
);

server.tool(
  {
    name: "now-playing",
    description: "Show what's currently playing.",
    schema: z.object({}),
  },
  async () => {
    if (!nowPlaying) return text("Nothing is playing right now.");
    return text(
      `🎵 Now Playing: ${nowPlaying.title}\n   Status: ${nowPlaying.status}\n   URL: ${nowPlaying.url}\n   Started: ${nowPlaying.startedAt}\n   Queue: ${queue.length} song(s) up next`
    );
  }
);

server.tool(
  {
    name: "volume",
    description: "Set the system volume (0-100) on the host machine.",
    schema: z.object({
      level: z.number().min(0).max(100).describe("Volume level 0-100"),
    }),
  },
  async ({ level }) => {
    await runPowerShell(
      `$wshShell = New-Object -ComObject WScript.Shell; ` +
        `1..50 | ForEach-Object { $wshShell.SendKeys([char]174) }; ` +
        `1..${Math.round(level / 2)} | ForEach-Object { $wshShell.SendKeys([char]175) }`
    );
    return text(`🔊 Volume set to ${level}%`);
  }
);

server.tool(
  {
    name: "pause-resume",
    description: "Toggle play/pause on the current media.",
    schema: z.object({}),
  },
  async () => {
    await runPowerShell(`$wshShell = New-Object -ComObject WScript.Shell; $wshShell.SendKeys([char]179)`);
    if (nowPlaying) nowPlaying.status = nowPlaying.status === "playing" ? "paused" : "playing";
    return text(nowPlaying ? `⏯ ${nowPlaying.status === "playing" ? "Resumed" : "Paused"}: ${nowPlaying.title}` : "⏯ Toggled play/pause");
  }
);

server.tool(
  {
    name: "next-track",
    description: "Skip to next track (media key).",
    schema: z.object({}),
  },
  async () => {
    await runPowerShell(`$wshShell = New-Object -ComObject WScript.Shell; $wshShell.SendKeys([char]176)`);
    return text("⏭ Skipped to next track");
  }
);

server.tool(
  {
    name: "previous-track",
    description: "Go back to previous track (media key).",
    schema: z.object({}),
  },
  async () => {
    await runPowerShell(`$wshShell = New-Object -ComObject WScript.Shell; $wshShell.SendKeys([char]177)`);
    return text("⏮ Back to previous track");
  }
);

// ── Resources ──

server.resource(
  {
    name: "player-status",
    uri: "music://status",
    description: "Current player status, now playing, and queue",
  },
  async () =>
    object({
      nowPlaying,
      queueLength: queue.length,
      queue: queue.map((s) => s.title),
    })
);

// ── Start ──

console.log(`Music Player MCP server running on port ${port}`);
server.listen(port);
