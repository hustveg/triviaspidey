// server.js
// Servidor principal: sirve los archivos estaticos del host/jugador
// y maneja toda la logica de la trivia en tiempo real con Socket.io.
//
// El estado de cada sala vive SOLO en memoria (en el objeto `rooms`).
// Esto es suficiente para un MVP; si se reinicia el servidor se pierden
// las salas activas (no hay base de datos en esta version).

const express = require('express');
const http = require('http');
const path = require('path');
const QRCode = require('qrcode');
const { Server } = require('socket.io');

const questions = require('./data/questions');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_PLAYERS = 30;
const MAX_POINTS = 1000;
const MIN_POINTS_IF_CORRECT = 500;

// Servimos todo lo que esta en /public como archivos estaticos
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------------------------
// Estado en memoria
// ----------------------------------------------------------------------
// rooms = {
//   "AB12CD": {
//     code, hostSocketId,
//     players: [{ playerId, socketId, name, score, hasAnswered, lastAnswerCorrect }],
//     state: 'lobby' | 'question' | 'reveal' | 'leaderboard' | 'ended',
//     currentQuestionIndex: -1,
//     currentShuffledOptions: [],  // opciones ya mezcladas de la pregunta actual
//     currentCorrectIndex: null,   // indice correcto YA mezclado para esta partida
//     questionStartTime: null,
//     questionTimer: null
//   }
// }
const rooms = {};

// Genera un codigo corto de 6 caracteres (sin 0/O/1/I para evitar confusiones)
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms[code]); // evitar colisiones
  return code;
}

// Mezcla las opciones de una pregunta usando el algoritmo Fisher-Yates,
// y devuelve tanto las opciones ya mezcladas como el nuevo indice de la
// respuesta correcta (que ya NO sera siempre 0). Esto se calcula cada vez
// que se muestra la pregunta, asi que ademas queda distinto cada partida.
function shuffleOptions(question) {
  const indices = question.options.map((_, i) => i); // [0,1,2,3]

  // Fisher-Yates shuffle
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }

  const shuffledOptions = indices.map((originalIndex) => question.options[originalIndex]);
  const newCorrectIndex = indices.indexOf(question.correctIndex);

  return { shuffledOptions, newCorrectIndex };
}

// Devuelve la pregunta actual SIN el campo correctIndex (para mandar al cliente),
// con las opciones ya mezcladas segun lo guardado en la sala.
function getSafeQuestion(room) {
  const q = questions[room.currentQuestionIndex];
  if (!q) return null;
  const { correctIndex, options, ...rest } = q;
  return { ...rest, options: room.currentShuffledOptions };
}

// Calcula el puntaje segun el tiempo que tardo en responder
function calculatePoints(timeLimitSeconds, msElapsed) {
  const fraction = Math.max(0, 1 - msElapsed / (timeLimitSeconds * 1000));
  const bonus = (MAX_POINTS - MIN_POINTS_IF_CORRECT) * fraction;
  return Math.round(MIN_POINTS_IF_CORRECT + bonus);
}

// Construye el ranking ordenado por puntaje descendente
function buildLeaderboard(room) {
  return [...room.players]
    .sort((a, b) => b.score - a.score)
    .map((p, index) => ({
      position: index + 1,
      name: p.name,
      score: p.score
    }));
}

// Limpia el timer de una sala si existe
function clearRoomTimer(room) {
  if (room.questionTimer) {
    clearTimeout(room.questionTimer);
    room.questionTimer = null;
  }
}

