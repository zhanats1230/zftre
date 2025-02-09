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
        <title>Управление реле</title>
<style>
 /* General body styles */
body {
    font-family: 'Arial', sans-serif; /* Updated font-family for a cleaner look */
    background-color: #f0f4f8; /* Light grayish-blue background for a calm appearance */
    margin: 0;
    padding: 0;
}
 copy
css

/* General body styles */
body {
    font-family: 'Arial', sans-serif; /* Clean and modern font */
    background-color: #f8f9fa; /* Light gray background for a soft appearance */
    margin: 0;
    padding: 0;
}

/* Main container styling */
.container {
    max-width: 600px; /* Limit width for better readability */
    margin: 50px auto; /* Center the container with margin */
    padding: 30px; /* Padding for inner spacing */
    background: #ffffff; /* White background for the container */
    border-radius: 12px; /* Rounded corners for a softer look */
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1); /* Soft shadow for depth */
}

/* Heading styles */
h2 {
    text-align: center; /* Center the heading */
    font-size: 2.5em; /* Larger font size for emphasis */
    color: #343a40; /* Darker color for contrast */
    margin-bottom: 30px; /* Space below the heading */
}

/* Label styles */
label {
    font-size: 1.2em; /* Increased font size for labels */
    color: #495057; /* Darker color for readability */
    margin-bottom: 5px; /* Space below labels */
}

/* Input field styles */
input[type="number"] {
    width: 100%; /* Full width inputs */
    padding: 12px; /* Padding for comfort */
    font-size: 1em; /* Standard font size */
    border: 1px solid #ced4da; /* Light border color */
    border-radius: 6px; /* Rounded corners */
    margin-bottom: 20px; /* Space below inputs */
    outline: none; /* Remove outline */
    transition: border-color 0.3s; /* Smooth transition for focus */
}

/* Input focus styles */
input[type="number"]:focus {
    border-color: #007bff; /* Highlight border on focus */
    box-shadow: 0 0 5px rgba(0, 123, 255, 0.5); /* Subtle shadow effect */
}


/* Responsive design */
@media (max-width: 600px) {
    .container {
        padding: 20px; /* Adjust padding for smaller screens */
    }

    h2 {
        font-size: 2em; /* Adjust heading size for smaller screens */
    }

    button {
        font-size: 1em; /* Adjust button font size */
    }

    input[type="number"] {
        font-size: 1em; /* Standard input font size */
    }
}
/* Main container styling */
.container {
    max-width: 950px; /* Increased maximum width for more space */
    margin: 60px auto; /* Centered with more margin for emphasis */
    padding: 40px; /* Increased padding for better spacing */
    background: #ffffff; /* White background for the container */
    border-radius: 15px; /* Slightly more rounded corners */
    box-shadow: 0 12px 24px rgba(0, 0, 0, 0.15); /* Deeper shadow for more depth */
}

/* Heading styles */
h1 {
    text-align: center;
    font-size: 3.5em; /* Larger font size for better visibility */
    color: #343a40; /* Darker color for contrast */
    margin-bottom: 40px; /* Increased margin for spacing */
    font-weight: bold; /* Bold font for emphasis */
}

/* Button styles */
.button {
    padding: 15px 30px; /* Larger button for better touch area */
    background-color: #007bff; /* Bootstrap primary blue */
    color: white;
    border: none;
    cursor: pointer;
    font-size: 20px; /* Increased font size for better readability */
    margin-top: 15px; 
    border-radius: 8px; /* Slightly larger border radius for a softer look */
    transition: background-color 0.3s, transform 0.2s, box-shadow 0.3s; /* Added box-shadow on hover */
}

.button:hover {
    background-color: #0056b3; /* Darker blue on hover */
    transform: translateY(-2px); /* Lift effect on hover */
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.2); /* Shadow effect on hover */
}

/* Data text styling */
.data {
    font-size: 18px;
    margin-top: 25px;
    color: #495057; /* Slightly darker for better readability */
}

/* Disabled button styles */
.disabled {
    background-color: #d6d6d6; /* Lighter gray for disabled buttons */
    cursor: not-allowed;
}

