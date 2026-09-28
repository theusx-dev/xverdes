import express from "express";
import { createServer } from "node:http";
import { Server } from "socket.io";
import { randomUUID } from "node:crypto";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);
app.use(express.static("public"));

const players = new Map();
const rooms = new Map();

const TORNADOS = {
  pequeno: { cost: 25, damage: 8, size: 70 },
  medio:   { cost: 100, damage: 22, size: 110 },
  grande:  { cost: 300, damage: 50, size: 160 }
};

function publicPlayer(p) {
  return { id:p.id, name:p.name, points:p.points, hp:p.hp, connected:true };
}

function roomState(room) {
  const ids = [...room.players];
  return ids.map(id => players.get(id)).filter(Boolean).map(publicPlayer);
}

function sendRoom(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  io.to(roomId).emit("room_state", {
    players: roomState(room),
    started: room.players.size === 2,
    roomId
  });
}

function joinRoom(socket, name, roomId) {
  name = String(name || "Jogador").slice(0,18);
  roomId = String(roomId || "").trim().toUpperCase().slice(0,8) || randomUUID().slice(0,6).toUpperCase();

  if (!rooms.has(roomId)) rooms.set(roomId, {players:new Set()});
  const room = rooms.get(roomId);

  if (room.players.size >= 2) {
    socket.emit("error_message", "Essa sala já está cheia.");
    return;
  }

  const p = { id:socket.id, name, points:0, hp:100, roomId };
  players.set(socket.id, p);
  room.players.add(socket.id);
  socket.join(roomId);
  socket.emit("joined", { roomId, player: publicPlayer(p) });
  sendRoom(roomId);

  if (room.players.size === 2) {
    io.to(roomId).emit("battle_start");
  }
}

io.on("connection", socket => {
  socket.on("join_room", ({name, roomId}) => joinRoom(socket, name, roomId));

  socket.on("click", () => {
    const p = players.get(socket.id);
    if (!p) return;
    p.points += 1;
    io.to(p.roomId).emit("player_update", publicPlayer(p));
  });

  socket.on("summon", type => {
    const p = players.get(socket.id);
    if (!p || !TORNADOS[type]) return;
    const t = TORNADOS[type];
    if (p.points < t.cost || p.hp <= 0) return;

    p.points -= t.cost;
    const room = rooms.get(p.roomId);
    if (!room) return;

    const opponentId = [...room.players].find(id => id !== p.id);
    const opponent = opponentId ? players.get(opponentId) : null;
    if (opponent) {
      opponent.hp = Math.max(0, opponent.hp - t.damage);
    }

    io.to(p.roomId).emit("tornado", {
      attackerId:p.id, type, size:t.size, damage:t.damage
    });

    io.to(p.roomId).emit("players_update",
      roomState(room)
    );

    if (opponent && opponent.hp === 0) {
      io.to(p.roomId).emit("battle_end", {
        winnerId:p.id,
        winnerName:p.name
      });
    }
  });

  socket.on("disconnect", () => {
    const p = players.get(socket.id);
    if (!p) return;
    const room = rooms.get(p.roomId);
    if (room) {
      room.players.delete(socket.id);
      socket.leave(p.roomId);
      sendRoom(p.roomId);
      if (room.players.size === 0) rooms.delete(p.roomId);
    }
    players.delete(socket.id);
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Xverdes multiplayer rodando em http://localhost:${PORT}`);
});
