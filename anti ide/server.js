/**
 * Amour Vault — Private & Ephemeral Couple Chat Relay Server
 * Lightweight HTTP static file server + WebSocket Room Relay
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = process.env.PORT || 3000;
const MAX_EXPIRY_MS = 48 * 60 * 60 * 1000; // 48 hours lifespan

// MIME types for static serving
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.webm': 'audio/webm'
};

// Create HTTP server
const server = http.createServer((req, res) => {
  let reqPath = req.url.split('?')[0];
  if (reqPath === '/' || reqPath === '') {
    reqPath = '/index.html';
  }

  const filePath = path.join(__dirname, reqPath);
  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('500 Internal Server Error');
      }
    } else {
      res.writeHead(200, {
        'Content-Type': contentType,
        'Cache-Control': 'no-cache, no-store, must-revalidate'
      });
      res.end(content);
    }
  });
});

// Setup WebSocket Server
const wss = new WebSocketServer({ server });

// Rooms: roomId -> Set of ws clients
const rooms = new Map();
// Ephemeral Message Store: roomId -> Array of { id, payload, createdAt, expiresAt }
const ephemeralStorage = new Map();

// Periodic 48-Hour Cleanup interval (runs every 60 seconds)
setInterval(() => {
  const now = Date.now();
  for (const [roomId, messages] of ephemeralStorage.entries()) {
    const validMessages = messages.filter(msg => msg.expiresAt > now);
    if (validMessages.length !== messages.length) {
      ephemeralStorage.set(roomId, validMessages);
    }
    if (validMessages.length === 0 && (!rooms.get(roomId) || rooms.get(roomId).size === 0)) {
      ephemeralStorage.delete(roomId);
    }
  }
}, 60 * 1000);

wss.on('connection', (ws) => {
  let currentRoomId = null;
  let clientName = 'Guest';

  ws.on('message', (raw) => {
    try {
      const data = JSON.parse(raw.toString());

      switch (data.type) {
        case 'join': {
          const { roomId, name } = data;
          if (!roomId) return;

          currentRoomId = roomId;
          clientName = name || 'Partner';

          if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
          }
          rooms.get(roomId).add(ws);

          // Notify room of active members
          const activeCount = rooms.get(roomId).size;
          broadcastToRoom(roomId, {
            type: 'room_presence',
            activeCount,
            user: clientName,
            status: 'online'
          });

          // Send current ephemeral messages for this room (encrypted ciphertext)
          const existing = ephemeralStorage.get(roomId) || [];
          const now = Date.now();
          const activeMessages = existing.filter(m => m.expiresAt > now);
          
          ws.send(JSON.stringify({
            type: 'history_sync',
            messages: activeMessages
          }));

          break;
        }

        case 'chat_message': {
          const { roomId, message } = data;
          if (!roomId || !message) return;

          const now = Date.now();
          const fullMessage = {
            ...message,
            createdAt: message.createdAt || now,
            expiresAt: message.expiresAt || (now + MAX_EXPIRY_MS)
          };

          // Store in room ephemeral buffer
          if (!ephemeralStorage.has(roomId)) {
            ephemeralStorage.set(roomId, []);
          }
          ephemeralStorage.get(roomId).push(fullMessage);

          // Relay to everyone in the room
          broadcastToRoom(roomId, {
            type: 'new_message',
            message: fullMessage
          });
          break;
        }

        case 'heartbeat_pulse': {
          const { roomId, sender } = data;
          if (!roomId) return;
          broadcastToRoom(roomId, {
            type: 'heartbeat_pulse',
            sender: sender || clientName
          }, ws); // exclude sender if desired or include
          break;
        }

        case 'typing': {
          const { roomId, isTyping, sender } = data;
          if (!roomId) return;
          broadcastToRoom(roomId, {
            type: 'typing',
            sender: sender || clientName,
            isTyping: !!isTyping
          }, ws);
          break;
        }

        case 'delete_message': {
          const { roomId, messageId } = data;
          if (!roomId || !messageId) return;

          if (ephemeralStorage.has(roomId)) {
            const filtered = ephemeralStorage.get(roomId).filter(m => m.id !== messageId);
            ephemeralStorage.set(roomId, filtered);
          }

          broadcastToRoom(roomId, {
            type: 'message_deleted',
            messageId
          });
          break;
        }

        case 'clear_room': {
          const { roomId } = data;
          if (!roomId) return;
          ephemeralStorage.delete(roomId);
          broadcastToRoom(roomId, {
            type: 'room_cleared'
          });
          break;
        }
      }
    } catch (e) {
      console.error('Error handling WebSocket message:', e);
    }
  });

  ws.on('close', () => {
    if (currentRoomId && rooms.has(currentRoomId)) {
      const roomSet = rooms.get(currentRoomId);
      roomSet.delete(ws);
      const remainingCount = roomSet.size;

      if (remainingCount === 0) {
        rooms.delete(currentRoomId);
      } else {
        broadcastToRoom(currentRoomId, {
          type: 'room_presence',
          activeCount: remainingCount,
          user: clientName,
          status: 'offline'
        });
      }
    }
  });
});

function broadcastToRoom(roomId, payload, excludeWs = null) {
  if (!rooms.has(roomId)) return;
  const json = JSON.stringify(payload);
  for (const client of rooms.get(roomId)) {
    if (client !== excludeWs && client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}

server.listen(PORT, () => {
  console.log(`✨ Hillclimb Server running at http://localhost:${PORT}`);
  console.log(`🔒 Ready for private couple communication with 48h auto-destruct.`);
});