// Revela la respuesta correcta y manda resultados a todos en la sala
function revealAnswer(room) {
  clearRoomTimer(room);
  room.state = 'reveal';

  const results = room.players.map((p) => ({
    name: p.name,
    correct: !!p.lastAnswerCorrect,
    score: p.score
  }));

  io.to(room.code).emit('revealAnswer', {
    correctIndex: room.currentCorrectIndex, // indice ya mezclado de esta partida
    correctAnswerText: room.currentShuffledOptions[room.currentCorrectIndex],
    results
  });

  // Pausa de 5 segundos antes de mandar el leaderboard, para darle tiempo
  // al jugador/host de leer cual era la respuesta correcta antes de avanzar.
  setTimeout(() => {
    room.state = 'leaderboard';
    io.to(room.code).emit('showLeaderboard', {
      leaderboard: buildLeaderboard(room),
      isFinal: room.currentQuestionIndex === questions.length - 1
    });
  }, 5000);
}

// Avanza a la siguiente pregunta de la sala (o termina el juego)
function advanceQuestion(room) {
  room.currentQuestionIndex++;

  if (room.currentQuestionIndex >= questions.length) {
    room.state = 'ended';
    io.to(room.code).emit('endGame', {
      leaderboard: buildLeaderboard(room)
    });
    return;
  }

  room.state = 'question';
  room.questionStartTime = Date.now();
  room.players.forEach((p) => {
    p.hasAnswered = false;
    p.lastAnswerCorrect = false;
  });

  // Mezclamos las opciones de ESTA pregunta para ESTA partida, y guardamos
  // el resultado en la sala para poder validar respuestas y revelar despues.
  const currentQuestionData = questions[room.currentQuestionIndex];
  const { shuffledOptions, newCorrectIndex } = shuffleOptions(currentQuestionData);
  room.currentShuffledOptions = shuffledOptions;
  room.currentCorrectIndex = newCorrectIndex;

  const safeQuestion = getSafeQuestion(room);
  io.to(room.code).emit('showQuestion', {
    question: safeQuestion,
    index: room.currentQuestionIndex,
    total: questions.length
  });

  // Timer de servidor: si se acaba el tiempo, revela automaticamente
  clearRoomTimer(room);
  room.questionTimer = setTimeout(() => {
    revealAnswer(room);
  }, safeQuestion.timeLimit * 1000 + 300); // pequeño margen de red
}

