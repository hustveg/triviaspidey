// public/host.js
// Logica del cliente HOST: crea la sala, muestra QR, lista de jugadores,
// controla el avance de preguntas y muestra el ranking.
//
// Reconexion automatica: guardamos el codigo de sala + un token secreto
// en sessionStorage (dura mientras la pestaña este abierta). Si el host
// recarga la pagina por accidente, al cargar detectamos ese token y le
// pedimos al servidor reconectarnos, restaurando la pantalla exacta en
// la que estaba (lobby, pregunta, leaderboard o ranking final) sin crear
// una sala nueva ni perder a los jugadores ya conectados.

const socket = io();

let currentRoomCode = null;
let countdownInterval = null;
let questionTimeLimit = 20;

// ---- Referencias a elementos ----
const screens = {
  create: document.getElementById('screen-create'),
  lobby: document.getElementById('screen-lobby'),
  question: document.getElementById('screen-question'),
  leaderboard: document.getElementById('screen-leaderboard'),
  final: document.getElementById('screen-final')
};
const errorBanner = document.getElementById('errorBanner');

function showScreen(name) {
  Object.values(screens).forEach((el) => el.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

function showError(message) {
  errorBanner.textContent = message;
  errorBanner.classList.remove('hidden');
  setTimeout(() => errorBanner.classList.add('hidden'), 4000);
}

// ---------------------------------------------------------------------
// Funciones de renderizado reutilizables (las usan tanto los eventos
// normales de juego como la reconexion del host).
// ---------------------------------------------------------------------

function renderPlayerList(players, count, max) {
  document.getElementById('playerCount').textContent = count;
  const list = document.getElementById('playerList');
  list.innerHTML = '';
  players.forEach((p) => {
    const li = document.createElement('li');
    li.className = 'player-chip';
    li.textContent = `🕷️ ${p.name}`;
    list.appendChild(li);
  });
  document.getElementById('btnStartGame').disabled = count === 0;
}

function renderQuestionScreen(question, index, total, answeredCountValue) {
  showScreen('question');
  questionTimeLimit = question.timeLimit;

  document.getElementById('questionCounter').textContent = `Pregunta ${index + 1} / ${total}`;
  document.getElementById('questionText').textContent = question.question;

  const img = document.getElementById('questionImage');
  const placeholder = document.getElementById('imagePlaceholder');
  if (question.image) {
    img.src = question.image;
    img.classList.remove('hidden');
    placeholder.classList.add('hidden');
  } else {
    img.classList.add('hidden');
    placeholder.classList.remove('hidden');
  }

  const grid = document.getElementById('optionsGrid');
  grid.innerHTML = '';
  question.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = `option-btn option-${i}`;
    btn.textContent = opt;
    btn.disabled = true; // el host no responde, solo muestra
    btn.dataset.index = i;
    grid.appendChild(btn);
  });

  document.getElementById('answeredCount').textContent = answeredCountValue || '0';
  document.getElementById('totalPlayers').textContent = document.getElementById('playerCount').textContent;

  startCountdown(questionTimeLimit);
}

function startCountdown(seconds) {
  clearInterval(countdownInterval);
  let remaining = seconds;
  const circle = document.getElementById('timerCircle');
  circle.textContent = remaining;
  countdownInterval = setInterval(() => {
    remaining--;
    circle.textContent = Math.max(remaining, 0);
    if (remaining <= 0) clearInterval(countdownInterval);
  }, 1000);
}

function renderLeaderboardScreen(leaderboard, isFinal) {
  showScreen('leaderboard');
  const list = document.getElementById('leaderboardList');
  list.innerHTML = '';
  leaderboard.forEach((p) => {
    const li = document.createElement('li');
    li.className = `leaderboard-row pos-${p.position}`;
    li.innerHTML = `<span>#${p.position} ${p.name}</span><span>${p.score} pts</span>`;
    list.appendChild(li);
  });

  const btnNext = document.getElementById('btnNextQuestion');
  btnNext.textContent = isFinal ? 'Ver ranking final' : 'Siguiente pregunta';
}

function renderFinalScreen(leaderboard) {
  showScreen('final');
  const podium = document.getElementById('podium');
  const rest = document.getElementById('finalListRest');
  podium.innerHTML = '';
  rest.innerHTML = '';

  const top3 = leaderboard.slice(0, 3);
  top3.forEach((p) => {
    const step = document.createElement('div');
    step.className = `podium-step podium-${p.position}`;
    step.innerHTML = `<div class="name">${p.name}</div>${p.score}`;
    podium.appendChild(step);
  });

  leaderboard.slice(3).forEach((p) => {
    const li = document.createElement('li');
    li.className = 'leaderboard-row';
    li.innerHTML = `<span>#${p.position} ${p.name}</span><span>${p.score} pts</span>`;
    rest.appendChild(li);
  });
}

