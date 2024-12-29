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
                    .button-blue { background-color: #2196F3; }
                    .button-blue:hover { background-color: #0b7dda; }
                </style>
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
                            <td>${sensorData.temperature !== null ? sensorData.temperature : '—'}</td>
                            <td>${sensorData.humidity !== null ? sensorData.humidity : '—'}</td>
                            <td>${sensorData.soil_moisture !== null ? sensorData.soil_moisture : '—'}</td>
                            <td>${sensorData.relayState ? 'Включено' : 'Выключено'}</td>
                            <td>${sensorData.fanState ? 'Включено' : 'Выключено'}</td>
                        </tr>
                    </table>
                    <div style="text-align: center; margin-top: 20px;">
                        <a href="/toggleRelay" class="button">Переключить реле</a>
                        <a href="/toggleFan" class="button button-blue">Переключить кулер</a>
                    </div>
                </div>
            </body>
        </html>
    `);
});

// Обработчик для получения данных с ESP32 (POST запрос)
app.post('/data', (req, res) => {
    console.log('Получены данные: ', req.body);
    // Обновляем данные на сервере
    sensorData = req.body;
    res.status(200).send('Data received');
});

// Маршруты для переключения реле и кулера
app.get('/toggleRelay', (req, res) => {
    sensorData.relayState = !sensorData.relayState;
    console.log('Состояние реле изменено на:', sensorData.relayState ? 'Включено' : 'Выключено');
    res.redirect('/');  // Перенаправляем на главную страницу
});

app.get('/toggleFan', (req, res) => {
    sensorData.fanState = !sensorData.fanState;
    console.log('Состояние кулера изменено на:', sensorData.fanState ? 'Включено' : 'Выключено');
    res.redirect('/');  // Перенаправляем на главную страницу
});

// Запускаем сервер
app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
