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

// Lógica de Salas no Socket.IO
io.on('connection', (socket) => {
  console.log('Jogador conectado:', socket.id);

  // Evento para criar/entrar na sala
  socket.on('criarSala', (nomeSala) => {
    socket.join(nomeSala);
    console.log(`Jogador ${socket.id} entrou na sala: ${nomeSala}`);
    io.to(nomeSala).emit('salaCriada', nomeSala);
  });

  socket.on('disconnect', () => {
    console.log('Jogador desconectado:', socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
