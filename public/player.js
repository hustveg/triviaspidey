// public/player.js
// Logica del cliente JUGADOR: unirse via QR o codigo manual, responder
// preguntas con botones grandes, y ver su resultado/ranking final.
//
// Reconexion basica: guardamos playerId y name en localStorage. Si el
// jugador recarga la pagina, usamos ese playerId para que el servidor
// lo reconozca y le devuelva su puntaje acumulado.

const socket = io();

const screens = {
  join: document.getElementById('screen-join'),
  waiting: document.getElementById('screen-waiting'),
  question: document.getElementById('screen-question'),
  locked: document.getElementById('screen-locked'),
  result: document.getElementById('screen-result'),
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

// Usamos sessionStorage (no localStorage) a proposito: sessionStorage es
// independiente por PESTAÑA/ventana, mientras que localStorage se comparte
// entre todas las pestañas del mismo navegador. Esto permite:
//  - Simular varios jugadores distintos abriendo varias pestañas/ventanas
//    del mismo navegador (util para probar en local sin celulares).
//  - Igual soportar la reconexion si recargas ESA MISMA pestaña.
let currentRoomCode = null;
let myPlayerId = sessionStorage.getItem('spiderTrivia_playerId') || null;
let myName = sessionStorage.getItem('spiderTrivia_name') || '';
let hasAnsweredCurrent = false;
let countdownInterval = null;

// ---- Precargar codigo de sala si viene en la URL (?code=XXXXXX) ----
const params = new URLSearchParams(window.location.search);
const codeFromUrl = params.get('code');
if (codeFromUrl) {
  document.getElementById('inputCode').value = codeFromUrl.toUpperCase();
}
if (myName) {
  document.getElementById('inputName').value = myName;
}

// ---- Unirse a la sala ----
document.getElementById('btnJoin').addEventListener('click', joinRoom);
document.getElementById('inputName').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoom();
});

function joinRoom() {
  const code = document.getElementById('inputCode').value.trim().toUpperCase();
  const name = document.getElementById('inputName').value.trim();

  if (!code || code.length < 4) {
    showError('Ingresa un codigo de sala valido.');
    return;
  }
  if (!name) {
    showError('Escribe tu nombre o nickname.');
    return;
  }

  socket.emit('joinRoom', { code, name, playerId: myPlayerId });
}

socket.on('joinedRoom', ({ code, name, playerId, state }) => {
  currentRoomCode = code;
  myName = name;
  myPlayerId = playerId;
  sessionStorage.setItem('spiderTrivia_playerId', playerId);
  sessionStorage.setItem('spiderTrivia_name', name);

  document.getElementById('waitingName').textContent = name;

  if (state === 'lobby') {
    showScreen('waiting');
  }
  // Si state === 'question', el evento 'showQuestion' que llega justo
  // despues se encarga de mostrar la pantalla correcta (reconexion).
});

socket.on('roomFull', ({ message }) => showError(message));
socket.on('errorMessage', ({ message }) => showError(message));

// ---- Pregunta ----
socket.on('showQuestion', ({ question }) => {
  hasAnsweredCurrent = false;
  showScreen('question');

  document.getElementById('questionText').textContent = question.question;

  const grid = document.getElementById('optionsGrid');
  grid.innerHTML = '';
  question.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = `option-btn option-${i}`;
    btn.textContent = opt;
    btn.addEventListener('click', () => selectAnswer(i, btn));
    grid.appendChild(btn);
  });

  startCountdown(question.timeLimit);
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

function selectAnswer(index, btnEl) {
  if (hasAnsweredCurrent) return; // ya respondio, no puede cambiar
  hasAnsweredCurrent = true;

  // Bloquea visualmente todos los botones
  document.querySelectorAll('#optionsGrid .option-btn').forEach((b) => (b.disabled = true));
  btnEl.classList.add('selected');

  socket.emit('submitAnswer', {
    code: currentRoomCode,
    answerIndex: index,
    playerId: myPlayerId
  });
}

socket.on('answerLocked', () => {
  clearInterval(countdownInterval);
  showScreen('locked');
});

// ---- Resultado individual al revelar ----
socket.on('revealAnswer', ({ results, correctAnswerText }) => {
  const me = results.find((r) => r.name === myName);
  if (!me) return;

  showScreen('result');
  const title = document.getElementById('resultTitle');
  const scoreText = document.getElementById('resultScore');
  const correctAnswerEl = document.getElementById('resultCorrectAnswer');

  if (me.correct) {
    title.textContent = '✅ ¡Correcto!';
    title.style.color = '#19c37d';
    correctAnswerEl.classList.add('hidden');
  } else {
    title.textContent = '❌ Incorrecto';
    title.style.color = '#d61f26';
    correctAnswerEl.textContent = `La respuesta correcta era: ${correctAnswerText}`;
    correctAnswerEl.classList.remove('hidden');
  }
  scoreText.textContent = `Tu puntaje total: ${me.score} pts`;
});

// ---- Leaderboard parcial ----
socket.on('showLeaderboard', ({ leaderboard }) => {
  showScreen('leaderboard');
  const list = document.getElementById('leaderboardList');
  list.innerHTML = '';
  leaderboard.forEach((p) => {
    const li = document.createElement('li');
    li.className = `leaderboard-row pos-${p.position}`;
    const highlight = p.name === myName ? ' style="outline:2px solid var(--amarillo-bonus);"' : '';
    li.setAttribute('style', highlight ? 'outline:2px solid #ffcc33;' : '');
    li.innerHTML = `<span>#${p.position} ${p.name}</span><span>${p.score} pts</span>`;
    list.appendChild(li);
  });
});

// ---- Final ----
socket.on('endGame', ({ leaderboard }) => {
  showScreen('final');
  const me = leaderboard.find((p) => p.name === myName);
  if (me) {
    document.getElementById('finalPosition').textContent = `Quedaste en el puesto #${me.position} 🕸️`;
    document.getElementById('finalScore').textContent = `Puntaje final: ${me.score} pts`;
  }
});
