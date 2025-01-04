const express = require('express');
const app = express();
const port = process.env.PORT || 80;

// Хранение данных для реле и датчиков
let sensorData = {
  relayState1: false,
  relayState2: false,
  temperature: 0,
  humidity: 0,
  soilMoisture: 0, // Влажность почвы
};

// Переменная для режима
let currentMode = 'auto'; // Стартовый режим - автоматический

// Новые переменные для времени работы и паузы освещения
let lightingSettings = {
  onDuration: 30, // Время горения света в секундах
  offDuration: 60, // Время паузы между включениями света в секундах
};

// Таймер для автоматического управления освещением
let lightingTimer = null;

// Для обработки JSON запросов
app.use(express.json());

// Главная страница с интерфейсом
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Управление реле</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
          }
          .container {
            max-width: 800px;
            margin: 50px auto;
            padding: 20px;
            background: #fff;
            border-radius: 8px;
            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
          }
          h1 {
            text-align: center;
          }
          .button {
            padding: 10px 20px;
            background-color: #4CAF50;
            color: white;
            border: none;
            cursor: pointer;
            font-size: 18px;
            margin-top: 10px;
          }
          .button:hover {
            background-color: #45a049;
          }
          .data {
            font-size: 18px;
            margin-top: 20px;
          }
          .disabled {
            background-color: #ccc;
            cursor: not-allowed;
          }
          .relay-button {
            margin-bottom: 10px;
          }
          .input-field {
            margin-top: 10px;
            display: flex;
            flex-direction: column;
          }
        </style>
        <script>
          let currentMode = 'auto'; // Начальный режим

          function toggleRelay(relayNumber) {
            if (currentMode === 'manual') {
              fetch(`/toggleRelay/${relayNumber}`, { method: 'POST' })
                .then((response) => {
                  if (!response.ok) throw new Error('Network response was not ok');
                  return response.json();
                })
                .then((data) => {
                  const relayState = data[`relayState${relayNumber}`];
                  document.getElementById(`relayState${relayNumber}`).textContent =
                    relayState ? 'Выключено' : 'Включено';
                })
                .catch((error) => console.error('Error toggling relay:', error));
            } else {
              alert('Реле можно переключать только в ручном режиме!');
            }
          }

          function toggleMode() {
            fetch('/setMode', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mode: currentMode === 'auto' ? 'manual' : 'auto',
              }),
            })
              .then((response) => response.json())
              .then((data) => {
                currentMode = data.mode;
                document.getElementById('mode').textContent =
                  currentMode === 'auto' ? 'Автоматический' : 'Ручной';
                updateButtonState();
              })
              .catch((error) => console.error('Error toggling mode:', error));
          }

          function updateButtonState() {
            const relayButtons = document.querySelectorAll('.relay-button');
            relayButtons.forEach((button) => {
              if (currentMode === 'auto') {
                button.disabled = true;
                button.classList.add('disabled');
              } else {
                button.disabled = false;
                button.classList.remove('disabled');
              }
            });
          }

          function updateMode() {
            fetch('/getMode')
              .then((response) => response.json())
              .then((data) => {
                currentMode = data.mode;
                document.getElementById('mode').textContent =
                  currentMode === 'auto' ? 'Автоматический' : 'Ручной';
                updateButtonState();
              })
              .catch((error) => console.error('Error fetching mode:', error));
          }

          function updateSensorData() {
            fetch('/getSensorData')
              .then((response) => response.json())
              .then((data) => {
                document.getElementById('temperature').textContent = `Температура: ${data.temperature}°C`;
                document.getElementById('humidity').textContent = `Влажность: ${data.humidity}%`;
                document.getElementById('soilMoisture').textContent = `Влажность почвы: ${data.soilMoisture}%`;
              })
              .catch((error) => console.error('Error fetching sensor data:', error));
          }

          function updateLightingSettings() {
            const onDuration = parseInt(document.getElementById('onDuration').value, 10);
            const offDuration = parseInt(document.getElementById('offDuration').value, 10);
            fetch('/updateLightingSettings', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ onDuration, offDuration }),
            })
              .then((response) => response.json())
              .then((data) => alert(data.message || 'Настройки обновлены'))
              .catch((error) => console.error('Error updating lighting settings:', error));
          }

          function fetchLightingSettings() {
            fetch('/getLightingSettings')
              .then((response) => response.json())
              .then((data) => {
                document.getElementById('onDuration').value = data.onDuration;
                document.getElementById('offDuration').value = data.offDuration;
              })
              .catch((error) => console.error('Error fetching lighting settings:', error));
          }

          setInterval(updateSensorData, 1000); // Обновление данных каждые 1 секунду
          setInterval(updateMode, 1000); // Обновление режима каждые 1 секунду
          window.onload = fetchLightingSettings;
        </script>
      </head>
      <body>
        <div class="container">
          <h1>Управление реле и датчиками</h1>
          <p>Освещение в теплице: <span id="relayState1">—</span></p>
          <button class="button relay-button" onclick="toggleRelay(1)">Переключить</button>
          <p>Вентиляция в теплице: <span id="relayState2">—</span></p>
          <button class="button relay-button" onclick="toggleRelay(2)">Переключить</button>
          <p>Режим работы: <span id="mode">—</span></p>
          <button class="button" onclick="toggleMode()">Переключить режим</button>

          <div class="data">
            <p id="temperature">Температура: —</p>
            <p id="humidity">Влажность: —</p>
            <p id="soilMoisture">Влажность почвы: —</p>
          </div>

          <div class="input-field">
            <label>Время горения света (секунды):</label>
            <input type="number" id="onDuration" min="1" />
          </div>
          <div class="input-field">
            <label>Время паузы (секунды):</label>
            <input type="number" id="offDuration" min="1" />
          </div>
          <button class="button" onclick="updateLightingSettings()">Сохранить настройки</button>
        </div>
      </body>
    </html>
  `);
});

// Эндпоинт для получения состояния реле
app.get('/getRelayState', (req, res) => {
  res.json({
    relayState1: sensorData.relayState1,
    relayState2: sensorData.relayState2,
  });
});

// Эндпоинт для получения данных с датчиков
app.get('/getSensorData', (req, res) => {
  res.json({
    temperature: sensorData.temperature,
    humidity: sensorData.humidity,
    soilMoisture: sensorData.soilMoisture,
  });
});

// Эндпоинт для обновления данных с датчиков
app.post('/updateSensorData', (req, res) => {
  const { temperature, humidity, soilMoisture } = req.body;
  if (temperature != null && humidity != null && soilMoisture != null) {
    sensorData.temperature = temperature;
    sensorData.humidity = humidity;
    sensorData.soilMoisture = soilMoisture;
    console.log(
      `Received sensor data: Temperature: ${temperature}°C, Humidity: ${humidity}%, Soil Moisture: ${soilMoisture}%`
    );
    res.json({ message: 'Sensor data updated successfully' });
  } else {
    res.status(400).json({ error: 'Invalid data' });
  }
});

// Эндпоинт для получения текущего режима
app.get('/getMode', (req, res) => {
  res.json({ mode: currentMode });
});

// Эндпоинт для изменения режима
app.post('/setMode', (req, res) => {
  const { mode } = req.body;
  if (mode === 'auto' || mode === 'manual') {
    currentMode = mode;
    console.log(`Mode changed to ${currentMode}`);
    res.json({ mode: currentMode });
  } else {
    res.status(400).json({ error: 'Invalid mode' });
  }
});

// Эндпоинт для переключения состояния реле
app.post('/toggleRelay/:relayNumber', (req, res) => {
  const relayNumber = parseInt(req.params.relayNumber, 10);
  const relayStateKey = `relayState${relayNumber}`;
  if (!Number.isNaN(relayNumber) && sensorData[relayStateKey] != null) {
    if (currentMode === 'manual') {
      sensorData[relayStateKey] = !sensorData[relayStateKey];
      console.log(
        `Relay ${relayNumber} toggled to ${sensorData[relayStateKey] ? 'ON' : 'OFF'}`
      );
      res.json({ [relayStateKey]: sensorData[relayStateKey] });
    } else {
      res.status(403).json({ error: 'Cannot toggle relay in automatic mode' });
    }
  } else {
    res.status(400).json({ error: 'Invalid relay number' });
  }
});

// Запуск сервера
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
