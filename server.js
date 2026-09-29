import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server } from 'socket.io';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(__dirname));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const rooms = {};

const TORNADO_TYPES = {
  pequeno: { cost: 25, damage: 15, size: 40 },
  medio: { cost: 100, damage: 35, size: 70 },
  grande: { cost: 300, damage: 80, size: 110 }
};

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join_room', ({ name, roomId, maxPerTeam = 1 }) => {
    if (!roomId) return socket.emit('error_message', 'Código de sala inválido.');

    if (!rooms[roomId]) {
      rooms[roomId] = { players: [], maxPerTeam };
    }

    const room = rooms[roomId];
    const totalMax = room.maxPerTeam * 2;

    if (room.players.length >= totalMax) {
      return socket.emit('error_message', 'Sala cheia!');
    }

    currentRoom = roomId;
    socket.join(roomId);

    // Divisão automática de times (A ou B)
    const teamA = room.players.filter(p => p.team === 'A').length;
    const teamB = room.players.filter(p => p.team === 'B').length;
    const assignedTeam = teamA <= teamB ? 'A' : 'B';

    const player = {
      id: socket.id,
      name: name || 'Jogador',
      team: assignedTeam,
      hp: 100,
      points: 0
    };

    room.players.push(player);

    socket.emit('joined', { player, roomId });
    io.to(roomId).emit('room_state', { players: room.players });

    if (room.players.length === totalMax) {
      io.to(roomId).emit('battle_start');
    }
  });

  socket.on('click', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const player = room.players.find(p => p.id === socket.id);

    if (player && player.hp > 0) {
      player.points += 1;
      io.to(currentRoom).emit('players_update', { players: room.players });
    }
  });

  socket.on('summon', ({ type, skin }) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const attacker = room.players.find(p => p.id === socket.id);
    if (!attacker || attacker.hp <= 0) return;

    const tData = TORNADO_TYPES[type];
    if (!tData || attacker.points < tData.cost) return;

    const enemies = room.players.filter(p => p.team !== attacker.team && p.hp > 0);
    if (enemies.length === 0) return;

    attacker.points -= tData.cost;
    
    // Divide o dano entre o time inimigo
    const damagePerEnemy = Math.ceil(tData.damage / enemies.length);
    enemies.forEach(e => {
      e.hp = Math.max(0, e.hp - damagePerEnemy);
    });

    io.to(currentRoom).emit('tornado', {
      type,
      size: tData.size,
      skin: skin || 'skin-default'
    });

    io.to(currentRoom).emit('players_update', { players: room.players });

    // Verifica se algum time foi eliminado
    const teamAAlive = room.players.some(p => p.team === 'A' && p.hp > 0);
    const teamBAlive = room.players.some(p => p.team === 'B' && p.hp > 0);

    if (!teamAAlive || !teamBAlive) {
      const winnerText = teamAAlive ? 'Time A' : 'Time B';
      io.to(currentRoom).emit('battle_end', { winnerText });
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].players = rooms[currentRoom].players.filter(p => p.id !== socket.id);
      io.to(currentRoom).emit('players_update', { players: rooms[currentRoom].players });

      if (rooms[currentRoom].players.length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
