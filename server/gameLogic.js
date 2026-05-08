const rooms = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return rooms.has(code) ? generateCode() : code;
}

function createRoom(hostSocketId, hostName, forceCode) {
  const code = forceCode || generateCode();
  const room = {
    code,
    host: hostSocketId,
    hostName,
    players: [],
    state: 'lobby',
    pairs: [],
    currentPair: 0,
    votes: {},
    votedThisRound: new Set(),
  };
  rooms.set(code, room);
  return room;
}

function joinRoom(code, playerName, socketId) {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room nicht gefunden' };

  const existing = room.players.find(p => p.name === playerName);
  if (existing) {
    existing._oldSocketId = existing.socketId;
    existing.socketId = socketId;
    existing.id = socketId;
    return { room, player: existing };
  }

  if (room.state !== 'lobby') return { error: 'Spiel läuft bereits' };

  const player = { id: socketId, name: playerName, imagePath: null, imageDesc: '', socketId };
  room.players.push(player);
  return { room, player };
}

function setPlayerImage(code, socketId, imagePath, imageDesc) {
  const room = rooms.get(code);
  if (!room) return null;
  // Spieler suchen — auch nach Host-socket
  let player = room.players.find(p => p.socketId === socketId);
  if (!player) {
    // Host lädt auch Bild hoch → als Spieler hinzufügen
    player = { id: socketId, name: room.hostName, imagePath: null, imageDesc: '', socketId };
    room.players.push(player);
  }
  player.imagePath = imagePath;
  player.imageDesc = imageDesc;
  return room;
}

function allUploaded(room) {
  return room.players.length > 0 && room.players.every(p => p.imagePath);
}

function buildPairs(room) {
  const imgs = room.players.map(p => ({ name: p.name, path: p.imagePath, desc: p.imageDesc }));
  for (let i = imgs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
  }
  const pairs = [];
  for (let i = 0; i + 1 < imgs.length; i += 2) pairs.push([imgs[i], imgs[i + 1]]);
  if (imgs.length % 2 === 1) pairs.push([imgs[imgs.length - 1], null]);
  room.pairs = pairs;
  room.currentPair = 0;
  room.votes = {};
  room.votedThisRound = new Set();
  imgs.forEach(img => { room.votes[img.name] = 0; });
}

function castVote(room, socketId, winnerName) {
  // Prüfen ob dieser Socket schon abgestimmt hat
  if (room.votedThisRound.has(socketId)) return false;
  room.votedThisRound.add(socketId);
  if (room.votes[winnerName] !== undefined) room.votes[winnerName]++;
  console.log(`Vote: ${winnerName} | Voted: ${room.votedThisRound.size} / ${room.players.length}`);
  return true;
}

function allVoted(room) {
  // Alle Spieler müssen abgestimmt haben
  return room.votedThisRound.size >= room.players.length;
}

function nextPair(room) {
  room.currentPair++;
  room.votedThisRound = new Set();
  return room.currentPair < room.pairs.length;
}

function getResults(room) {
  return Object.entries(room.votes)
    .sort((a, b) => b[1] - a[1])
    .map(([name, votes]) => {
      const player = room.players.find(p => p.name === name);
      return { name, votes, imagePath: player?.imagePath || '', desc: player?.imageDesc || '' };
    });
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
  removePlayer, getRoomBySocket, rooms
};