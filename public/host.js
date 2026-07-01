// public/host.js
// Logica del cliente HOST: crea la sala, muestra QR, lista de jugadores,
// controla el avance de preguntas y muestra el ranking.

const socket = io();

let currentRoomCode = null;
let countdownInterval = null;

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

// ---- Pantalla 1: crear sala ----
document.getElementById('btnCreateRoom').addEventListener('click', () => {
  socket.emit('createRoom');
});

socket.on('roomCreated', ({ code }) => {
  currentRoomCode = code;
  document.getElementById('roomCode').textContent = code;
  showScreen('lobby');

  // Pedimos el QR usando la URL base actual (sirve tanto en localhost como en red local)
  const baseUrl = window.location.origin;
  socket.emit('getRoomQR', { code, baseUrl });
});

socket.on('roomQR', ({ qrDataUrl, joinUrl }) => {
  document.getElementById('qrImage').src = qrDataUrl;
  document.getElementById('joinUrlText').textContent = joinUrl;
});

// ---- Lista de jugadores en tiempo real ----
socket.on('playerJoined', ({ players, count, max }) => {
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
});

socket.on('roomFull', ({ message }) => showError(message));
socket.on('errorMessage', ({ message }) => showError(message));

// ---- Iniciar partida ----
document.getElementById('btnStartGame').addEventListener('click', () => {
  socket.emit('startGame', { code: currentRoomCode });
});

// ---- Pantalla de pregunta ----
let questionTimeLimit = 20;

socket.on('showQuestion', ({ question, index, total }) => {
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

  document.getElementById('answeredCount').textContent = '0';
  document.getElementById('totalPlayers').textContent = document.getElementById('playerCount').textContent;

  startCountdown(questionTimeLimit);
});

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
  showScreen('leaderboard');
  const list = document.getElementById('leaderboardList');
  list.innerHTML = '';
  leaderboard.forEach((p) => {
    const li = document.createElement('li');
    li.className = `leaderboard-row pos-${p.position}`;
    li.innerHTML = `<span>#${p.position} ${p.name}</span><span>${p.score} pts</span>`;
    list.appendChild(li);
  });

  // Si era la ultima pregunta, cambiamos el texto del boton
  const btnNext = document.getElementById('btnNextQuestion');
  btnNext.textContent = isFinal ? 'Ver ranking final' : 'Siguiente pregunta';
});

document.getElementById('btnNextQuestion').addEventListener('click', () => {
  socket.emit('nextQuestion', { code: currentRoomCode });
});

// ---- Ranking final ----
socket.on('endGame', ({ leaderboard }) => {
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
});

document.getElementById('btnNewGame').addEventListener('click', () => {
  window.location.reload();
});
