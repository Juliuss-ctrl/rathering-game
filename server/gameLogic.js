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
    code, host: hostSocketId, hostName,
    players: [],
    state: 'lobby',
    pairs: [], currentPair: 0,
    votes: {}, votedThisRound: new Set(),
    // Snapshot der Spieler beim Battle-Start
    battlePlayers: [],
  };
  rooms.set(code, room);
  return room;
}

function joinRoom(code, playerName, socketId) {
  const room = rooms.get(code.toUpperCase());
  if (!room) return { error: 'Room nicht gefunden' };

  // Spieler bereits drin? → nur socket.id updaten, sonst nichts
  const existing = room.players.find(p => p.name === playerName);
  if (existing) {
    existing._oldSocketId = existing.socketId;
    existing.socketId = socketId;
    existing.id = socketId;
    return { room, player: existing };
  }

  // Neuer Spieler — nur in Lobby erlaubt
  if (room.state === 'lobby') {
    const player = { id: socketId, name: playerName, imagePath: null, imageDesc: '', socketId };
    room.players.push(player);
    return { room, player };
  }

  // Spiel läuft und Spieler ist nicht dabei → NICHT hinzufügen
  // Nur socket joinen damit er Events bekommt
  return { room, player: null, spectator: true };
}

function setPlayerImage(code, socketId, imagePath, imageDesc) {
  const room = rooms.get(code);
  if (!room) return null;
  let player = room.players.find(p => p.socketId === socketId);
  if (!player) {
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
  // Snapshot der aktiven Spieler beim Battle-Start speichern
  const imgs = room.players
    .filter(p => p.imagePath)
    .map(p => ({ name: p.name, path: p.imagePath, desc: p.imageDesc }));

  for (let i = imgs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [imgs[i], imgs[j]] = [imgs[j], imgs[i]];
  }
  const pairs = [];
  for (let i = 0; i + 1 < imgs.length; i += 2) pairs.push([imgs[i], imgs[i + 1]]);
  if (imgs.length % 2 === 1) {
  // Random Gegner aus den anderen Bildern wählen
  const last = imgs[imgs.length - 1];
  const others = imgs.slice(0, -1);
  const random = others[Math.floor(Math.random() * others.length)];
  pairs.push([last, { ...random, name: random.name + ' ⭐' }]);
}

  room.pairs = pairs;
  room.currentPair = 0;
  room.votes = {};
  room.votedThisRound = new Set();
  // Anzahl der Wähler = Anzahl Spieler mit Bild (eingefroren beim Start)
  room.voterCount = imgs.length;
  imgs.forEach(img => { room.votes[img.name] = 0; });

  console.log(`Battle started with ${room.voterCount} voters`);
}

function castVote(room, socketId, winnerName) {
  if (room.votedThisRound.has(socketId)) return false;
  room.votedThisRound.add(socketId);
  if (room.votes[winnerName] !== undefined) room.votes[winnerName]++;
  console.log(`Vote: ${winnerName} | ${room.votedThisRound.size} / ${room.voterCount}`);
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