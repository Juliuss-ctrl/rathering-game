const fs = require('fs');
const path = require('path');

const rooms = new Map();
const leaderboard = new Map();
const history = [];
const DEFAULT_AVATAR = '🙂';
const RANK_POINTS = [3, 2, 1];
const LEADERBOARD_FILE = process.env.LEADERBOARD_FILE || path.join(__dirname, 'data', 'leaderboard.json');

loadLeaderboard();

function normalizeAvatar(avatar) {
  return typeof avatar === 'string' && avatar.trim() ? avatar.trim().slice(0, 4) : DEFAULT_AVATAR;
}

function normalizePlayerId(playerId, fallback) {
  return typeof playerId === 'string' && playerId.trim() ? playerId.trim().slice(0, 80) : fallback;
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateCode() : code;
}

function createRoom(hostSocketId, hostName, forceCode, hostAvatar, hostPlayerId) {
  const code = forceCode || generateCode();
  const room = {
    code,
    host: hostSocketId,
    hostName,
    hostAvatar: normalizeAvatar(hostAvatar),
    hostPlayerId: normalizePlayerId(hostPlayerId, `host:${hostSocketId}`),
    players: [],
    state: 'lobby',
    pairs: [], currentPair: 0,
    votes: {}, votedThisRound: new Set(),
    leaderboardScored: false,
    // Snapshot der Spieler beim Battle-Start
    battlePlayers: [],
  };
  rooms.set(code, room);
  return room;
}

function joinRoom(code, playerName, socketId, avatar, playerId) {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room nicht gefunden' };
  const normalizedPlayerId = normalizePlayerId(playerId, `socket:${socketId}`);

  // Spieler bereits drin? → nur socket.id updaten, sonst nichts
  const existing = playerId
    ? room.players.find(p => p.playerId === normalizedPlayerId)
    : room.players.find(p => p.name === playerName);
  if (existing) {
    existing._oldSocketId = existing.socketId;
    existing.socketId = socketId;
    existing.id = socketId;
    existing.playerId = normalizedPlayerId;
    existing.name = playerName || existing.name;
    existing.avatar = normalizeAvatar(avatar || existing.avatar);
    return { room, player: existing };
  }

  // Neuer Spieler — nur in Lobby erlaubt
  if (room.state === 'lobby') {
    const player = { id: socketId, playerId: normalizedPlayerId, name: playerName, avatar: normalizeAvatar(avatar), imagePath: null, imageDesc: '', socketId };
    room.players.push(player);
    return { room, player };
  }

  // Spiel läuft und Spieler ist nicht dabei → NICHT hinzufügen
  // Nur socket joinen damit er Events bekommt
  return { room, player: null, spectator: true };
}

function setPlayerImage(code, socketId, imagePath, imageDesc, avatar, playerName, playerId) {
  const room = rooms.get(code);
  if (!room) return null;
  let player = room.players.find(p => p.socketId === socketId);
  const normalizedPlayerId = normalizePlayerId(playerId, room.host === socketId ? room.hostPlayerId : `socket:${socketId}`);
  if (!player) player = room.players.find(p => p.playerId === normalizedPlayerId);
  if (!player) {
    player = { id: socketId, playerId: normalizedPlayerId, name: playerName || room.hostName, avatar: normalizeAvatar(avatar || room.hostAvatar), imagePath: null, imageDesc: '', socketId };
    room.players.push(player);
  }
  player.name = playerName || player.name;
  player.playerId = normalizedPlayerId;
  player.avatar = normalizeAvatar(avatar || player.avatar);
  player.imagePath = imagePath;
  player.imageDesc = imageDesc;
  return room;
}

function allUploaded(room) {
  return room.players.length > 0 && room.players.every(p => p.imagePath);
}

function buildPairs(room) {
  // Snapshot der aktiven Spieler beim Battle-Start speichern
  const imgs = room.players
    .filter(p => p.imagePath)
    .map(p => ({ playerId: p.playerId, name: p.name, avatar: p.avatar || DEFAULT_AVATAR, path: p.imagePath, desc: p.imageDesc }));

  for (let i = imgs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
  }

  const pairs = [];
  for (let i = 0; i < imgs.length; i++) {
    for (let j = i + 1; j < imgs.length; j++) {
      pairs.push([imgs[i], imgs[j]]);
    }
  }

  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }

  room.pairs = pairs;
  room.currentPair = 0;
  room.votes = {};
  room.votedThisRound = new Set();
  // Anzahl der Wähler = Anzahl Spieler mit Bild (eingefroren beim Start)
  room.voterCount = imgs.length;
  room.battlePlayers = imgs;
  imgs.forEach(img => { room.votes[img.playerId] = 0; });

  console.log(`Battle started with ${room.voterCount} voters`);
}

