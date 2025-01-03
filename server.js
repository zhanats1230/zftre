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
          let currentMode = 'auto'; // Начальный режим

          // Функция для переключения состояния реле
          function toggleRelay(relayNumber) {
            fetch(\`/toggleRelay/\${relayNumber}\`, { method: 'POST' })
              .then(response => response.json())
              .then(data => {
                document.getElementById('relayState' + relayNumber).textContent = data['relayState' + relayNumber] ? 'Выключено' : 'Включено';
              })
              .catch(error => console.error('Error toggling relay:', error));
          }

          // Функция для обновления состояния реле
          function updateRelayState() {
            fetch('/getRelayState')
              .then(response => response.json())
              .then(data => {
                document.getElementById('relayState1').textContent = data.relayState1 ? 'Выключено' : 'Включено';
                document.getElementById('relayState2').textContent = data.relayState2 ? 'Выключено' : 'Включено';
              });
          }

          // Функция для обновления данных с датчиков
          function updateSensorData() {
            fetch('/getSensorData')
              .then(response => response.json())
              .then(data => {
                document.getElementById('temperature').textContent = 'Температура: ' + data.temperature + '°C';
                document.getElementById('humidity').textContent = 'Влажность: ' + data.humidity + '%';
                document.getElementById('soilMoisture').textContent = 'Влажность почвы: ' + data.soilMoisture + '%';
              });
          }

          // Функция для переключения между режимами
          function toggleMode() {
            fetch('/setMode', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ mode: currentMode === 'auto' ? 'manual' : 'auto' })
            })
            .then(response => response.json())
            .then(data => {
              currentMode = data.mode;
              document.getElementById('mode').textContent = currentMode === 'auto' ? 'Автоматический' : 'Ручной';
              toggleRelayButtons(); // Обновляем кнопки переключения реле
            })
            .catch(error => console.error('Error toggling mode:', error));
          }

          // Функция для обновления текущего режима
          function updateMode() {
            fetch('/getMode')
              .then(response => response.json())
              .then(data => {
                currentMode = data.mode;
                document.getElementById('mode').textContent = currentMode === 'auto' ? 'Автоматический' : 'Ручной';
                toggleRelayButtons(); // Обновляем кнопки переключения реле
              })
              .catch(error => console.error('Error fetching mode:', error));
          }

          // Функция для включения/выключения кнопок реле
          function toggleRelayButtons() {
            const relayButtons = document.querySelectorAll('.relay-button');
            relayButtons.forEach(button => {
              button.disabled = currentMode === 'auto'; // Если режим авто, то кнопки реле блокируются
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
          <button class="button relay-button" onclick="toggleRelay(1)">Переключить реле 1</button>
          <p>Состояние реле 2 (Пин 18): <span id="relayState2">—</span></p>
          <button class="button relay-button" onclick="toggleRelay(2)">Переключить реле 2</button>
          <p>Режим работы: <span id="mode">—</span></p>
          <button class="button" onclick="toggleMode()">Переключить режим</button>
          <div class="data">
            <p id="temperature">Температура: —</p>
            <p id="humidity">Влажность: —</p>
            <p id="soilMoisture">Влажность почвы: —</p>
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

// Эндпоинт для получения данных с датчиков
app.get('/getSensorData', (req, res) => {
  res.json({
    temperature: sensorData.temperature,
    humidity: sensorData.humidity,
    soilMoisture: sensorData.soilMoisture
  });
});

// Эндпоинт для обновления данных с датчиков
app.post('/updateSensorData', (req, res) => {
  const { temperature, humidity, soilMoisture } = req.body;
  if (temperature != null && humidity != null && soilMoisture != null) {
    sensorData.temperature = temperature;
    sensorData.humidity = humidity;
    sensorData.soilMoisture = soilMoisture;
    console.log(`Received sensor data: Temperature: ${temperature}°C, Humidity: ${humidity}%, Soil Moisture: ${soilMoisture}%`);
    res.json({ message: 'Sensor data updated successfully' });
  } else {
    res.status(400).json({ error: 'Invalid data' });
  }
});

// Переменная для режима
let currentMode = 'auto';  // Стартовый режим - автоматический

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

// Запуск сервера
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
