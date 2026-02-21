# Music Player MCP Server

A music player MCP server built with [mcp-use](https://mcp-use.com) that streams full tracks via [Audius](https://audius.co) with an inline React widget featuring a multi-layer audio visualizer.

## Features

- **Full song streaming** via Audius API (no 30s previews)
- **Inline visualizer widget** with 4 layers: ambient glow orbs, waveform oscilloscope, 48 frequency bars with reflections, and beat-reactive pulse line
- **Deezer metadata** for album art, artist info, and track details
- **Playback controls**: play/pause, seek, skip forward/back, volume
- **Queue system**: add to queue, play next, show queue
- **Same-origin audio proxy** to bypass CSP restrictions

## Tools

| Tool | Description |
|------|-------------|
| `play` | Search and play a song by name |
| `search` | Search for tracks on Audius and Deezer |
| `add-to-queue` | Add a track to the play queue |
| `play-next` | Play the next song from the queue |
| `show-queue` | Show all songs in the queue |
| `now-playing` | Show what's currently playing |
| `volume` | Set volume (0-100) |
| `pause-resume` | Toggle play/pause |
| `next-track` | Skip to next track |
| `previous-track` | Go back to previous track |

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:3000/inspector to test your server.

## Build & Run

```bash
npm run build
npm run start
```

## Deploy

```bash
npm run deploy
```

## Use with Cursor / Claude Desktop / ChatGPT

Add the MCP endpoint URL to your client config:

```json
{
  "mcpServers": {
    "music-player": {
      "url": "http://localhost:3001/mcp"
    }
  }
}
```

Or expose via Cloudflare Tunnel for remote access:

```bash
cloudflared tunnel --url http://localhost:3001
```

## Tech Stack

- [mcp-use](https://mcp-use.com) — MCP server framework with React widget support
- [Audius API](https://audius.co) — Free full-track music streaming
- [Deezer API](https://developers.deezer.com) — Track metadata and album art
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API) — Real-time audio visualization
- React + TypeScript + Tailwind CSS
