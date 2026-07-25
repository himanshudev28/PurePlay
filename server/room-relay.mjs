/**
 * Listening-room relay for PurePlay.
 *
 * A dumb fan-out: every message a client sends is forwarded verbatim to the
 * other clients in the same `?room=` code. It stores nothing and interprets
 * nothing — the message shapes are defined in src/lib/room.ts, and the app's
 * host-election / drift-correction logic lives entirely on the client.
 *
 * Run it beside Vite:
 *   npm run room          # ws://localhost:8787
 *   ROOM_PORT=9000 npm run room
 *
 * Point the app at it with VITE_ROOM_WS in .env, e.g.
 *   VITE_ROOM_WS=ws://localhost:8787          (same machine, multiple tabs/apps)
 *   VITE_ROOM_WS=ws://192.168.1.42:8787       (other devices on your Wi-Fi)
 * For friends over the internet, deploy this file and use a wss:// URL.
 */
import { WebSocketServer } from 'ws'

const PORT = process.env.ROOM_PORT ? Number(process.env.ROOM_PORT) : 8787

const wss = new WebSocketServer({ port: PORT })

/** room code -> set of sockets currently in it */
const rooms = new Map()

wss.on('connection', (socket, req) => {
  const room = new URL(req.url, 'http://localhost').searchParams.get('room') || 'default'

  let peers = rooms.get(room)
  if (!peers) {
    peers = new Set()
    rooms.set(room, peers)
  }
  peers.add(socket)
  console.log(`+ ${room} (${peers.size} in room)`)

  socket.on('message', (data) => {
    const frame = data.toString()
    for (const peer of peers) {
      if (peer !== socket && peer.readyState === peer.OPEN) peer.send(frame)
    }
  })

  socket.on('close', () => {
    peers.delete(socket)
    if (peers.size === 0) rooms.delete(room)
    console.log(`- ${room} (${peers.size} in room)`)
  })
})

console.log(`PurePlay room relay listening on ws://localhost:${PORT}`)
