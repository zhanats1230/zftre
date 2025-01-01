const express = require('express');
const app = express();
const http = require('http');
const port = process.env.PORT || 80;

// Хранение данных
let sensorData = {
  relayState: false, // Состояние реле
};

// Для обработки JSON запросов
app.use(express.json());

// Главная страница с интерфейсом
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Управление реле</title>
        <style>
          body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
          .container { max-width: 800px; margin: 50px auto; padding: 20px; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }
          h1 { text-align: center; }
          .button { padding: 10px 20px; background-color: #4CAF50; color: white; border: none; cursor: pointer; font-size: 18px; }
          .button:hover { background-color: #45a049; }
        </style>
        <script>
          function toggleRelay() {
            fetch('/toggleRelay', { method: 'POST' })
              .then(response => response.json())
              .then(data => {
                document.getElementById('relayState').textContent = data.relayState ? 'Включено' : 'Выключено';
              })
              .catch(error => console.error('Error toggling relay:', error));
          }
          
          function updateRelayState() {
            fetch('/getRelayState')
              .then(response => response.json())
              .then(data => {
                document.getElementById('relayState').textContent = data.relayState ? 'Включено' : 'Выключено';
              });
          }

          setInterval(updateRelayState, 1000);
        </script>
      </head>
      <body>
        <div class="container">
          <h1>Управление реле</h1>
          <p>Состояние реле: <span id="relayState">—</span></p>
          <button class="button" onclick="toggleRelay()">Переключить реле</button>
        </div>
      </body>
    </html>
  `);
});

// Эндпоинт для переключения реле
app.post('/toggleRelay', (req, res) => {
  sensorData.relayState = !sensorData.relayState;
  console.log(`Relay toggled to ${sensorData.relayState ? 'ON' : 'OFF'}`);
  res.json({ relayState: sensorData.relayState });
});

// Эндпоинт для получения состояния реле
app.get('/getRelayState', (req, res) => {
  res.json({ relayState: sensorData.relayState });
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
