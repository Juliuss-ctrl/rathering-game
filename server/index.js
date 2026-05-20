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
  removePlayer, getRoomBySocket, rooms, normalizeAvatar, getLeaderboard, getHistory, resetLeaderboard, resetRoomForRematch
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

app.get('/api/leaderboard', (req, res) => {
  res.json({ leaderboard: getLeaderboard(), history: getHistory() });
});

app.post('/api/leaderboard/reset', (req, res) => {
  resetLeaderboard();
  res.json({ ok: true, leaderboard: [], history: [] });
});

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

function publicPlayers(room) {
  return room.players.map(p => ({ name: p.name, avatar: p.avatar, hasImage: !!p.imagePath }));
}

function publicHost(room) {
  return { name: room.hostName, avatar: room.hostAvatar };
}

io.on('connection', socket => {
  console.log('+ connected:', socket.id);

  socket.on('create_room', ({ hostName, avatar, playerId }) => {
    const room = createRoom(socket.id, hostName, undefined, avatar, playerId);
    socket.join(room.code);
    socket.emit('room_created', { code: room.code, hostName, avatar: room.hostAvatar });
  });

  socket.on('host_rejoin', ({ code, hostName, avatar, playerId }) => {
    let room = rooms.get(code);
    if (!room) {
      room = createRoom(socket.id, hostName, code, avatar, playerId);
      socket.join(room.code);
      socket.emit('host_rejoined', { code: room.code, avatar: room.hostAvatar });
    } else {
      room.host = socket.id;
      room.hostAvatar = normalizeAvatar(avatar || room.hostAvatar);
      room.hostPlayerId = playerId || room.hostPlayerId;
      socket.join(code);
      socket.emit('host_rejoined', { code, avatar: room.hostAvatar });
      // Wenn Battle läuft → Seite weiterleiten
      if (room.state === 'battle' && room.pairs.length > 0) {
        socket.emit('phase_battle');
      } else if (room.state === 'upload') {
        socket.emit('phase_upload');
      } else if (room.state === 'results') {
        socket.emit('show_results', { results: getResults(room) });
      } else {
        io.to(code).emit('lobby_update', {
          players: publicPlayers(room),
          host: publicHost(room),
          hostName: room.hostName
        });
      }
    }
  });

  socket.on('join_room', ({ code, playerName, avatar, playerId }) => {
    if (!code || !playerName) return;
    const result = joinRoom(code, playerName, socket.id, avatar, playerId);
    if (result.error) { socket.emit('error', result.error); return; }
    const room = result.room;
    socket.join(room.code);
    socket.emit('joined_room', { code: room.code, playerName, avatar: result.player?.avatar || normalizeAvatar(avatar) });

    // Alte socket.id aus votedThisRound entfernen
    const oldPlayer = result.player;
    if (oldPlayer && oldPlayer._oldSocketId) {
      room.votedThisRound.delete(oldPlayer._oldSocketId);
    }

    // Spieler auf richtige Seite schicken je nach State
    if (room.state === 'battle') {
      socket.emit('phase_battle');
    } else if (room.state === 'results') {
      socket.emit('show_results', { results: getResults(room) });
    } else if (room.state === 'upload') {
      socket.emit('phase_upload');
      io.to(room.code).emit('upload_update', {
        players: publicPlayers(room)
      });
    } else {
      io.to(room.code).emit('lobby_update', {
        players: publicPlayers(room),
        host: publicHost(room),
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

  socket.on('player_upload', ({ code, imagePath, imageDesc, playerName, avatar, playerId }) => {
    const room = rooms.get(code);
    if (!room) return;
    let player = room.players.find(p => p.socketId === socket.id);
    if (!player && playerId) player = room.players.find(p => p.playerId === playerId);
    if (!player) player = room.players.find(p => p.name === playerName);
    if (!player) {
      player = { id: socket.id, playerId: playerId || room.hostPlayerId || socket.id, name: playerName || room.hostName, avatar: normalizeAvatar(avatar || room.hostAvatar), imagePath: null, imageDesc: '', socketId: socket.id };
      room.players.push(player);
    }
    player.playerId = playerId || player.playerId || socket.id;
    player.name = playerName || player.name;
    player.avatar = normalizeAvatar(avatar || player.avatar);
    player.imagePath = imagePath;
    player.imageDesc = imageDesc;
    const uploaded = publicPlayers(room);
    io.to(code).emit('upload_update', { players: uploaded });
    if (room.players.length > 0 && room.players.every(p => p.imagePath)) {
      io.to(code).emit('all_uploaded');
    }
  });

  socket.on('start_battle', ({ code }) => {
    const room = rooms.get(code);
    if (!room) { socket.emit('error', 'Room nicht gefunden'); return; }
    if (room.host !== socket.id) { socket.emit('error', 'Nur der Host kann das Battle starten'); return; }
    if (room.state === 'battle') return;
    buildPairs(room);
    if (!room.pairs.length) {
      room.state = 'results';
      io.to(code).emit('show_results', { results: getResults(room) });
      return;
    }
    room.state = 'battle';
    // Alle Spieler zur Battle-Seite schicken
    io.to(code).emit('phase_battle');
    // Kleiner Delay damit alle Zeit haben zu laden
    setTimeout(() => startCurrentPair(room), 2500);
  });

  socket.on('request_current_pair', ({ code }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'battle' || !room.pairs.length) return;
    const pair = room.pairs[room.currentPair];
    socket.emit('new_pair', {
      pairIndex: room.currentPair,
      totalPairs: room.pairs.length,
      bracketRound: room.bracketRound,
      timerEndsAt: room.timerEndsAt,
      roundSeconds: room.roundSeconds,
      left:  pair[0],
      right: pair[1],
    });
  });

  socket.on('vote', ({ code, winnerId, winnerName }) => {
    const room = rooms.get(code);
    if (!room || room.state !== 'battle') return;
    const ok = castVote(room, socket.id, winnerId, winnerName);
    if (!ok) return;
    io.to(code).emit('vote_update', { votedCount: room.votedThisRound.size, total: room.voterCount });
    if (allVoted(room)) {
      clearRoomTimer(room);
      const hasMore = nextPair(room);
      if (hasMore) {
        setTimeout(() => startCurrentPair(room), 1200);
      } else {
        room.state = 'results';
        io.to(code).emit('show_results', { results: getResults(room) });
      }
    }
  });

  socket.on('check_state', ({ code }) => {
    const room = rooms.get(code);
    if (!room) return;
    if (room.state === 'battle') {
      socket.emit('phase_battle');
    } else if (room.state === 'results') {
      socket.emit('show_results', { results: getResults(room) });
    } else if (room.state === 'upload') {
      socket.emit('phase_upload');
    }
  });

  socket.on('rematch', ({ code }) => {
    const room = rooms.get(code);
    if (!room) { socket.emit('error', 'Room nicht gefunden'); return; }
    if (room.host !== socket.id) { socket.emit('error', 'Nur der Host kann ein Rematch starten'); return; }
    resetRoomForRematch(room);
    io.to(code).emit('rematch_started', {
      code,
      players: publicPlayers(room),
      host: publicHost(room),
      hostName: room.hostName,
    });
    io.to(code).emit('phase_upload');
  });

  socket.on('send_reaction', ({ code, emoji }) => {
    if (!code || !emoji) return;
    io.to(code).emit('reaction_received', { emoji, id: Math.random().toString(36).slice(2) });
  });

  socket.on('disconnect', () => {
    const room = getRoomBySocket(socket.id);
    if (room) {
      io.to(room.code).emit('lobby_update', {
        players: publicPlayers(room),
        host: publicHost(room),
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
    bracketRound: room.bracketRound,
    timerEndsAt: room.timerEndsAt,
    roundSeconds: room.roundSeconds,
    left:  pair[0],
    right: pair[1],
  });
}

function startCurrentPair(room) {
  if (!room || room.state !== 'battle') return;
  room.timerEndsAt = Date.now() + room.roundSeconds * 1000;
  sendCurrentPair(room);
  clearRoomTimer(room);
  room.timerId = setTimeout(() => {
    if (!room || room.state !== 'battle') return;
    io.to(room.code).emit('time_up');
    const hasMore = nextPair(room);
    if (hasMore) {
      setTimeout(() => startCurrentPair(room), 1200);
    } else {
      room.state = 'results';
      io.to(room.code).emit('show_results', { results: getResults(room) });
    }
  }, room.roundSeconds * 1000);
}

function clearRoomTimer(room) {
  if (room.timerId) clearTimeout(room.timerId);
  room.timerId = null;
}

server.listen(PORT, () => console.log(`🎮 Rathering-Game läuft auf http://localhost:${PORT}`));
