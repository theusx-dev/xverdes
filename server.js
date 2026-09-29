const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(path.join(__dirname, "public")));

// Fallback para servir o index.html se não estiver dentro da pasta public
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

const rooms = {};

io.on("connection", (socket) => {
  console.log("Novo jogador conectado:", socket.id);

  socket.on("join_room", ({ name, roomId, maxPerTeam }) => {
    let room = rooms[roomId];

    if (!room) {
      room = {
        id: roomId,
        maxPerTeam: maxPerTeam || 1,
        players: [],
        status: "waiting"
      };
      rooms[roomId] = room;
    }

    const teamACount = room.players.filter(p => p.team === 'A').length;
    const teamBCount = room.players.filter(p => p.team === 'B').length;
    let assignedTeam = 'A';

    if (teamACount < room.maxPerTeam) {
      assignedTeam = 'A';
    } else if (teamBCount < room.maxPerTeam) {
      assignedTeam = 'B';
    } else {
      socket.emit("error_message", "Sala cheia!");
      return;
    }

    const newPlayer = {
      id: socket.id,
      name: name || "Jogador",
      team: assignedTeam,
      hp: 100,
      points: 0
    };

    room.players.push(newPlayer);
    socket.join(roomId);
    socket.roomId = roomId;

    socket.emit("joined", { player: newPlayer, room });
    io.to(roomId).emit("room_state", room);

    if (room.players.filter(p => p.team === 'A').length >= room.maxPerTeam &&
        room.players.filter(p => p.team === 'B').length >= room.maxPerTeam) {
      room.status = "playing";
      io.to(roomId).emit("battle_start");
    }
  });

  socket.on("click", () => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player && player.hp > 0) {
      player.points += 1;
      io.to(roomId).emit("players_update", room);
    }
  });

  socket.on("summon", ({ type, skin }) => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (!player || player.hp <= 0) return;

    const costs = { pequeno: 25, medio: 100, grande: 300 };
    const damages = { pequeno: 15, medio: 35, grande: 80 };

    if (player.points >= costs[type]) {
      player.points -= costs[type];

      const enemyTeam = player.team === 'A' ? 'B' : 'A';
      const enemies = room.players.filter(p => p.team === enemyTeam && p.hp > 0);

      if (enemies.length > 0) {
        const target = enemies[Math.floor(Math.random() * enemies.length)];
        target.hp = Math.max(0, target.hp - damages[type]);
      }

      io.to(roomId).emit("tornado", {
        size: costs[type] / 2 + 20,
        skin: skin || 'skin-default'
      });

      io.to(roomId).emit("players_update", room);

      const teamAAlive = room.players.some(p => p.team === 'A' && p.hp > 0);
      const teamBAlive = room.players.some(p => p.team === 'B' && p.hp > 0);

      if (!teamAAlive || !teamBAlive) {
        const winnerText = teamAAlive ? "Time A" : "Time B";
        io.to(roomId).emit("battle_end", { winnerText });
      }
    }
  });

  socket.on("disconnect", () => {
    const roomId = socket.roomId;
    const room = rooms[roomId];
    if (room) {
      room.players = room.players.filter(p => p.id !== socket.id);
      if (room.players.length === 0) {
        delete rooms[roomId];
      } else {
        io.to(roomId).emit("players_update", room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
