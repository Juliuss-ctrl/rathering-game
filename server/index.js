const express  = require('express');
const http     = require('http');
const { Server } = require('socket.io');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const {
  createRoom, joinRoom, setPlayerImage, allUploaded,
  buildPairs, castVote, allVoted, nextPair, getResults,
  removePlayer, getRoomBySocket, rooms
} = require('./gameLogic');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, '..', 'public');
const UPLOADS = path.join('/tmp', 'uploads');
if (!fs.existsSync(UPLOADS)) fs.mkdirSync(UPLOADS, { recursive: true });

app.use(express.json());
app.use(express.static(PUBLIC));

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.post('/upload', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Kein Bild' });
  try {
    const result = await cloudinary.uploader.upload(req.file.path, {
      folder: 'rathering-game',
      transformation: [{ width: 800, height: 800, crop: 'limit' }]
    });
    fs.unlink(req.file.path, () => {});
    res.json({ path: result.secure_url });
  } catch (err) {
    console.error('Cloudinary error:', err);
    res.status(500).json({ error: 'Upload fehlgeschlagen' });
  }
});

io.on('connection', socket => {
  console.log('+ connected:', socket.id);

  socket.on('create_room', ({ hostName }) => {
    const room = createRoom(socket.id, hostName);
    socket.join(room.code);
    socket.emit('room_created', { code: room.code, hostName });
  });

  socket.on('host_rejoin', ({ code, hostName }) => {
    let room = rooms.get(code);
    if (!room) {
      room = createRoom(socket.id, hostName, code);
      socket.join(room.code);
      socket.emit('host_rejoined', { code: room.code });
    } else {
      room.host = socket.id;
      socket.join(code);
      socket.emit('host_rejoined', { code });
      // Wenn Battle läuft → Seite weiterleiten
      if (room.state === 'battle' && room.pairs.length > 0) {
        socket.emit('phase_battle');
      } else if (room.state === 'upload') {
        socket.emit('phase_upload');
      } else {
        io.to(code).emit('lobby_update', {
          players: room.players.map(p => ({ name: p.name, hasImage: !!p.imagePath })),
          hostName: room.hostName
        });
      }
    }
  });

  socket.on('join_room', ({ code, playerName }) => {
    if (!code || !playerName) return;
    const result = joinRoom(code, playerName, socket.id);
    if (result.error) { socket.emit('error', result.error); return; }
    const room = result.room;
    socket.join(room.code);
    socket.emit('joined_room', { code: room.code, playerName });

    // Alte socket.id aus votedThisRound entfernen
    const oldPlayer = result.player;
    if (oldPlayer && oldPlayer._oldSocketId) {
      room.votedThisRound.delete(oldPlayer._oldSocketId);
    }

    // Spieler auf richtige Seite schicken je nach State
    if (room.state === 'battle') {
      socket.emit('phase_battle');
    } else if (room.state === 'upload') {
      socket.emit('phase_upload');
      io.to(room.code).emit('upload_update', {
        players: room.players.map(p => ({ name: p.name, hasImage: !!p.imagePath }))
      });
    } else {
      io.to(room.code).emit('lobby_update', {
        players: room.players.map(p => ({ name: p.name, hasImage: !!p.imagePath })),
        hostName: room.hostName
      });
    }
  });

  socket.on('start_upload', ({ code }) => {
    const room = rooms.get(code);
    if (!room) { socket.emit('error', 'Room nicht gefunden'); return; }
    if (room.host !== socket.id) { socket.emit('error', 'Nur der Host kann starten'); return; }
    room.state = 'upload';
    io.to(code).emit('phase_upload');
  });

  socket.on('player_upload', ({ code, imagePath, imageDesc, playerName }) => {
    const room = rooms.get(code);
    if (!room) return;
    let player = room.players.find(p => p.socketId === socket.id);
    if (!player) player = room.players.find(p => p.name === playerName);
    if (!player) {
      player = { id: socket.id, name: playerName || room.hostName, imagePath: null, imageDesc: '', socketId: socket.id };
      room.players.push(player);
    }
    player.imagePath = imagePath;
    player.imageDesc = imageDesc;
    const uploaded = room.players.map(p => ({ name: p.name, hasImage: !!p.imagePath }));
    io.to(code).emit('upload_update', { players: uploaded });
    if (room.players.length > 0 && room.players.every(p => p.imagePath)) {
      io.to(code).emit('all_uploaded');
    }
  });

  socket.on('start_battle', ({ code }) => {
    const room = rooms.get(code);
    if (!room) { socket.emit('error', 'Room nicht gefunden'); return; }
    buildPairs(room);
    room.state = 'battle';
    // Alle Spieler zur Battle-Seite schicken
    io.to(code).emit('phase_battle');
    // Kleiner Delay damit alle Zeit haben zu laden
    setTimeout(() => sendCurrentPair(room), 2500);
  });

  socket.on('request_current_pair', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'battle' || !room.pairs.length) return;
    const pair = room.pairs[room.currentPair];
    socket.emit('new_pair', {
      pairIndex: room.currentPair,
      totalPairs: room.pairs.length,
      left:  pair[0],
      right: pair[1],
    });
  });

  socket.on('vote', ({ code, winnerName }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'battle') return;
    const ok = castVote(room, socket.id, winnerName);
    if (!ok) return;
    io.to(code).emit('vote_update', { votedCount: room.votedThisRound.size, total: room.voterCount });
    if (allVoted(room)) {
      const hasMore = nextPair(room);
      if (hasMore) {
        setTimeout(() => sendCurrentPair(room), 1200);
      } else {
        room.state = 'results';
        io.to(code).emit('show_results', { results: getResults(room) });
      }
    }
  });

  socket.on('disconnect', () => {
    const room = getRoomBySocket(socket.id);
    if (room) {
      io.to(room.code).emit('lobby_update', {
        players: room.players.map(p => ({ name: p.name, hasImage: !!p.imagePath })),
        hostName: room.hostName
      });
    }
    removePlayer(socket.id);
  });
});

function sendCurrentPair(room) {
  const pair = room.pairs[room.currentPair];
  io.to(room.code).emit('new_pair', {
    pairIndex: room.currentPair,
    totalPairs: room.pairs.length,
    left:  pair[0],
    right: pair[1],
  });
}

server.listen(PORT, () => console.log(`🎮 Rathering-Game läuft auf http://localhost:${PORT}`));