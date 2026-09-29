const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

// Armazenamento das salas em memória
const rooms = {};

// Custos e danos das habilidades
const COSTS = { pequeno: 25, medio: 100, grande: 300 };
const DAMAGES = { pequeno: 15, medio: 35, grande: 80 };

io.on("connection", (socket) => {

  // Entrar ou Criar Sala
  socket.on("join_room", ({ name, roomId, maxPerTeam }) => {
    if (!roomId) return socket.emit("error_message", "Código da sala é obrigatório.");

    // Se a sala não existir, cria uma nova
    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        maxPerTeam: maxPerTeam || 1,
        players: [],
        status: "waiting" // waiting, playing, ended
      };
    }

    const room = rooms[roomId];

    // Verificar se a sala está cheia
    if (room.players.length >= room.maxPerTeam * 2) {
      return socket.emit("error_message", "Esta sala já está cheia!");
    }

    // Definir time (A ou B) balanceado
    const countA = room.players.filter(p => p.team === "A").length;
    const countB = room.players.filter(p => p.team === "B").length;
    const team = countA <= countB ? "A" : "B";

    const player = {
      id: socket.id,
      name: name || "Jogador",
      team,
      hp: 100,
      points: 0
    };

    room.players.push(player);
    socket.join(roomId);
    socket.roomId = roomId;

    socket.emit("joined", { player, room });

    // Iniciar partida se atingir o total de jogadores
    if (room.players.length === room.maxPerTeam * 2) {
      room.status = "playing";
      io.to(roomId).emit("battle_start");
    }

    io.to(roomId).emit("room_state", room);
  });

  // Clique para ganhar pontos
  socket.on("click", () => {
    const room = rooms[socket.roomId];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player && player.hp > 0) {
      player.points += 1;
      io.to(room.id).emit("players_update", room);
    }
  });

  // Invocação de Tornados
  socket.on("summon", ({ type, skin }) => {
    const room = rooms[socket.roomId];
    if (!room || room.status !== "playing") return;

    const player = room.players.find(p => p.id === socket.id);
    const cost = COSTS[type];
    const damage = DAMAGES[type];

    if (!player || player.hp <= 0 || player.points < cost) return;

    // Desconta os pontos do atacante
    player.points -= cost;

    // Encontra alvos vivos do time inimigo
    const enemies = room.players.filter(p => p.team !== player.team && p.hp > 0);
    if (enemies.length > 0) {
      // Aplica dano a um inimigo aleatório do outro time
      const target = enemies[Math.floor(Math.random() * enemies.length)];
      target.hp = Math.max(0, target.hp - damage);
    }

    // Dispara animação de tornado para todos na sala
    const sizes = { pequeno: 40, medio: 70, grande: 110 };
    io.to(room.id).emit("tornado", {
      size: sizes[type] || 50,
      skin: skin || "skin-default"
    });

    // Verificar fim de jogo
    const teamAAlive = room.players.some(p => p.team === "A" && p.hp > 0);
    const teamBAlive = room.players.some(p => p.team === "B" && p.hp > 0);

    if (!teamAAlive || !teamBAlive) {
      room.status = "ended";
      const winnerText = !teamAAlive ? "Time B" : "Time A";
      io.to(room.id).emit("battle_end", { winnerText });
    }

    io.to(room.id).emit("players_update", room);
  });

  // Desconexão do jogador
  socket.on("disconnect", () => {
    const room = rooms[socket.roomId];
    if (room) {
      room.players = room.players.filter(p => p.id !== socket.id);

      if (room.players.length === 0) {
        delete rooms[socket.roomId];
      } else {
        io.to(room.id).emit("room_state", room);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor Xverdes rodando na porta ${PORT}`);
});