/* Input field styles */
.input-field {
    margin-top: 30px; /* Increased margin for separation */
    display: flex;
    flex-direction: column;
}

/* Label styles */
.input-field label {
    font-size: 18px; /* Increased font size for better readability */
    margin-bottom: 10px;
    color: #495057; /* Darker color for better readability */
}

/* Input styles */
.input-field input {
    padding: 15px; /* Increased padding for input fields */
    font-size: 16px;
    border-radius: 8px; /* Rounded corners */
    border: 1px solid #ced4da; /* Lighter border color */
    margin-bottom: 20px; /* Increased bottom margin */
    outline: none;
    transition: border-color 0.3s, box-shadow 0.3s; /* Added box-shadow transition */
}

/* Input focus styles */
.input-field input:focus {
    border-color: #007bff; /* Blue border on focus */
    box-shadow: 0 0 5px rgba(0, 123, 255, 0.5); /* Subtle shadow effect */
}

/* Workstation card styles */
.workstation-card {
    background: #ffffff; /* White background for cards */
    border-radius: 12px; /* Rounded corners */
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.1); /* Soft shadow for depth */
    padding: 25px; /* Padding for content */
    margin: 20px 0; /* Margin for separation */
    transition: transform 0.3s, box-shadow 0.3s; /* Transition for hover effect */
}

.workstation-card:hover {
    transform: translateY(-5px); /* Lift effect on hover */
    box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15); /* Enhanced shadow on hover */
}

/* Workstation title styles */
.workstation-title {
    font-size: 1.8em; /* Larger title font size */
    color: #343a40; /* Dark title color */
    margin-bottom: 15px; /* Spacing below title */
    font-weight: bold; /* Bold font for emphasis */
}

/* Workstation description styles */
.workstation-description {
    font-size: 1.1em; /* Slightly larger font size for descriptions */
    color: #6c757d; /* Muted color for descriptions */
}

/* Responsive design */
@media (max-width: 600px) {
    .container {
        padding: 20px; /* Reduced padding on mobile */
    }

    h1 {
        font-size: 2.5em; /* Responsive font size for smaller screens */
    }

    .button, .input-field button {
        width: 100%; /* Full width buttons on mobile */
        padding: 15px; /* Increased padding for easier tapping */
    }

    .input-field input {
        font-size: 14px; /* Smaller input font size */
    }

    /* Adjust workstation card layout for mobile */
    .workstation-card {
        margin: 15px 0; /* Increased margin for better separation */
    }

    /* Workstation title responsiveness */
    .workstation-title {
        font-size: 1.5em; /* Responsive font size for titles */
    }

    /* Workstation description responsiveness */
    .workstation-description {
        font-size: 1em; /* Responsive font size for descriptions */
    }
}
</style>

        <script>
          let currentMode = 'auto'; // Начальный режим
          let relay2State = false; // Состояние реле вентилятора

          function toggleRelay(relayNumber) {
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
          <p>Освещение: <span id="relayState1">—</span></p>
          <button class="button" onclick="toggleRelay(1)">Переключить</button>
          <p>Вентиляция: <span id="relayState2">—</span></p>
          <button class="button" onclick="toggleRelay(2)">Переключить</button>
          <p>Режим работы: <span id="mode">—</span></p>
          <button class="button" onclick="toggleMode()">Переключить режим</button>

          <div class="data">
            <p id="temperature">Температура: —</p>
            <p id="humidity">Влажность: —</p>
            <p id="soilMoisture">Влажность почвы: —</p>
          </div>
<div class="container">
  <h2>Настройки насоса</h2>
  
  <label for="pumpStartHour">Час включения:</label>
  <input type="number" id="pumpStartHour" min="0" max="23">

  <label for="pumpStartMinute">Минуты включения:</label>
  <input type="number" id="pumpStartMinute" min="0" max="59">

  <label for="pumpDuration">Время работы (сек):</label>
  <input type="number" id="pumpDuration" min="1">

  <button onclick="savePumpSettings()">Сохранить</button>
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
