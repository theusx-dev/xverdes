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

// Armazenamento das salas em memória
const rooms = {};

const TORNADO_TYPES = {
  pequeno: { cost: 25, damage: 15, size: 40 },
  medio: { cost: 100, damage: 35, size: 70 },
  grande: { cost: 300, damage: 80, size: 110 }
};

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('join_room', ({ name, roomId }) => {
    if (!roomId) return socket.emit('error_message', 'Código de sala inválido.');

    if (!rooms[roomId]) {
      rooms[roomId] = { players: [] };
    }

    const room = rooms[roomId];

    if (room.players.length >= 2) {
      return socket.emit('error_message', 'Sala cheia (máximo 2 jogadores).');
    }

    currentRoom = roomId;
    socket.join(roomId);

    const player = {
      id: socket.id,
      name: name || 'Jogador',
      hp: 100,
      points: 0
    };

    room.players.push(player);

    socket.emit('joined', { player, roomId });
    io.to(roomId).emit('room_state', { players: room.players });

    if (room.players.length === 2) {
      io.to(roomId).emit('battle_start');
    }
  });

  socket.on('click', () => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const player = room.players.find(p => p.id === socket.id);

    if (player && player.hp > 0) {
      player.points += 1;
      io.to(currentRoom).emit('player_update', player);
    }
  });

  socket.on('summon', (type) => {
    if (!currentRoom || !rooms[currentRoom]) return;
    const room = rooms[currentRoom];
    const attacker = room.players.find(p => p.id === socket.id);
    const defender = room.players.find(p => p.id !== socket.id);

    const tData = TORNADO_TYPES[type];
    if (!tData || !attacker || !defender) return;

    if (attacker.points >= tData.cost && attacker.hp > 0 && defender.hp > 0) {
      attacker.points -= tData.cost;
      defender.hp = Math.max(0, defender.hp - tData.damage);

      io.to(currentRoom).emit('tornado', {
        type,
        size: tData.size,
        attackerId: socket.id
      });

      io.to(currentRoom).emit('players_update', room.players);

      if (defender.hp <= 0) {
        io.to(currentRoom).emit('battle_end', { winnerName: attacker.name });
      }
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      rooms[currentRoom].players = rooms[currentRoom].players.filter(p => p.id !== socket.id);
      io.to(currentRoom).emit('players_update', rooms[currentRoom].players);

      if (rooms[currentRoom].players.length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor Xverdes rodando na porta ${PORT}`);
});
