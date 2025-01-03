const express = require('express');
const app = express();
const port = process.env.PORT || 80;

// Хранение данных для реле и датчиков
let sensorData = {
  relayState1: false,
  relayState2: false,
  temperature: 0,
  humidity: 0,
  soilMoisture: 0 // Влажность почвы
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
          .data { font-size: 18px; margin-top: 20px; }
        </style>
        <script>
          function toggleRelay1() {
            fetch('/toggleRelay1', { method: 'POST' })
              .then(response => response.json())
              .then(data => {
                document.getElementById('relayState1').textContent = data.relayState1 ? 'Включено' : 'Выключено';
              })
              .catch(error => console.error('Error toggling relay 1:', error));
          }

          function toggleRelay2() {
            fetch('/toggleRelay2', { method: 'POST' })
              .then(response => response.json())
              .then(data => {
                document.getElementById('relayState2').textContent = data.relayState2 ? 'Включено' : 'Выключено';
              })
              .catch(error => console.error('Error toggling relay 2:', error));
          }

          function updateRelayState() {
            fetch('/getRelayState')
              .then(response => response.json())
              .then(data => {
                document.getElementById('relayState1').textContent = data.relayState1 ? 'Включено' : 'Выключено';
                document.getElementById('relayState2').textContent = data.relayState2 ? 'Включено' : 'Выключено';
              });
          }

          function updateSensorData() {
            fetch('/getSensorData')
              .then(response => response.json())
              .then(data => {
                document.getElementById('temperature').textContent = 'Температура: ' + data.temperature + '°C';
                document.getElementById('humidity').textContent = 'Влажность: ' + data.humidity + '%';
              });
          }

          setInterval(updateRelayState, 1000);
          setInterval(updateSensorData, 1000);
        </script>
      </head>
      <body>
        <div class="container">
          <h1>Управление реле и датчиками</h1>
          <p>Состояние реле 1 (Пин 5): <span id="relayState1">—</span></p>
          <button class="button" onclick="toggleRelay1()">Переключить реле 1</button>
          <p>Состояние реле 2 (Пин 18): <span id="relayState2">—</span></p>
          <button class="button" onclick="toggleRelay2()">Переключить реле 2</button>
          <div class="data">
            <p id="temperature">Температура: —</p>
            <p id="humidity">Влажность: —</p>
          </div>
        </div>
      </body>
    </html>
  `);
});

// Эндпоинт для получения состояния реле
app.get('/getRelayState', (req, res) => {
  res.json({ relayState1: sensorData.relayState1, relayState2: sensorData.relayState2 });
});

// Эндпоинт для получения данных с датчиков (температуры и влажности)
app.get('/getSensorData', (req, res) => {
  res.json({
    temperature: sensorData.temperature,
    humidity: sensorData.humidity
  });
});

// Эндпоинт для обновления данных с датчиков
app.post('/updateSensorData', (req, res) => {
  const { temperature, humidity } = req.body;
  if (temperature != null && humidity != null) {
    sensorData.temperature = temperature;
    sensorData.humidity = humidity;
    console.log(`Received sensor data: Temperature: ${temperature}°C, Humidity: ${humidity}%`);
    res.json({ message: 'Sensor data updated successfully' });
  } else {
    res.status(400).json({ error: 'Invalid data' });
  }
});

// Эндпоинт для переключения первого реле (Пин 5)
app.post('/toggleRelay1', (req, res) => {
  sensorData.relayState1 = !sensorData.relayState1;
  console.log(`Relay 1 toggled to ${sensorData.relayState1 ? 'ON' : 'OFF'}`);
  res.json({ relayState1: sensorData.relayState1 });
});

// Эндпоинт для переключения второго реле (Пин 18)
app.post('/toggleRelay2', (req, res) => {
  sensorData.relayState2 = !sensorData.relayState2;
  console.log(`Relay 2 toggled to ${sensorData.relayState2 ? 'ON' : 'OFF'}`);
  res.json({ relayState2: sensorData.relayState2 });
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