function requestQR(code) {
  const baseUrl = window.location.origin;
  socket.emit('getRoomQR', { code, baseUrl });
}

// ---------------------------------------------------------------------
// Reconexion automatica al cargar la pagina
// ---------------------------------------------------------------------
const savedCode = sessionStorage.getItem('spiderTrivia_host_code');
const savedToken = sessionStorage.getItem('spiderTrivia_host_token');

if (savedCode && savedToken) {
  // Hay una sesion de host guardada: intentamos reconectar en vez de
  // mostrar la pantalla de "Crear sala".
  socket.emit('reconnectHost', { code: savedCode, hostToken: savedToken });
} else {
  showScreen('create');
}

socket.on('hostReconnected', (data) => {
  currentRoomCode = data.code;
  sessionStorage.setItem('spiderTrivia_host_code', data.code);
  sessionStorage.setItem('spiderTrivia_host_token', data.hostToken);

  document.getElementById('roomCode').textContent = data.code;

  if (data.state === 'lobby') {
    showScreen('lobby');
    renderPlayerList(data.players, data.count, data.max);
    requestQR(data.code);
  } else if (data.state === 'question') {
    renderPlayerList(data.players, data.count, data.max); // por si vuelve al lobby visualmente
    renderQuestionScreen(data.question, data.questionIndex, data.total, data.answeredCount);
  } else if (data.state === 'reveal' || data.state === 'leaderboard') {
    renderLeaderboardScreen(data.leaderboard, data.isFinal);
  } else if (data.state === 'ended') {
    renderFinalScreen(data.leaderboard);
  } else {
    showScreen('lobby');
    renderPlayerList(data.players, data.count, data.max);
    requestQR(data.code);
  }
});

socket.on('hostReconnectFailed', () => {
  // La sala ya no existe (por ejemplo, se reinicio el servidor). Limpiamos
  // la sesion guardada y dejamos que el host cree una sala nueva.
  sessionStorage.removeItem('spiderTrivia_host_code');
  sessionStorage.removeItem('spiderTrivia_host_token');
  showError('La sala anterior ya no existe. Crea una nueva.');
  showScreen('create');
});

// ---- Pantalla 1: crear sala ----
document.getElementById('btnCreateRoom').addEventListener('click', () => {
  socket.emit('createRoom');
});

socket.on('roomCreated', ({ code, hostToken }) => {
  currentRoomCode = code;
  sessionStorage.setItem('spiderTrivia_host_code', code);
  sessionStorage.setItem('spiderTrivia_host_token', hostToken);

  document.getElementById('roomCode').textContent = code;
  showScreen('lobby');
  requestQR(code);
});

socket.on('roomQR', ({ qrDataUrl, joinUrl }) => {
  document.getElementById('qrImage').src = qrDataUrl;
  document.getElementById('joinUrlText').textContent = joinUrl;
});

// ---- Lista de jugadores en tiempo real ----
socket.on('playerJoined', ({ players, count, max }) => {
  renderPlayerList(players, count, max);
});

socket.on('roomFull', ({ message }) => showError(message));
socket.on('errorMessage', ({ message }) => showError(message));

// ---- Iniciar partida ----
document.getElementById('btnStartGame').addEventListener('click', () => {
  socket.emit('startGame', { code: currentRoomCode });
});

// ---- Pantalla de pregunta ----
socket.on('showQuestion', ({ question, index, total }) => {
  renderQuestionScreen(question, index, total, 0);
});

socket.on('answerReceived', ({ answeredCount, total }) => {
  document.getElementById('answeredCount').textContent = answeredCount;
  document.getElementById('totalPlayers').textContent = total;
});

// ---- Revelar respuesta correcta ----
socket.on('revealAnswer', ({ correctIndex }) => {
  clearInterval(countdownInterval);
  const buttons = document.querySelectorAll('#optionsGrid .option-btn');
  buttons.forEach((btn) => {
    const i = parseInt(btn.dataset.index, 10);
    btn.classList.add(i === correctIndex ? 'correct' : 'incorrect');
  });
});

// ---- Leaderboard parcial ----
socket.on('showLeaderboard', ({ leaderboard, isFinal }) => {
  renderLeaderboardScreen(leaderboard, isFinal);
});

document.getElementById('btnNextQuestion').addEventListener('click', () => {
  socket.emit('nextQuestion', { code: currentRoomCode });
});

// ---- Ranking final ----
socket.on('endGame', ({ leaderboard }) => {
  renderFinalScreen(leaderboard);
});

document.getElementById('btnNewGame').addEventListener('click', () => {
  // Limpiamos la sesion guardada para que la recarga cree una sala
  // NUEVA en vez de reconectarse a la partida que ya termino.
  sessionStorage.removeItem('spiderTrivia_host_code');
  sessionStorage.removeItem('spiderTrivia_host_token');
  window.location.reload();
});
