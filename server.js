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
    <!DOCTYPE html>
    <html lang="ru">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
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
    font-size: 2em;
    color: #333;
    margin-bottom: 20px;
  }
  .button {
    padding: 10px 20px;
    background-color: #4CAF50;
    color: white;
    border: none;
    cursor: pointer;
    font-size: 18px;
    margin-top: 10px;
    border-radius: 5px;
    transition: background-color 0.3s;
  }
  .button:hover {
    background-color: #45a049;
  }
  .data {
    font-size: 18px;
    margin-top: 20px;
    color: #555;
  }
  .disabled {
    background-color: #ccc;
    cursor: not-allowed;
  }
  .relay-button {
    margin-bottom: 10px;
  }
  .input-field {
    margin-top: 20px;
    display: flex;
    flex-direction: column;
  }
  .input-field label {
    font-size: 16px;
    margin-bottom: 8px;
    color: #555;
  }
  .input-field input {
    padding: 10px;
    font-size: 16px;
    border-radius: 5px;
    border: 1px solid #ccc;
    margin-bottom: 15px;
    outline: none;
    transition: border-color 0.3s;
  }
  .input-field input:focus {
    border-color: #4CAF50;
  }
  .input-field button {
    align-self: flex-end;
    padding: 10px 20px;
    background-color: #4CAF50;
    color: white;
    border: none;
    cursor: pointer;
    font-size: 16px;
    border-radius: 5px;
    transition: background-color 0.3s;
  }
  .input-field button:disabled {
    background-color: #ccc;
    cursor: not-allowed;
  }
</style>

        <script>
          let currentMode = 'auto'; // Начальный режим
          let relay2State = false; // Состояние реле вентилятора

          function toggleRelay(relayNumber) {
            if (currentMode === 'manual') {
              fetch(\/toggleRelay/\${relayNumber}\, { method: 'POST' })
                .then(response => {
                  if (!response.ok) throw new Error('Network response was not ok');
                  return response.json();
                })
                .then(data => {
                  const relayState = data[\relayState\${relayNumber}\];
                  document.getElementById(\relayState\${relayNumber}\).textContent =
                    relayState ? 'Включено' : 'Выключено';

                  if (relayNumber === 2) {
                    relay2State = relayState;
                    updateInputState(); // Обновляем доступность полей ввода
                  }
                })
                .catch(error => console.error('Error toggling relay:', error));
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
              .then(response => response.json())
              .then(data => {
                currentMode = data.mode;
                document.getElementById('mode').textContent =
                  currentMode === 'auto' ? 'Автоматический' : 'Ручной';
                updateInputState(); // Обновляем доступность полей ввода
              })
              .catch(error => console.error('Error toggling mode:', error));
          }

          function updateInputState() {
            const inputs = document.querySelectorAll('.input-field input');
            const isManualAndRelayOn = currentMode === 'manual' && relay2State;

            inputs.forEach(input => {
              input.disabled = !isManualAndRelayOn;
            });

            const saveButton = document.querySelector('.save-settings');
            saveButton.disabled = !isManualAndRelayOn;
          }

         function saveLightingSettings() {
  // Получаем значения, введенные пользователем (в минутах)
  const fanTemperatureThreshold = parseFloat(document.getElementById("fanTemperatureThreshold").value);
  const lightOnDurationMinutes = parseFloat(document.getElementById("lightOnDuration").value); // в минутах
  const lightIntervalManualMinutes = parseFloat(document.getElementById("lightIntervalManual").value); // в минутах

  // Проверяем, что все значения корректны
  if (isNaN(fanTemperatureThreshold) || isNaN(lightOnDurationMinutes) || isNaN(lightIntervalManualMinutes)) {
    alert("Пожалуйста, заполните все поля корректными значениями.");
    return;
  }

  // Переводим время в миллисекунды
  const lightOnDuration = lightOnDurationMinutes * 60000;  // Преобразуем минуты в миллисекунды
  const lightIntervalManual = lightIntervalManualMinutes * 60000;  // Преобразуем минуты в миллисекунды

  const settings = {
    fanTemperatureThreshold,
    lightOnDuration,
    lightIntervalManual
  };

  // Отправляем данные на сервер
  fetch("/updateLightingSettings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(settings)
  })
    .then(response => {
      if (!response.ok) {
        throw new Error("Ошибка при отправке настроек.");
      }
      return response.json();
    })
    .then(data => {
      alert("Настройки успешно сохранены!");
      console.log(data);
    })
    .catch((error) => {
      console.error("Ошибка:", error);
      alert("Не удалось сохранить настройки.");
    });
}



          document.addEventListener('DOMContentLoaded', () => {
            setInterval(() => {
              fetch('/getSensorData')
                .then(response => response.json())
                .then(data => {
                  document.getElementById('temperature').textContent = \Температура: \${data.temperature}°C\;
                  document.getElementById('humidity').textContent = \Влажность: \${data.humidity}%\;
                  document.getElementById('soilMoisture').textContent = \Влажность почвы: \${data.soilMoisture}%\;
                })
                .catch(error => console.error('Error updating sensor data:', error));
            }, 1000);

            updateInputState();
          });
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
  <label for="fanTemperatureThreshold">Порог температуры для кулера (°C):</label>
  <input type="number" id="fanTemperatureThreshold" placeholder="Введите порог температуры">

  <label for="lightOnDuration">Время работы света (мин):</label>
  <input type="number" id="lightOnDuration" placeholder="Введите время работы света в минутах">

  <label for="lightIntervalManual">Интервал для переключения света (мин):</label>
  <input type="number" id="lightIntervalManual" placeholder="Введите интервал переключения света в минутах">

  <button class="button save-settings" onclick="saveLightingSettings()">Сохранить настройки</button>
</div>


      </body>
    </html>
  );
});



// Остальные эндпоинты аналогичны, никаких сокращений не применено.


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


// Новые переменные для кулера и света
// Используйте существующую переменную для настройки освещения:
lightingSettings.onDuration = 30; // Обновите настройки, если это нужно
lightingSettings.offDuration = 60;
lightingSettings.fanTemperatureThreshold = 31.0;
lightingSettings.lightOnDuration = 60000;
lightingSettings.lightIntervalManual = 60000;

// Эндпоинт для получения настроек (в том числе для ручного управления)
app.get('/getLightingSettings', (req, res) => {
  res.json(lightingSettings);
});

// Эндпоинт для обновления настроек (в том числе для ручного управления)
// Эндпоинт для обновления настроек освещения
// Эндпоинт для обновления настроек освещения
app.post('/updateLightingSettings', (req, res) => {
  const { fanTemperatureThreshold, lightOnDuration, lightIntervalManual } = req.body;
  if (fanTemperatureThreshold != null && lightOnDuration != null && lightIntervalManual != null) {
    lightingSettings.fanTemperatureThreshold = fanTemperatureThreshold;
    lightingSettings.lightOnDuration = lightOnDuration;
    lightingSettings.lightIntervalManual = lightIntervalManual;

    console.log(`Lighting settings updated: 
      fanTemperatureThreshold: ${fanTemperatureThreshold}, 
      lightOnDuration: ${lightOnDuration}, 
      lightIntervalManual: ${lightIntervalManual}`);
    
    res.json({ message: 'Lighting settings updated successfully' });
  } else {
    res.status(400).json({ error: 'Invalid data' });
  }
});
app.get('/getLightingSettings', (req, res) => {
  res.json(lightingSettings);
});
// Запуск сервера
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