// ----------------------------------------------------------------------
// Socket.io
// ----------------------------------------------------------------------
io.on('connection', (socket) => {
  // --- HOST: crear sala ---
  socket.on('createRoom', () => {
    const code = generateRoomCode();
    rooms[code] = {
      code,
      hostSocketId: socket.id,
      players: [],
      state: 'lobby',
      currentQuestionIndex: -1,
      currentShuffledOptions: [],
      currentCorrectIndex: null,
      questionStartTime: null,
      questionTimer: null
    };
    socket.join(code);
    socket.emit('roomCreated', { code });
  });

  // --- HOST: pide el QR de una sala que ya creo ---
  socket.on('getRoomQR', async ({ code, baseUrl }) => {
    try {
      const joinUrl = `${baseUrl}/join.html?code=${code}`;
      const qrDataUrl = await QRCode.toDataURL(joinUrl, {
        color: { dark: '#0b0c1a', light: '#ffffff' },
        width: 280
      });
      socket.emit('roomQR', { qrDataUrl, joinUrl });
    } catch (err) {
      socket.emit('errorMessage', { message: 'No se pudo generar el QR.' });
    }
  });

  // --- JUGADOR: unirse a una sala ---
  socket.on('joinRoom', ({ code, name, playerId }) => {
    code = (code || '').toUpperCase().trim();
    const room = rooms[code];

    if (!room) {
      socket.emit('errorMessage', { message: 'Esa sala no existe. Revisa el codigo.' });
      return;
    }

    // Si el jugador ya estaba en la sala (reconexion por recarga), lo recuperamos
    const existing = room.players.find((p) => p.playerId === playerId);
    if (existing) {
      existing.socketId = socket.id;
      socket.join(code);
      socket.emit('joinedRoom', {
        code,
        name: existing.name,
        playerId: existing.playerId,
        state: room.state
      });
      // Si ya esta en pleno juego, lo pone al dia con la pregunta actual
      if (room.state === 'question') {
        socket.emit('showQuestion', {
          question: getSafeQuestion(room),
          index: room.currentQuestionIndex,
          total: questions.length
        });
      }
      return;
    }

    if (room.state !== 'lobby') {
      socket.emit('errorMessage', { message: 'La partida ya empezo. No puedes unirte ahora.' });
      return;
    }

    if (room.players.length >= MAX_PLAYERS) {
      socket.emit('roomFull', { message: 'La sala ya alcanzo el limite de 30 jugadores.' });
      return;
    }

    // Evitar nombres duplicados: si ya existe, agrega un numero
    let finalName = (name || 'Jugador').trim().slice(0, 18) || 'Jugador';
    let suffix = 2;
    const usedNames = new Set(room.players.map((p) => p.name));
    while (usedNames.has(finalName)) {
      finalName = `${name.trim().slice(0, 18)} (${suffix})`;
      suffix++;
    }

    const newPlayerId = playerId || `${socket.id}-${Date.now()}`;
    const player = {
      playerId: newPlayerId,
      socketId: socket.id,
      name: finalName,
      score: 0,
      hasAnswered: false,
      lastAnswerCorrect: false
    };
    room.players.push(player);
    socket.join(code);

    socket.emit('joinedRoom', { code, name: finalName, playerId: newPlayerId, state: room.state });

    // Avisa al host (y a todos) la lista actualizada de jugadores
    io.to(room.hostSocketId).emit('playerJoined', {
      players: room.players.map((p) => ({ name: p.name, score: p.score })),
      count: room.players.length,
      max: MAX_PLAYERS
    });
  });

  // --- HOST: iniciar la partida ---
  socket.on('startGame', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    if (room.players.length === 0) {
      socket.emit('errorMessage', { message: 'Necesitas al menos 1 jugador para iniciar.' });
      return;
    }
    advanceQuestion(room);
  });

  // --- JUGADOR: enviar respuesta ---
  socket.on('submitAnswer', ({ code, answerIndex, playerId }) => {
    const room = rooms[code];
    if (!room || room.state !== 'question') return;

    const player = room.players.find((p) => p.playerId === playerId);
    if (!player || player.hasAnswered) return;

    const q = questions[room.currentQuestionIndex];
    const msElapsed = Date.now() - room.questionStartTime;
    const isCorrect = answerIndex === room.currentCorrectIndex;

    player.hasAnswered = true;
    player.lastAnswerCorrect = isCorrect;

    if (isCorrect) {
      player.score += calculatePoints(q.timeLimit, msElapsed);
    }

    // Confirmacion al jugador de que su respuesta quedo registrada
    socket.emit('answerLocked');

    // Avisa al host cuantos han respondido (sin revelar si es correcta)
    const answeredCount = room.players.filter((p) => p.hasAnswered).length;
    io.to(room.hostSocketId).emit('answerReceived', {
      answeredCount,
      total: room.players.length
    });

    // Si ya respondieron todos, revela antes de que termine el tiempo
    if (answeredCount === room.players.length) {
      revealAnswer(room);
    }
  });

  // --- HOST: siguiente pregunta ---
  socket.on('nextQuestion', ({ code }) => {
    const room = rooms[code];
    if (!room || room.hostSocketId !== socket.id) return;
    advanceQuestion(room);
  });

  // --- Desconexion ---
  socket.on('disconnect', () => {
    // No eliminamos al jugador inmediatamente: puede ser solo una recarga
    // de pagina. Se mantiene su score guardado por playerId hasta que
    // alguien mas tome ese socket.id explicitamente.
    for (const code in rooms) {
      const room = rooms[code];
      if (room.hostSocketId === socket.id) {
        // El host se desconecto: por simplicidad, dejamos la sala viva
        // (el MVP no reasigna host). Se podria cerrar la sala aqui si se prefiere.
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Spiderman Trivia corriendo en http://localhost:${PORT}`);
});
