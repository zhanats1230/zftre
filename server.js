const express = require('express');
const app = express();
const http = require('http');
const port = process.env.PORT || 80;

// Переменная для хранения данных о датчиках и устройствах
let sensorData = {
    temperature: null,
    humidity: null,
    soil_moisture: null,
    relayState: false, // Состояние реле
    fanState: false    // Состояние кулера
};

// Для обработки JSON данных
app.use(express.json());

// Главная страница с интерфейсом
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Управление теплицей</title>
        <style>
          body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
          .container { max-width: 800px; margin: 50px auto; padding: 20px; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }
          h1 { text-align: center; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { padding: 10px; border: 1px solid #ddd; text-align: center; }
          th { background-color: #f2f2f2; }
          .button { padding: 10px 20px; background-color: #4CAF50; color: white; border: none; cursor: pointer; }
          .button:hover { background-color: #45a049; }
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
              .then(data => updateSensorData())
              .catch(error => console.error('Error toggling relay:', error));
          }

          function toggleFan() {
            fetch('/toggleFan', { method: 'POST' })
              .then(response => response.json())
              .then(data => updateSensorData())
              .catch(error => console.error('Error toggling fan:', error));
          }

          setInterval(updateSensorData, 1000);
          window.onload = updateSensorData;
        </script>
      </head>
      <body>
        <div class="container">
          <h1>Управление теплицей</h1>
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
            <button onclick="toggleFan()" class="button" style="background-color: #2196F3;">Переключить кулер</button>
          </div>
        </div>
      </body>
    </html>
  `);
});

// Обработчик для получения данных с датчиков
app.get('/sensorData', (req, res) => {
  res.json(sensorData);
});

// Обработчик для получения состояния реле (ESP32 будет использовать этот эндпоинт)
app.get('/getRelayState', (req, res) => {
  res.json({
    relayState: sensorData.relayState,
    fanState: sensorData.fanState
  });
});

// Обработчик для переключения реле
app.post('/toggleRelay', (req, res) => {
  sensorData.relayState = !sensorData.relayState;
  console.log(`Relay toggled to ${sensorData.relayState ? 'ON' : 'OFF'}`);
  res.json({ relayState: sensorData.relayState });
});

// Обработчик для переключения кулера
app.post('/toggleFan', (req, res) => {
  sensorData.fanState = !sensorData.fanState;
  console.log(`Fan toggled to ${sensorData.fanState ? 'ON' : 'OFF'}`);
  res.json({ fanState: sensorData.fanState });
});

// Обработчик для получения данных от ESP32
app.post('/data', (req, res) => {
  console.log('Получены данные от ESP32:', req.body);
  sensorData = { ...sensorData, ...req.body };
  res.status(200).send('Data received');
});

// Запуск сервера
server.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
