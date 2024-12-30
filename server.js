const express = require('express');
const app = express();
const fetch = require('node-fetch'); // Убедитесь, что эта библиотека установлена: npm install node-fetch
const port = process.env.PORT || 80;

let sensorData = {
    temperature: null,
    humidity: null,
    soil_moisture: null,
    relayState: false,
    fanState: false,
};

app.use(express.json());

// Главная страница
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

                    function turnOnRelay() {
                        fetch('/turnOnRelay')
                            .then(response => response.json())
                            .then(data => {
                                console.log(data.message);
                                updateSensorData();
                            })
                            .catch(error => console.error('Error turning on relay:', error));
                    }

                    function turnOffRelay() {
                        fetch('/turnOffRelay')
                            .then(response => response.json())
                            .then(data => {
                                console.log(data.message);
                                updateSensorData();
                            })
                            .catch(error => console.error('Error turning off relay:', error));
                    }

                    setInterval(updateSensorData, 1000);
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
                        <button onclick="turnOnRelay()" class="button">Включить реле</button>
                        <button onclick="turnOffRelay()" class="red-button">Выключить реле</button>
                    </div>
                </div>
            </body>
        </html>
    `);
});

app.get('/sensorData', (req, res) => {
    res.json(sensorData);
});

app.post('/data', (req, res) => {
    console.log('Получены данные: ', req.body);
    sensorData = req.body;
    res.status(200).send('Data received');
});

app.get('/turnOnRelay', (req, res) => {
    fetch('http://<ESP32_IP>/turnOnRelay') // Замените <ESP32_IP> на IP вашего ESP32
        .then(response => response.text())
        .then(data => {
            console.log('Relay turned ON on ESP32');
            sensorData.relayState = true;
            res.json({ success: true, message: 'Relay turned ON' });
        })
        .catch(err => {
            console.error('Error turning on relay:', err);
            res.status(500).json({ success: false, message: 'Failed to turn on relay' });
        });
});

app.get('/turnOffRelay', (req, res) => {
    fetch('http://<ESP32_IP>/turnOffRelay') // Замените <ESP32_IP> на IP вашего ESP32
        .then(response => response.text())
        .then(data => {
            console.log('Relay turned OFF on ESP32');
            sensorData.relayState = false;
            res.json({ success: true, message: 'Relay turned OFF' });
        })
        .catch(err => {
            console.error('Error turning off relay:', err);
            res.status(500).json({ success: false, message: 'Failed to turn off relay' });
        });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
