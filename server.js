const express = require('express');
const app = express();
const port = process.env.PORT || 80;

// Переменная для хранения последних данных
let sensorData = {
    temperature: null,
    humidity: null,
    soil_moisture: null,
    relayState: false,
    fanState: false
};

// Для обработки JSON данных
app.use(express.json());

// Главная страница с HTML
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Информация с датчиков</title>
                <style>
                    body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
                    .container { max-width: 800px; margin: 50px auto; padding: 20px; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }
                    h1 { text-align: center; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                    th, td { padding: 10px; border: 1px solid #ddd; text-align: center; }
                    th { background-color: #f2f2f2; }
                    .button { padding: 10px 20px; background-color: #4CAF50; color: white; border: none; cursor: pointer; }
                    .button:hover { background-color: #45a049; }
                    .red-button { background-color: #f44336; }
                    .red-button:hover { background-color: #e53935; }
                </style>
                <script>
                    // Функция для обновления данных на странице
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

                    // Функция для отправки запроса на переключение реле
                    function toggleRelay() {
                        fetch('/toggleRelay', { method: 'GET' })
                            .then(response => response.json())
                            .then(data => {
                                console.log('Relay toggled');
                                updateSensorData();  // Обновим данные после изменения состояния реле
                            })
                            .catch(error => console.error('Error toggling relay:', error));
                    }

                    // Обновляем данные каждую секунду
                    setInterval(updateSensorData, 1000);

                    // Загружаем данные сразу при первой загрузке страницы
                    window.onload = updateSensorData;
                </script>
            </head>
            <body>
                <div class="container">
                    <h1>Информация с датчиков</h1>
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
                        <a href="/toggleFan" class="button" style="background-color: #2196F3;">Переключить кулер</a>
                    </div>
                </div>
            </body>
        </html>
    `);
});

// Обработчик для получения последних данных с датчиков (GET запрос)
app.get('/sensorData', (req, res) => {
    res.json(sensorData);
});

// Обработчик для получения данных с ESP32 (POST запрос)
app.post('/data', (req, res) => {
    console.log('Получены данные: ', req.body);
    // Обновляем данные на сервере
    sensorData = req.body;
    res.status(200).send('Data received');
});

// Обработчик для переключения реле
app.get('/toggleRelay', (req, res) => {
    sensorData.relayState = !sensorData.relayState;
    // Переключаем реле (вам нужно будет подключить физическое реле через GPIO)
    console.log(`Relay is now ${sensorData.relayState ? 'ON' : 'OFF'}`);
    res.json({ relayState: sensorData.relayState });
});

// Маршрут для переключения кулера
app.get('/toggleFan', (req, res) => {
    sensorData.fanState = !sensorData.fanState;
    res.redirect('/');
});

// Запускаем сервер
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
