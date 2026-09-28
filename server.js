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

// Servir arquivos estáticos da pasta
app.use(express.static(__dirname));

// Rota corrigida para entregar o index.html
app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Lógica do Socket.IO
io.on('connection', (socket) => {
  console.log('Novo jogador conectado:', socket.id);

  socket.on('disconnect', () => {
    console.log('Jogador desconectado:', socket.id);
  });
});

// Porta dinâmica do Render
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});
