import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);

// Configuração do caminho da pasta public
const publicPath = path.join(__dirname, "public");

if (!fs.existsSync(publicPath)) {
  console.error("❌ ERRO: A pasta 'public' não existe. Crie uma pasta chamada 'public' e coloque o 'index.html' dentro dela.");
}

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(express.static(publicPath));

app.get("*", (req, res) => {
  const indexPath = path.join(publicPath, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("Erro: Arquivo public/index.html não foi encontrado no servidor.");
  }
});

const rooms = {};
const tourneys = {};
let matchmakingQueue = [];

const COSTS = { pequeno: 25, medio: 100, grande: 300 };
const DAMAGES = { pequeno: 15, medio: 35, grande: 80 };

function getRankTitle(mmr) {
  if (mmr < 200) return "🟤 Ferro";
  if (mmr < 400) return "⚪ Bronze";
  if (mmr < 600) return "🔘 Prata";
  if (mmr < 800) return "🟡 Ouro";
  if (mmr < 1000) return "🩵 Platina";
  if (mmr < 1300) return "💎 Diamante";
  return "🔥 Desafiante";
}

io.on("connection", (socket) => {

  // --- FILA DE MATCHMAKING (ACHAR PARTIDA) ---
  socket.on("find_match", ({ name, mmr }) => {
    if (matchmakingQueue.some(p => p.id === socket.id)) return;

    const playerWaiting = {
      id: socket.id,
      name: name || "Jogador",
      mmr: mmr || 100,
      socket
    };

    matchmakingQueue.push(playerWaiting);
    socket.emit("queue_status", { inQueue: true, message: "Procurando oponente..." });

    if (matchmakingQueue.length >= 2) {
      const p1 = matchmakingQueue.shift();
      const p2 = matchmakingQueue.shift();

      const roomId = "AUTO_" + Math.random().toString(36).slice(2, 7).toUpperCase();

      rooms[roomId] = {
        id: roomId,
        maxPerTeam: 1,
        isRanked: false,
        players: [
          { id: p1.id, name: p1.name, team: "A", hp: 100, points: 0, mmr: p1.mmr },
          { id: p2.id, name: p2.name, team: "B", hp: 100, points: 0, mmr: p2.mmr }
        ],
        status: "playing"
      };

      const socket1 = p1.socket;
      const socket2 = p2.socket;

      if (socket1) {
        socket1.join(roomId);
        socket1.roomId = roomId;
        socket1.emit("joined", { player: rooms[roomId].players[0], room: rooms[roomId] });
      }

      if (socket2) {
        socket2.join(roomId);
        socket2.roomId = roomId;
        socket2.emit("joined", { player: rooms[roomId].players[1], room: rooms[roomId] });
      }

      io.to(roomId).emit("battle_start");
      io.to(roomId).emit("room_state", rooms[roomId]);
    }
  });

  socket.on("cancel_search", () => {
    matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);
    socket.emit("queue_status", { inQueue: false, message: "Busca cancelada." });
  });

  // --- MODO SALA PADRÃO VIA CÓDIGO & RANQUEADO ---
  socket.on("join_room", ({ name, roomId, maxPerTeam, isRanked, mmr }) => {
    if (!roomId) return socket.emit("error_message", "Código da sala é obrigatório.");

    if (!rooms[roomId]) {
      rooms[roomId] = {
        id: roomId,
        maxPerTeam: maxPerTeam || 1,
        isRanked: !!isRanked,
        players: [],
        status: "waiting"
      };
    }

    const room = rooms[roomId];

    if (room.players.length >= room.maxPerTeam * 2) {
      return socket.emit("error_message", "Esta sala já está cheia!");
    }

    const countA = room.players.filter(p => p.team === "A").length;
    const countB = room.players.filter(p => p.team === "B").length;
    const team = countA <= countB ? "A" : "B";

    const player = {
      id: socket.id,
      name: name || "Jogador",
      team,
      hp: 100,
      points: 0,
      mmr: mmr || 100
    };

    room.players.push(player);
    socket.join(roomId);
    socket.roomId = roomId;

    socket.emit("joined", { player, room });

    if (room.players.length === room.maxPerTeam * 2) {
      room.status = "playing";
      io.to(roomId).emit("battle_start");
    }

    io.to(roomId).emit("room_state", room);
  });

  socket.on("click", () => {
    const room = rooms[socket.roomId];
    if (!room) return;

    const player = room.players.find(p => p.id === socket.id);
    if (player && player.hp > 0) {
      player.points += 1;
      io.to(room.id).emit("players_update", room);
    }
  });

  socket.on("summon", ({ type, skin }) => {
    const room = rooms[socket.roomId];
    if (!room || room.status !== "playing") return;

    const player = room.players.find(p => p.id === socket.id);
    const cost = COSTS[type];
    const damage = DAMAGES[type];

    if (!player || player.hp <= 0 || player.points < cost) return;

    player.points -= cost;

    const enemies = room.players.filter(p => p.team !== player.team && p.hp > 0);
    if (enemies.length > 0) {
      const target = enemies[Math.floor(Math.random() * enemies.length)];
      target.hp = Math.max(0, target.hp - damage);
    }

    const sizes = { pequeno: 40, medio: 70, grande: 110 };
    io.to(room.id).emit("tornado", {
      size: sizes[type] || 50,
      skin: skin || "skin-default"
    });

    const teamAAlive = room.players.some(p => p.team === "A" && p.hp > 0);
    const teamBAlive = room.players.some(p => p.team === "B" && p.hp > 0);

    if (!teamAAlive || !teamBAlive) {
      room.status = "ended";
      const winnerTeam = teamAAlive ? "A" : "B";

      if (room.isRanked) {
        room.players.forEach(p => {
          const isWinner = p.team === winnerTeam;
          const mmrChange = isWinner ? 30 : -20;
          p.mmr = Math.max(0, p.mmr + mmrChange);
          io.to(p.id).emit("ranked_result", {
            won: isWinner,
            change: mmrChange,
            newMmr: p.mmr,
            newRank: getRankTitle(p.mmr)
          });
        });
      }

      if (room.tourneyId) {
        const winnerPlayer = winnerTeam === "A" 
          ? room.players.find(p => p.team === 'A') 
          : room.players.find(p => p.team === 'B');
        handleTourneyMatchEnd(room.tourneyId, room.matchId, winnerPlayer);
      }

      io.to(room.id).emit("battle_end", { winnerText: winnerTeam === "A" ? "Time A" : "Time B" });
    }

    io.to(room.id).emit("players_update", room);
  });

  // --- MODO CAMPEONATO ELIMINATÓRIO (MATA-MATA) ---
  socket.on("create_tourney", ({ name, size }) => {
    const tourneyId = "TORNEIO_" + Math.random().toString(36).slice(2, 7).toUpperCase();
    tourneys[tourneyId] = {
      id: tourneyId,
      size: parseInt(size) || 4,
      players: [{ id: socket.id, name: name || "Jogador 1" }],
      bracket: [],
      currentRound: 0,
      status: "waiting"
    };
    socket.tourneyId = tourneyId;
    socket.join(tourneyId);
    socket.emit("tourney_created", tourneys[tourneyId]);
  });

  socket.on("join_tourney", ({ name, tourneyId }) => {
    const tourney = tourneys[tourneyId];
    if (!tourney) return socket.emit("error_message", "Campeonato não encontrado!");
    if (tourney.status !== "waiting") return socket.emit("error_message", "Campeonato já começou!");
    if (tourney.players.length >= tourney.size) return socket.emit("error_message", "Campeonato lotado!");

    tourney.players.push({ id: socket.id, name: name || `Jogador ${tourney.players.length + 1}` });
    socket.tourneyId = tourneyId;
    socket.join(tourneyId);

    io.to(tourneyId).emit("tourney_update", tourney);

    if (tourney.players.length === tourney.size) {
      startTourney(tourneyId);
    }
  });

  function startTourney(tourneyId) {
    const tourney = tourneys[tourneyId];
    tourney.status = "in_progress";

    const shuffled = [...tourney.players].sort(() => Math.random() - 0.5);
    const matches = [];

    for (let i = 0; i < shuffled.length; i += 2) {
      matches.push({
        id: `M_${tourney.currentRound}_${i / 2}`,
        p1: shuffled[i],
        p2: shuffled[i + 1],
        winner: null
      });
    }

    tourney.bracket.push(matches);
    io.to(tourneyId).emit("tourney_started", tourney);
    launchTourneyMatches(tourneyId);
  }

  function launchTourneyMatches(tourneyId) {
    const tourney = tourneys[tourneyId];
    const currentMatches = tourney.bracket[tourney.currentRound];

    currentMatches.forEach(m => {
      const matchRoomId = `${tourneyId}_${m.id}`;
      rooms[matchRoomId] = {
        id: matchRoomId,
        tourneyId,
        matchId: m.id,
        maxPerTeam: 1,
        players: [
          { id: m.p1.id, name: m.p1.name, team: "A", hp: 100, points: 0 },
          { id: m.p2.id, name: m.p2.name, team: "B", hp: 100, points: 0 }
        ],
        status: "playing"
      };

      const socketP1 = io.sockets.sockets.get(m.p1.id);
      const socketP2 = io.sockets.sockets.get(m.p2.id);

      if (socketP1) {
        socketP1.join(matchRoomId);
        socketP1.roomId = matchRoomId;
        socketP1.emit("joined", { player: rooms[matchRoomId].players[0], room: rooms[matchRoomId] });
      }
      if (socketP2) {
        socketP2.join(matchRoomId);
        socketP2.roomId = matchRoomId;
        socketP2.emit("joined", { player: rooms[matchRoomId].players[1], room: rooms[matchRoomId] });
      }

      io.to(matchRoomId).emit("battle_start");
      io.to(matchRoomId).emit("room_state", rooms[matchRoomId]);
    });
  }

  function handleTourneyMatchEnd(tourneyId, matchId, winnerPlayer) {
    const tourney = tourneys[tourneyId];
    if (!tourney) return;

    const currentMatches = tourney.bracket[tourney.currentRound];
    const match = currentMatches.find(m => m.id === matchId);
    if (match) match.winner = winnerPlayer;

    io.to(tourneyId).emit("tourney_update", tourney);

    const allFinished = currentMatches.every(m => m.winner !== null);
    if (allFinished) {
      const winners = currentMatches.map(m => m.winner);
      if (winners.length === 1) {
        io.to(tourneyId).emit("tourney_champion", { winner: winners[0] });
      } else {
        tourney.currentRound++;
        const nextMatches = [];
        for (let i = 0; i < winners.length; i += 2) {
          nextMatches.push({
            id: `M_${tourney.currentRound}_${i / 2}`,
            p1: winners[i],
            p2: winners[i + 1],
            winner: null
          });
        }
        tourney.bracket.push(nextMatches);
        setTimeout(() => launchTourneyMatches(tourneyId), 4000);
      }
    }
  }

  socket.on("disconnect", () => {
    matchmakingQueue = matchmakingQueue.filter(p => p.id !== socket.id);

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
  console.log(`🚀 Servidor Xverdes rodando na porta ${PORT}`);
});
