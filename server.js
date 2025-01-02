const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const port = process.env.PORT || 80; // Использование порта, предоставленного окружением

// Переменная для хранения последних данных
let sensorData = {
    temperature: null,
    humidity: null,
    soil_moisture: null,
    relayState: false,
    fanState: false,
};

// Для обработки JSON данных
const app = express();
app.use(express.json());

// Создание HTTP сервера и WebSocket сервера
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Храним последний подключённый WebSocket
let espSocket = null;

// Обработка WebSocket соединений
wss.on('connection', (ws) => {
    console.log('WebSocket connected');
    espSocket = ws;

    ws.on('close', () => {
        console.log('WebSocket disconnected');
        espSocket = null;
    });

    ws.on('message', (message) => {
        console.log('Received:', message);
    });
});

// Главная страница с HTML
app.get('/', (req, res) => {
    res.send(`
    <html>
      <head>
        <title>Управление системой</title>
        <style>
          body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
          .container { max-width: 800px; margin: 50px auto; padding: 20px; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }
          h1 { text-align: center; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { padding: 10px; border: 1px solid #ddd; text-align: center; }
          th { background-color: #f2f2f2; }
          .button { padding: 10px 20px; background-color: #4CAF50; color: white; border: none; cursor: pointer; }
          .button:hover { background-color: #45a049; }
          .blue-button { background-color: #2196F3; }
          .blue-button:hover { background-color: #1e88e5; }
        </style>
        <script>
          function updateSensorData() {
            fetch('/sensorData')
              .then(response => response.json())
              .then(data => {
                document.getElementById('temperature').textContent = data.temperature !== null ? data.temperature : '—';
                document.getElementById('humidity').textContent = data.humidity !== null ? data.humidity : '—';
                document.getElementById('soilMoisture').textContent = data.soil_moisture !== null ? data.soil_moisture : '—';
                document.getElementById('relayState').textContent = data.relayState ? 'Включено' : 'Выключено';
                document.getElementById('fanState').textContent = data.fanState ? 'Включено' : 'Выключено';
              })
              .catch(error => console.error('Error fetching sensor data:', error));
          }

          function toggleRelay() {
            fetch('/toggleRelay', { method: 'POST' })
              .then(response => response.json())
              .then(data => {
                updateSensorData();
              })
              .catch(error => console.error('Error toggling relay:', error));
          }

          function toggleFan() {
            fetch('/toggleFan', { method: 'POST' })
              .then(response => response.json())
              .then(data => {
                updateSensorData();
              })
              .catch(error => console.error('Error toggling fan:', error));
          }

          setInterval(updateSensorData, 1000);
          window.onload = updateSensorData;
        </script>
      </head>
      <body>
        <div class="container">
          <h1>Управление системой</h1>
          <table>
            <tr>
              <th>Температура (°C)</th>
              <th>Влажность (%)</th>
              <th>Влажность почвы (%)</th>
              <th>Состояние реле</th>
              <th>Состояние кулера</th>
            </tr>
            <tr>
              <td id="temperature">—</td>
              <td id="humidity">—</td>
              <td id="soilMoisture">—</td>
              <td id="relayState">—</td>
              <td id="fanState">—</td>
            </tr>
          </table>
          <div style="text-align: center; margin-top: 20px;">
            <button onclick="toggleRelay()" class="button">Переключить реле</button>
            <button onclick="toggleFan()" class="blue-button">Переключить кулер</button>
          </div>
        </div>
      </body>
    </html>
  `);
});

// Эндпоинт для получения последних данных с датчиков
app.get('/sensorData', (req, res) => {
    res.json(sensorData);
});

// Эндпоинт для переключения реле
app.post('/toggleRelay', (req, res) => {
    sensorData.relayState = !sensorData.relayState;
    if (espSocket) {
        espSocket.send(JSON.stringify({ action: 'toggleRelay', relayState: sensorData.relayState }));
    }
    console.log(`Relay toggled to ${sensorData.relayState ? 'ON' : 'OFF'}`);
    res.json({ relayState: sensorData.relayState });
});

// Эндпоинт для переключения кулера
app.post('/toggleFan', (req, res) => {
    sensorData.fanState = !sensorData.fanState;
    if (espSocket) {
        espSocket.send(JSON.stringify({ action: 'toggleFan', fanState: sensorData.fanState }));
    }
    console.log(`Fan toggled to ${sensorData.fanState ? 'ON' : 'OFF'}`);
    res.json({ fanState: sensorData.fanState });
});

// Запуск сервера
server.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