function castVote(room, socketId, winnerId, winnerName) {
  if (room.votedThisRound.has(socketId)) return false;
  room.votedThisRound.add(socketId);
  const voteKey = winnerId || room.battlePlayers.find(p => p.name === winnerName)?.playerId;
  if (room.votes[voteKey] !== undefined) room.votes[voteKey]++;
  console.log(`Vote: ${winnerName || voteKey} | ${room.votedThisRound.size} / ${room.voterCount}`);
  return true;
}

function allVoted(room) {
  // Vergleiche mit eingefrorenem voterCount vom Battle-Start
  return room.votedThisRound.size >= room.voterCount;
}

function nextPair(room) {
  room.currentPair++;
  room.votedThisRound = new Set();
  return room.currentPair < room.pairs.length;
}

function getResults(room) {
  const results = Object.entries(room.votes)
    .sort((a, b) => b[1] - a[1])
    .map(([playerId, votes]) => {
      const player = room.players.find(p => p.playerId === playerId) || room.battlePlayers.find(p => p.playerId === playerId);
      return {
        playerId,
        name: player?.name || 'Unbekannt',
        votes,
        avatar: player?.avatar || DEFAULT_AVATAR,
        imagePath: player?.imagePath || player?.path || '',
        desc: player?.imageDesc || player?.desc || ''
      };
    });

  awardLeaderboardPoints(room, results);
  return results;
}

function awardLeaderboardPoints(room, results) {
  if (room.leaderboardScored) return;

  results.slice(0, RANK_POINTS.length).forEach((result, index) => {
    const points = RANK_POINTS[index];
    const key = result.playerId || result.name;
    const current = leaderboard.get(key) || {
      playerId: key,
      name: result.name,
      avatar: result.avatar || DEFAULT_AVATAR,
      imagePath: result.imagePath || '',
      points: 0,
      games: 0,
      wins: 0,
    };

    current.name = result.name || current.name;
    current.avatar = result.avatar || current.avatar || DEFAULT_AVATAR;
    current.imagePath = result.imagePath || current.imagePath || '';
    current.points += points;
    current.games += 1;
    if (index === 0) current.wins += 1;
    leaderboard.set(key, current);

    history.unshift({
      id: `${room.code}-${Date.now()}-${index + 1}-${key}`,
      date: new Date().toISOString(),
      roomCode: room.code,
      rank: index + 1,
      points,
      votes: result.votes,
      playerId: key,
      name: result.name,
      avatar: result.avatar || DEFAULT_AVATAR,
      imagePath: result.imagePath || '',
    });
  });

  room.leaderboardScored = true;
  saveLeaderboard();
}

function getLeaderboard() {
  return Array.from(leaderboard.values())
    .sort((a, b) => b.points - a.points || b.wins - a.wins || a.name.localeCompare(b.name));
}

function getHistory(limit = 30) {
  return history.slice(0, limit);
}

function resetLeaderboard() {
  leaderboard.clear();
  history.length = 0;
  saveLeaderboard();
}

function loadLeaderboard() {
  try {
    if (!fs.existsSync(LEADERBOARD_FILE)) return;
    const raw = fs.readFileSync(LEADERBOARD_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed : parsed.leaderboard;
    const savedHistory = Array.isArray(parsed.history) ? parsed.history : [];
    if (!Array.isArray(entries)) return;

    entries.forEach(entry => {
      if (!entry || typeof entry.name !== 'string') return;
      const playerId = normalizePlayerId(entry.playerId, entry.name);
      leaderboard.set(playerId, {
        playerId,
        name: entry.name,
        avatar: normalizeAvatar(entry.avatar),
        imagePath: typeof entry.imagePath === 'string' ? entry.imagePath : '',
        points: Number(entry.points) || 0,
        games: Number(entry.games) || 0,
        wins: Number(entry.wins) || 0,
      });
    });
    history.push(...savedHistory.filter(item => item && typeof item.name === 'string'));
  } catch (err) {
    console.error('Leaderboard konnte nicht geladen werden:', err.message);
  }
}

function saveLeaderboard() {
  try {
    fs.mkdirSync(path.dirname(LEADERBOARD_FILE), { recursive: true });
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify({
      leaderboard: getLeaderboard(),
      history: getHistory(200),
    }, null, 2));
  } catch (err) {
    console.error('Leaderboard konnte nicht gespeichert werden:', err.message);
  }
}

function removePlayer(socketId) {
  for (const [code, room] of rooms) {
    const idx = room.players.findIndex(p => p.socketId === socketId);
    if (idx !== -1) { room.players.splice(idx, 1); return room; }
    if (room.host === socketId) { rooms.delete(code); return null; }
  }
  return undefined;
}

function getRoomBySocket(socketId) {
  for (const room of rooms.values()) {
    if (room.host === socketId) return room;
    if (room.players.find(p => p.socketId === socketId)) return room;
  }
  return null;
}

module.exports = {
  createRoom, joinRoom, setPlayerImage, allUploaded,
  buildPairs, castVote, allVoted, nextPair, getResults,
  removePlayer, getRoomBySocket, rooms, normalizeAvatar, getLeaderboard, getHistory, resetLeaderboard
};
