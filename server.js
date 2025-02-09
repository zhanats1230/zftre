const express = require('express');
const app = express();
const port = process.env.PORT || 80;

// Хранение данных для реле и датчиков
let sensorData = {
  relayState1: false, // Освещение
  relayState2: false, // Вентиляция
  relayState3: false, // Помпа
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
       <title>Управление теплицей</title>
    <style>

    .controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
    background: #f9f9f9;
    padding: 20px;
    border-radius: 10px;
    box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1);
}

.status {
    display: flex;
    align-items: center;
    gap: 15px;
    width: 100%;
    justify-content: space-between;
}

.icon-container {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
}

.icon-container i {
    font-size: 30px;
    transition: 0.3s;
}

.off {
    color: #bbb;
}

.on {
    color: #f1c40f;
}

.fan-rotate {
    animation: spin 1s linear infinite;
    color: #4CAF50;
}

@keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
        /* Reset styles */
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Poppins', sans-serif;
        }
        
        /* Body styling */
        body {
            background: linear-gradient(135deg, #f5f5f5, #e0e0e0);
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            color: #333;
        }
        
        /* Container styling */
        .container {
            width: 90%;
            max-width: 900px;
            background: #ffffff;
            padding: 40px;
            border-radius: 15px;
            box-shadow: 0px 10px 20px rgba(0, 0, 0, 0.08);
        }
        
        h1, h2 {
            text-align: center;
            margin-bottom: 20px;
            font-weight: 600;
            color: #444;
        }
        
        .section {
            padding: 20px;
            border-radius: 10px;
            background: #f9f9f9;
            margin-bottom: 20px;
            box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.05);
        }
        
        .controls {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 15px;
    background: #f9f9f9;
    padding: 20px;
    border-radius: 10px;
    box-shadow: 0px 4px 10px rgba(0, 0, 0, 0.1);
}
        .controls p {
    font-size: 18px;
    font-weight: 500;
    color: #333;
    margin: 5px 0;
}
        .button {
            background: #607d8b;
            border: none;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 18px;
            font-weight: 500;
            color: #fff;
            cursor: pointer;
            transition: all 0.3s;
        }
        
        .button:hover {
            background: #455a64;
            transform: translateY(-2px);
        }
        
        .data p {
            font-size: 18px;
            text-align: center;
            font-weight: 500;
        }
        
        input {
            width: 100%;
            padding: 12px;
            border: 1px solid #b0bec5;
            border-radius: 6px;
            font-size: 16px;
            margin-top: 5px;
            background: #ffffff;
            color: #333;
            outline: none;
        }
        
        input::placeholder {
            color: #aaa;
        }
        
        .settings button {
            width: 100%;
            margin-top: 15px;
        }
    </style>

        <script>
          let currentMode = 'auto'; // Начальный режим
          let relay2State = false; // Состояние реле вентилятора

          function toggleRelay(relayNumber) {
let relayState = document.getElementById(\`relayState\${relay}\`);
    let icon = relay === 1 ? document.getElementById("lightIcon") : document.getElementById("fanIcon");

    if (relayState.innerText === "Вкл") {
        relayState.innerText = "Выкл";
        icon.classList.remove("on", "fan-rotate");
        icon.classList.add("off");
    } else {
        relayState.innerText = "Вкл";
        icon.classList.remove("off");
        icon.classList.add(relay === 1 ? "on" : "fan-rotate");
    }


          
            if (currentMode === 'manual') {
              fetch(\`/toggleRelay/\${relayNumber}\`, { method: 'POST' })
                .then(response => {
                  if (!response.ok) throw new Error('Network response was not ok');
                  return response.json();
                })
                .then(data => {
                  const relayState = data[\`relayState\${relayNumber}\`];
                  document.getElementById(\`relayState\${relayNumber}\`).textContent =
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
          let modeState = document.getElementById("mode");
    let modeIcon = document.getElementById("modeIcon");

    if (modeState.innerText === "Ручной") {
        modeState.innerText = "Авто";
        modeIcon.style.color = "#555";
    } else {
        modeState.innerText = "Ручной";
        modeIcon.style.color = "#e74c3c";
    }
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
                  document.getElementById('temperature').textContent = \`Температура: \${data.temperature}°C\`;
                  document.getElementById('humidity').textContent = \`Влажность: \${data.humidity}%\`;
                  document.getElementById('soilMoisture').textContent = \`Влажность почвы: \${data.soilMoisture}%\`;
                })
                .catch(error => console.error('Error updating sensor data:', error));
            }, 1000);

            updateInputState();
          });
        </script>
        <script>
function savePumpSettings() {
  const pumpStartHour = parseInt(document.getElementById("pumpStartHour").value);
  const pumpStartMinute = parseInt(document.getElementById("pumpStartMinute").value);
  const pumpDuration = parseInt(document.getElementById("pumpDuration").value);
  const pumpInterval = parseInt(document.getElementById("pumpInterval").value);

  if (isNaN(pumpStartHour) || isNaN(pumpStartMinute) || isNaN(pumpDuration) || isNaN(pumpInterval)) {
    alert("Заполните все поля!");
    return;
  }

  fetch("/updatePumpSettings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pumpStartHour,
      pumpStartMinute,
      pumpDuration,
      pumpInterval
    })
  })
    .then(response => response.json())
    .then(data => alert(data.message))
    .catch(error => console.error("Ошибка:", error));
}

// Загружаем текущие настройки при загрузке страницы
fetch("/getPumpSettings")
  .then(response => response.json())
  .then(data => {
    document.getElementById("pumpStartHour").value = data.pumpStartHour;
    document.getElementById("pumpStartMinute").value = data.pumpStartMinute;
    document.getElementById("pumpDuration").value = data.pumpDuration;
    document.getElementById("pumpInterval").value = data.pumpInterval;
  })
  .catch(error => console.error("Ошибка загрузки настроек:", error));
</script>
      </head>
      <body>
    <div class="container">
        <h1>Управление теплицей</h1>
        
        <div class="section">
            <h2>Реле</h2>
            <div class="controls">
    <div class="status">
        <p>Освещение: <span id="relayState1">—</span></p>
        <div class="icon-container">
            <i id="lightIcon" class="fas fa-lightbulb off"></i>
        </div>
        <button class="button" onclick="toggleRelay(1)">Освещение</button>
    </div>
    
    <div class="status">
        <p>Вентиляция: <span id="relayState2">—</span></p>
        <div class="icon-container">
            <i id="fanIcon" class="fas fa-fan off"></i>
        </div>
        <button class="button" onclick="toggleRelay(2)">Вентиляция</button>
    </div>

    <div class="status">
        <p>Режим работы: <span id="mode">—</span></p>
        <div class="icon-container">
            <i id="modeIcon" class="fas fa-cogs"></i>
        </div>
        <button class="button" onclick="toggleMode()">Переключить режим</button>
    </div>
</div>

        </div>
        
        <div class="section data">
            <h2>Датчики</h2>
            <p id="temperature">Температура: —</p>
            <p id="humidity">Влажность: —</p>
            <p id="soilMoisture">Влажность почвы: —</p>
        </div>
        
        <div class="section settings">
            <h2>Настройки насоса</h2>
            <label>Час включения:</label>
            <input type="number" id="pumpStartHour" min="0" max="23" placeholder="Введите час">
            <label>Минуты включения:</label>
            <input type="number" id="pumpStartMinute" min="0" max="59" placeholder="Введите минуты">
            <label>Время работы (сек):</label>
            <input type="number" id="pumpDuration" min="1" placeholder="Введите время">
            <label>Интервал (мин):</label>
            <input type="number" id="pumpInterval" min="1" placeholder="Введите интервал">
            <button class="button" onclick="savePumpSettings()">Сохранить</button>
        </div>
        
        <div class="section settings">
            <h2>Настройки освещения</h2>
            <label>Порог температуры (°C):</label>
            <input type="number" id="fanTemperatureThreshold" placeholder="Введите порог">
            <label>Время работы света (мин):</label>
            <input type="number" id="lightOnDuration" placeholder="Введите время">
            <label>Интервал переключения света (мин):</label>
            <input type="number" id="lightIntervalManual" placeholder="Введите интервал">
            <button class="button" onclick="saveLightingSettings()">Сохранить</button>
        </div>
    </div>
</body>
    </html>
  `);
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


let pumpSettings = {
  pumpStartHour: 18,   // Час включения
  pumpStartMinute: 0,  // Минуты включения
  pumpDuration: 60,    // Длительность работы (секунды)
  pumpInterval: 120,   // Интервал между включениями (минуты)
};

// Эндпоинт для получения настроек насоса
app.get('/getPumpSettings', (req, res) => {
  res.json(pumpSettings);
});

// Эндпоинт для обновления настроек насоса
app.post('/updatePumpSettings', (req, res) => {
  const { pumpStartHour, pumpStartMinute, pumpDuration, pumpInterval } = req.body;

  if (
    pumpStartHour != null &&
    pumpStartMinute != null &&
    pumpDuration != null &&
    pumpInterval != null
  ) {
    pumpSettings.pumpStartHour = pumpStartHour;
    pumpSettings.pumpStartMinute = pumpStartMinute;
    pumpSettings.pumpDuration = pumpDuration;
    pumpSettings.pumpInterval = pumpInterval;

    console.log("Настройки насоса обновлены:", pumpSettings);
    res.json({ message: "Настройки обновлены!" });
  } else {
    res.status(400).json({ error: "Некорректные данные" });
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
