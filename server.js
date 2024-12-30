const express = require('express');
const app = express();
const port = process.env.PORT || 80;

// Хранение данных сенсоров
let sensorData = {
    temperature: null,
    humidity: null,
    soil_moisture: null,
    relayState: false,
    fanState: false,
};

// Внешний IP ESP32 (замените на ваш)
const esp32IP = "http://192.168.1.100"; // Укажите локальный или публичный IP ESP32

app.use(express.json());

// Главная страница
app.get('/', (req, res) => {
    res.send(`
        <html>
            <head>
                <title>Управление системой</title>
                <script>
                    function toggleRelay(state) {
                        fetch('/toggleRelay', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ relayState: state })
                        })
                        .then(response => response.json())
                        .then(data => console.log(data))
                        .catch(error => console.error('Ошибка:', error));
                    }

                    function refreshData() {
                        fetch('/sensorData')
                            .then(response => response.json())
                            .then(data => {
                                document.getElementById('relayState').textContent = data.relayState ? "Включено" : "Выключено";
                            })
                            .catch(error => console.error('Ошибка обновления:', error));
                    }

                    setInterval(refreshData, 2000);
                    window.onload = refreshData;
                </script>
            </head>
            <body>
                <h1>Управление системой</h1>
                <p>Реле: <span id="relayState">—</span></p>
                <button onclick="toggleRelay(true)">Включить реле</button>
                <button onclick="toggleRelay(false)">Выключить реле</button>
            </body>
        </html>
    `);
});

// Получение данных с ESP32
app.get('/sensorData', (req, res) => {
    res.json(sensorData);
});

// Обработка управления реле
app.post('/toggleRelay', async (req, res) => {
    const { relayState } = req.body;

    try {
        const espResponse = await fetch(`${esp32IP}/toggleRelay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ relayState }),
        });
        const result = await espResponse.json();

        sensorData.relayState = relayState;
        res.json({ success: true, message: result });
    } catch (error) {
        console.error('Ошибка отправки команды на ESP32:', error);
        res.status(500).json({ success: false, error: 'Не удалось отправить команду' });
    }
});

// Сервер запускается
app.listen(port, () => {
    console.log(`Сервер запущен на порту ${port}`);
});
