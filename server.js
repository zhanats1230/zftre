const express = require('express');
const app = express();
const http = require('http');
const fetch = require('node-fetch');
const port = process.env.PORT || 80;

let sensorData = {
    temperature: null,
    humidity: null,
    soil_moisture: null,
    relayState: false,
    fanState: false,
};

app.use(express.json());

app.get('/', (req, res) => {
    res.send(`
    <html>
      <head>
        <title>Управление системой</title>
        <style>
          body { font-family: Arial, sans-serif; background-color: #f4f4f4; margin: 0; padding: 0; }
          .container { max-width: 800px; margin: 50px auto; padding: 20px; background: #fff; border-radius: 8px; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1); }
          h1 { text-align: center; }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { padding: 10px; border: 1px solid #ddd; text-align: center; }
          th { background-color: #f2f2f2; }
          .button { padding: 10px 20px; background-color: #4CAF50; color: white; border: none; cursor: pointer; }
          .button:hover { background-color: #45a049; }
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

          function toggleRelay() {
            fetch('/toggleRelay', { method: 'POST' })
              .then(response => response.json())
              .then(data => {
                updateSensorData();
              })
              .catch(error => console.error('Error toggling relay:', error));
          }

          function toggleFan() {
            fetch('/toggleFan', { method: 'POST' })
              .then(response => response.json())
              .then(data => {
                updateSensorData();
              })
              .catch(error => console.error('Error toggling fan:', error));
          }

          setInterval(updateSensorData, 1000);
          window.onload = updateSensorData;
        </script>
      </head>
      <body>
        <div class="container">
          <h1>Управление системой</h1>
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
            <button onclick="toggleFan()" class="button">Переключить куле</button>
          </div>
        </div>
      </body>
    </html>
  `);
});

app.get('/sensorData', (req, res) => {
    res.json(sensorData);
});

app.post('/toggleRelay', (req, res) => {
    sensorData.relayState = !sensorData.relayState;
    console.log(`Relay toggled to ${sensorData.relayState ? 'ON' : 'OFF'}`);
    updateRelayState(sensorData.relayState);
    res.json({ relayState: sensorData.relayState });
});

app.post('/toggleFan', (req, res) => {
    sensorData.fanState = !sensorData.fanState;
    console.log(`Fan toggled to ${sensorData.fanState ? 'ON' : 'OFF'}`);
    updateFanState(sensorData.fanState);
    res.json({ fanState: sensorData.fanState });
});

async function updateRelayState(state) {
    const relayControlURL = "https://zftre.onrender.com/controlRelay";
    const response = await fetch(relayControlURL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ relayState: state }),
    });
    const result = await response.json();
    console.log('Relay control update response:', result);
}

async function updateFanState(state) {
    const fanControlURL = "https://zftre.onrender.com/controlFan";
    const response = await fetch(fanControlURL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fanState: state }),
    });
    const result = await response.json();
    console.log('Fan control update response:', result);
}

app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
