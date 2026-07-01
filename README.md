# Spider Trivia 🕸️

Trivia web en vivo estilo Kahoot, con tematica Spider-Man (sin logos ni
imagenes oficiales). Un host la proyecta y hasta 30 jugadores entran
desde su celular escaneando un QR.

## Estructura del proyecto

```
spiderman-trivia/
├── package.json
├── server.js              <- servidor Express + Socket.io (logica de salas)
├── data/
│   └── questions.js        <- banco de preguntas (NO esta en /public a proposito,
│                               asi el cliente nunca puede ver las respuestas correctas)
└── public/
    ├── index.html           <- pantalla del HOST / proyector
    ├── join.html             <- pantalla del JUGADOR (celular)
    ├── styles.css            <- estilos compartidos, tematica Spider-Man
    ├── host.js                <- logica del host
    ├── player.js              <- logica del jugador
    └── assets/images/         <- aqui van tus imagenes (ver mas abajo)
```

## Instalación y ejecución

1. Instala [Node.js](https://nodejs.org) (version 18 o superior recomendada).
2. Dentro de la carpeta del proyecto, instala las dependencias:
   ```
   npm install
   ```
3. Inicia el servidor:
   ```
   npm start
   ```
4. Abre en el navegador: `http://localhost:3000` → esa es la pantalla
   del **host** (para proyectar).
5. Para que los jugadores se conecten desde sus celulares:
   - Deben estar en la **misma red WiFi** que la computadora que corre el servidor.
   - Averigua la IP local de tu computadora (en Windows: `ipconfig`, en
     Mac/Linux: `ifconfig` o `ip a`). Busca algo como `192.168.1.X`.
   - El QR generado por el host ya usa automáticamente la URL desde la
     que se abrió la pagina, así que si abres el host como
     `http://192.168.1.X:3000` (en lugar de `localhost`), el QR funcionará
     directo desde los celulares.
   - Alternativamente, los jugadores pueden ir manualmente a
     `http://192.168.1.X:3000/join.html` y escribir el código de sala.

## Cómo agregar tus propias imágenes

1. Copia tus imágenes (sin copyright) dentro de `public/assets/images/`.
2. Abre `data/questions.js` y en la pregunta que quieras, cambia:
   ```js
   image: null,
   ```
   por:
   ```js
   image: "assets/images/mi-imagen.jpg",
   ```
3. Si `image` es `null`, el sistema muestra automáticamente un
   placeholder con textura de telaraña — no rompe nada si no agregas imagen.

## Cómo agregar o editar preguntas

Edita `data/questions.js`. Cada pregunta sigue esta estructura:

```js
{
  id: 11,
  question: "¿Tu pregunta aquí?",
  image: "assets/images/opcional.jpg", // o null
  options: ["Opción A", "Opción B", "Opción C", "Opción D"],
  correctIndex: 0,       // indice (0 a 3) de la opción correcta
  timeLimit: 20          // segundos para responder
}
```

## Mecánica de puntaje

- Respuesta correcta: entre **500 y 1000 puntos**, según qué tan rápido respondas
  (más rápido = más puntos, dentro del tiempo límite de la pregunta).
- Respuesta incorrecta: **0 puntos**.
- Si todos los jugadores responden antes de que se acabe el tiempo, la
  respuesta se revela automáticamente sin esperar el cronómetro completo.

## Notas técnicas (MVP)

- El estado de las salas vive en memoria del servidor (no hay base de
  datos). Si reinicias el servidor, las salas activas se pierden.
- Reconexión: si un jugador recarga la página por accidente, el navegador
  recuerda su `playerId` (vía `localStorage`) y recupera su nombre y puntaje.
- Si el host se desconecta, la sala queda viva pero sin control de avance
  (no se reasigna host automáticamente en esta versión).
- Límite de 30 jugadores por sala, validado en el servidor.
- Nombres duplicados en la misma sala se renombran automáticamente
  (ej: "Juan", "Juan (2)").
