const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const port = 80;

// Path to store sensor data history
const DATA_FILE = 'sensorDataHistory.json';
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let relayState = {
  relayState1: false, // Lighting
  relayState2: false  // Ventilation
};

let sensorData = {
  temperature: 0,
  humidity: 0,
  soilMoisture: 0
};

let lastSensorUpdate = 0; // Timestamp of last sensor data update
let mode = 'manual'; // Default mode
let pumpSettings = {
  pumpStartHour: 8,
  pumpStartMinute: 0,
  pumpDuration: 30,
  pumpInterval: 60
};
let lightingSettings = {
  fanTemperatureThreshold: 25,
  lightOnDuration: 360,
  lightIntervalManual: 720
};

// Store raw and aggregated data
let sensorDataHistory = {
  raw: [], // Raw readings with timestamps
  hourlyAverages: [], // Aggregated hourly averages
  healthyRanges: { // Percentage of time in healthy range
    temperature: { inRange: 0, total: 0 },
    humidity: { inRange: 0, total: 0 },
    soilMoisture: { inRange: 0, total: 0 }
  }
};

// Healthy range thresholds
const HEALTHY_RANGES = {
  temperature: { min: 20, max: 30 },
  humidity: { min: 50, max: 80 },
  soilMoisture: { min: 30, max: 70 }
};

// Load sensor data history from file on startup
async function loadSensorDataHistory() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    sensorDataHistory = JSON.parse(data);
    // Filter raw data to last 24 hours
    const oneDayAgo = Date.now() - 86400000;
    sensorDataHistory.raw = sensorDataHistory.raw.filter(entry => entry.timestamp >= oneDayAgo);
    // Filter hourly averages to last 24 hours
    sensorDataHistory.hourlyAverages = sensorDataHistory.hourlyAverages.filter(entry => entry.timestamp >= oneDayAgo);
    console.log(`Loaded ${sensorDataHistory.raw.length} raw entries and ${sensorDataHistory.hourlyAverages.length} hourly averages`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing sensor data file found, starting with empty history');
    } else {
      console.error('Error loading sensor data history:', error);
    }
    sensorDataHistory = { 
      raw: [], 
      hourlyAverages: [], 
      healthyRanges: { 
        temperature: { inRange: 0, total: 0 }, 
        humidity: { inRange: 0, total: 0 }, 
        soilMoisture: { inRange: 0, total: 0 } 
      } 
    };
  }
}

// Save sensor data history to file
async function saveSensorDataHistory() {
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(sensorDataHistory, null, 2));
    console.log('Sensor data history saved to file');
  } catch (error) {
    console.error('Error saving sensor data history:', error);
  }
}

// Compute hourly averages
function computeHourlyAverages() {
  const oneDayAgo = Date.now() - 86400000;
  const hourlyBuckets = {};

  // Group raw data by hour
  sensorDataHistory.raw.forEach(entry => {
    const date = new Date(entry.timestamp);
    const hourKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}`;
    if (!hourlyBuckets[hourKey]) {
      hourlyBuckets[hourKey] = { temperature: [], humidity: [], soilMoisture: [], timestamp: date.setMinutes(0, 0, 0) };
    }
    hourlyBuckets[hourKey].temperature.push(entry.temperature);
    hourlyBuckets[hourKey].humidity.push(entry.humidity);
    hourlyBuckets[hourKey].soilMoisture.push(entry.soilMoisture);
  });

  // Calculate averages
  sensorDataHistory.hourlyAverages = Object.keys(hourlyBuckets).map(key => {
    const bucket = hourlyBuckets[key];
    return {
      timestamp: bucket.timestamp,
      temperature: bucket.temperature.length ? bucket.temperature.reduce((sum, val) => sum + val, 0) / bucket.temperature.length : 0,
      humidity: bucket.humidity.length ? bucket.humidity.reduce((sum, val) => sum + val, 0) / bucket.humidity.length : 0,
      soilMoisture: bucket.soilMoisture.length ? bucket.soilMoisture.reduce((sum, val) => sum + val, 0) / bucket.soilMoisture.length : 0
    };
  }).filter(entry => entry.timestamp >= oneDayAgo);
}

// Update healthy range metrics
function updateHealthyRanges({ temperature, humidity, soilMoisture }) {
  sensorDataHistory.healthyRanges.temperature.total++;
  sensorDataHistory.healthyRanges.humidity.total++;
  sensorDataHistory.healthyRanges.soilMoisture.total++;

  if (
    temperature >= HEALTHY_RANGES.temperature.min &&
    temperature <= HEALTHY_RANGES.temperature.max
  ) {
    sensorDataHistory.healthyRanges.temperature.inRange++;
  }
  if (
    humidity >= HEALTHY_RANGES.humidity.min &&
    humidity <= HEALTHY_RANGES.humidity.max
  ) {
    sensorDataHistory.healthyRanges.humidity.inRange++;
  }
  if (
    soilMoisture >= HEALTHY_RANGES.soilMoisture.min &&
    soilMoisture <= HEALTHY_RANGES.soilMoisture.max
  ) {
    sensorDataHistory.healthyRanges.soilMoisture.inRange++;
  }
}

// Serve the login page
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Greenhouse Login</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
          background-color: #f0f0f0;
        }
        .login-container {
          background-color: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
          text-align: center;
        }
        input {
          margin: 10px 0;
          padding: 10px;
          width: 200px;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        button {
          padding: 10px 20px;
          background-color: #4CAF50;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        button:hover {
          background-color: #45a049;
        }
        .error {
          color: red;
          display: none;
        }
      </style>
    </head>
    <body>
      <div class="login-container">
        <h2>Greenhouse Login</h2>
        <form id="loginForm" onsubmit="handleLogin(event)">
          <input type="password" id="password" placeholder="Enter Password" required>
          <br>
          <button type="submit">Login</button>
          <p id="error" class="error">Incorrect Password</p>
        </form>
      </div>
      <script>
        async function handleLogin(event) {
          event.preventDefault();
          const password = document.getElementById('password').value;
          try {
            const response = await fetch('/login', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ password })
            });
            const data = await response.json();
            if (data.success) {
              window.location.href = data.redirect;
            } else {
              document.getElementById('error').style.display = 'block';
            }
          } catch (error) {
            console.error('Login error:', error);
            document.getElementById('error').style.display = 'block';
          }
        }
      </script>
    </body>
    </html>
  `);
});

// Server-side login endpoint
app.post('/login', (req, res) => {
  const { password } = req.body;
  // Replace with a secure password or integrate with a user database
  if (password === 'yourSecurePassword') {
    res.json({ success: true, redirect: '/' });
  } else {
    res.status(401).json({ error: 'Incorrect password' });
  }
});

// Serve the main page
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Greenhouse Control</title>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          background-color: #f4f4f4;
        }
        .container {
          max-width: 1000px;
          margin: 20px auto;
          background: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #ccc;
          padding-bottom: 10px;
          margin-bottom: 20px;
        }
        .header button {
          padding: 10px 20px;
          background-color: #4CAF50;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
        }
        .header button:hover {
          background-color: #45a049;
        }
        .tabs {
          display: flex;
          border-bottom: 1px solid #ccc;
          margin-bottom: 20px;
        }
        .tab {
          padding: 10px 20px;
          cursor: pointer;
          background-color: #f0f0f0;
          margin-right: 5px;
          border-radius: 4px 4px 0 0;
        }
        .tab.active {
          background-color: #4CAF50;
          color: white;
        }
        .section {
          display: none;
        }
        .section.active {
          display: block;
        }
        .card {
          border: 1px solid #ccc;
          border-radius: 4px;
          padding: 15px;
          margin-bottom: 20px;
        }
        .card h3 {
          margin-top: 0;
        }
        input {
          padding: 8px;
          margin: 5px 0;
          border: 1px solid #ccc;
          border-radius: 4px;
        }
        button {
          padding: 10px 20px;
          background-color: #4CAF50;
          color: white;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          margin: 5px;
        }
        button:hover {
          background-color: #45a049;
        }
        canvas {
          max-width: 100%;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>Greenhouse Control</h1>
          <div>
            <span id="systemStatus">System Status: <span id="isOnline">Offline</span></span>
            <button id="toggleMode">Switch Mode</button>
            <button id="logout">Logout</button>
          </div>
        </div>
        <div class="tabs">
          <div class="tab active" data-tab="dashboard">Dashboard</div>
          <div class="tab" data-tab="relays">Relays</div>
          <div class="tab" data-tab="settings">Settings</div>
        </div>
        <div id="dashboard" class="section active">
          <div class="card">
            <h3>System Status</h3>
            <p>Mode: <span id="mode">—</span></p>
            <p>Lighting: <span id="relayState1">—</span></p>
            <p>Ventilation: <span id="relayState2">—</span></p>
          </div>
          <div class="card">
            <h3>Environmental Sensors</h3>
            <div>
              <h4>Temperature</h4>
              <p><span id="temperature">—</span> °C</p>
              <button onclick="showTrends('temperatureTrends')">View Trends</button>
            </div>
            <div>
              <h4>Humidity</h4>
              <p><span id="humidity">—</span> %</p>
              <button onclick="showTrends('humidityTrends')">View Trends</button>
            </div>
            <div>
              <h4>Soil Moisture</h4>
              <p><span id="soilMoisture">—</span> %</p>
              <button onclick="showTrends('soilMoistureTrends')">View Trends</button>
            </div>
          </div>
          <div id="temperatureTrends" class="card section">
            <h3>Temperature Trends</h3>
            <canvas id="temperatureChart"></canvas>
          </div>
          <div id="humidityTrends" class="card section">
            <h3>Humidity Trends</h3>
            <canvas id="humidityChart"></canvas>
          </div>
          <div id="soilMoistureTrends" class="card section">
            <h3>Soil Moisture Trends</h3>
            <canvas id="soilMoistureChart"></canvas>
          </div>
        </div>
        <div id="relays" class="section">
          <div class="card">
            <h3>Lighting</h3>
            <p>Lighting: <span id="relayState1_relays">—</span></p>
            <button onclick="toggleRelay(1)">Toggle Lighting</button>
          </div>
          <div class="card">
            <h3>Ventilation</h3>
            <p>Ventilation: <span id="relayState2_relays">—</span></p>
            <button onclick="toggleRelay(2)">Toggle Ventilation</button>
          </div>
        </div>
        <div id="settings" class="section">
          <div class="card">
            <h3>Manual Mode Settings</h3>
            <div>
              <label>Temp Threshold (°C)</label>
              <input type="number" id="fanTemperatureThreshold" step="0.1">
            </div>
            <div>
              <label>Light Duration (min)</label>
              <input type="number" id="lightOnDuration">
            </div>
            <div>
              <label>Light Interval (min)</label>
              <input type="number" id="lightIntervalManual">
            </div>
            <button onclick="saveLightingSettings()">Save Settings</button>
          </div>
          <div class="card">
            <h3>Pump Settings</h3>
            <div>
              <label>Start Hour</label>
              <input type="number" id="pumpStartHour" min="0" max="23">
            </div>
            <div>
              <label>Start Minute</label>
              <input type="number" id="pumpStartMinute" min="0" max="59">
            </div>
            <div>
              <label>Duration (sec)</label>
              <input type="number" id="pumpDuration" min="1">
            </div>
            <div>
              <label>Interval (min)</label>
              <input type="number" id="pumpInterval" min="1">
            </div>
            <button onclick="savePumpSettings()">Save Settings</button>
          </div>
        </div>
      </div>
      <script>
        async function fetchSensorData() {
          const response = await fetch('/getSensorData');
          const data = await response.json();
          document.getElementById('_temperature').textContent = data.temperature.toFixed(1);
          document.getElementById('humidity').textContent = data.humidity.toFixed(1);
          document.getElementById('soilMoisture').textContent = data.soilMoisture.toFixed(1);
        }

        async function fetchSensorStatus() {
          const response = await fetch('/getSensorStatus');
          const data = await response.json();
          document.getElementById('isOnline').textContent = data.isOnline ? 'Online' : 'Offline';
        }

        async function fetchMode() {
          const response = await fetch('/getMode');
          const data = await response.json();
          document.getElementById('mode').textContent = data.mode;
          document.getElementById('toggleMode').textContent = `Switch to ${data.mode === 'auto' ? 'Manual' : 'Auto'}`;
        }

        async function fetchRelayState() {
          const response = await fetch('/getRelayState');
          const data = await response.json();
          document.getElementById('relayState1').textContent = data.relayState1 ? 'On' : 'Off';
          document.getElementById('relayState2').textContent = data.relayState2 ? 'On' : 'Off';
          document.getElementById('relayState1_relays').textContent = data.relayState1 ? 'On' : 'Off';
          document.getElementById('relayState2_relays').textContent = data.relayState2 ? 'On' : 'Off';
        }

        async function fetchSensorTrends() {
          const response = await fetch('/getSensorTrends');
          const data = await response.json();
          const labels = data.hourlyAverages.map(entry => new Date(entry.timestamp).toLocaleTimeString());
          
          const temperatureChart = new Chart(document.getElementById('temperatureChart').getContext('2d'), {
            type: 'line',
            data: {
              labels: labels,
              datasets: [{
                label: 'Temperature (°C)',
                data: data.hourlyAverages.map(entry => entry.temperature),
                borderColor: '#FF6384',
                fill: false
              }]
            },
            options: { responsive: true, scales: { x: { title: { display: true, text: 'Time' } }, y: { title: { display: true, text: 'Temperature (°C)' } } } }
          });

          const humidityChart = new Chart(document.getElementById('humidityChart').getContext('2d'), {
            type: 'line',
            data: {
              labels: labels,
              datasets: [{
                label: 'Humidity (%)',
                data: data.hourlyAverages.map(entry => entry.humidity),
                borderColor: '#36A2EB',
                fill: false
              }]
            },
            options: { responsive: true, scales: { x: { title: { display: true, text: 'Time' } }, y: { title: { display: true, text: 'Humidity (%)' } } } }
          });

          const soilMoistureChart = new Chart(document.getElementById('soilMoistureChart').getContext('2d'), {
            type: 'line',
            data: {
              labels: labels,
              datasets: [{
                label: 'Soil Moisture (%)',
                data: data.hourlyAverages.map(entry => entry.soilMoisture),
                borderColor: '#4CAF50',
                fill: false
              }]
            },
            options: { responsive: true, scales: { x: { title: { display: true, text: 'Time' } }, y: { title: { display: true, text: 'Soil Moisture (%)' } } } }
          });
        }

        async function toggleRelay(relayNumber) {
          const response = await fetch(`/toggleRelay/${relayNumber}`, { method: 'POST' });
          if (response.ok) {
            await fetchRelayState();
            alert(`Relay ${relayNumber} toggled`);
          } else {
            const data = await response.json();
            alert(data.error);
          }
        }

        async function toggleMode() {
          const currentMode = document.getElementById('mode').textContent;
          const newMode = currentMode === 'auto' ? 'manual' : 'auto';
          await fetch('/setMode', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mode: newMode })
          });
          await fetchMode();
        }

        async function fetchSettings() {
          const pumpResponse = await fetch('/getPumpSettings');
          const pumpData = await pumpResponse.json();
          document.getElementById('pumpStartHour').value = pumpData.pumpStartHour;
          document.getElementById('pumpStartMinute').value = pumpData.pumpStartMinute;
          document.getElementById('pumpDuration').value = pumpData.pumpDuration;
          document.getElementById('pumpInterval').value = pumpData.pumpInterval;

          const lightingResponse = await fetch('/getLightingSettings');
          const lightingData = await lightingResponse.json();
          document.getElementById('fanTemperatureThreshold').value = lightingData.fanTemperatureThreshold;
          document.getElementById('lightOnDuration').value = lightingData.lightOnDuration;
          document.getElementById('lightIntervalManual').value = lightingData.lightIntervalManual;
        }

        async function savePumpSettings() {
          const settings = {
            pumpStartHour: parseInt(document.getElementById('pumpStartHour').value),
            pumpStartMinute: parseInt(document.getElementById('pumpStartMinute').value),
            pumpDuration: parseInt(document.getElementById('pumpDuration').value),
            pumpInterval: parseInt(document.getElementById('pumpInterval').value)
          };
          const response = await fetch('/updatePumpSettings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
          });
          if (response.ok) {
            alert('Pump settings saved');
          } else {
            const data = await response.json();
            alert(data.error);
          }
        }

        async function saveLightingSettings() {
          const settings = {
            fanTemperatureThreshold: parseFloat(document.getElementById('fanTemperatureThreshold').value),
            lightOnDuration: parseInt(document.getElementById('lightOnDuration').value),
            lightIntervalManual: parseInt(document.getElementById('lightIntervalManual').value)
          };
          const response = await fetch('/updateLightingSettings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(settings)
          });
          if (response.ok) {
            alert('Lighting settings saved');
          } else {
            const data = await response.json();
            alert(data.error);
          }
        }

        function showTrends(sectionId) {
          document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
          document.getElementById(sectionId).classList.add('active');
        }

        // Tab navigation
        document.querySelectorAll('.tab').forEach(tab => {
          tab.addEventListener('click', () => {
            document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.section').forEach(section => section.classList.remove('active'));
            document.getElementById(tab.dataset.tab).classList.add('active');
          });
        });

        // Logout
        document.getElementById('logout').addEventListener('click', () => {
          window.location.href = '/login';
        });

        // Toggle mode
        document.getElementById('toggleMode').addEventListener('click', toggleMode);

        // Initial data fetch
        fetchSensorData();
        fetchSensorStatus();
        fetchMode();
        fetchRelayState();
        fetchSensorTrends();
        fetchSettings();
        // Refresh data every 10 seconds
        setInterval(() => {
          fetchSensorData();
          fetchSensorStatus();
          fetchRelayState();
        }, 10000);
      </script>
    </body>
    </html>
  `);
});

// API Endpoints
app.get('/getSensorStatus', (req, res) => {
  try {
    const now = Date.now();
    const isOnline = now - lastSensorUpdate < 30000; // 30 seconds threshold
    res.json({ isOnline });
  } catch (error) {
    console.error('Error in /getSensorStatus:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/getRelayState', (req, res) => {
  try {
    res.json(relayState);
  } catch (error) {
    console.error('Error in /getRelayState:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/getSensorData', (req, res) => {
  try {
    res.json(sensorData);
  } catch (error) {
    console.error('Error in /getSensorData:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/updateSensorData', (req, res) => {
  try {
    const { temperature, humidity, soilMoisture } = req.body;
    if (
      typeof temperature === 'number' &&
      typeof humidity === 'number' &&
      typeof soilMoisture === 'number' &&
      !isNaN(temperature) &&
      !isNaN(humidity) &&
      !isNaN(soilMoisture)
    ) {
      sensorData = { temperature, humidity, soilMoisture };
      lastSensorUpdate = Date.now();
      sensorDataHistory.raw.push({
        temperature,
        humidity,
        soilMoisture,
        timestamp: lastSensorUpdate
      });
      // Clean up raw data older than 24 hours
      const oneDayAgo = Date.now() - 86400000;
      sensorDataHistory.raw = sensorDataHistory.raw.filter(entry => entry.timestamp >= oneDayAgo);
      // Update hourly averages and healthy ranges
      computeHourlyAverages();
      updateHealthyRanges({ temperature, humidity, soilMoisture });
      // Save to file
      saveSensorDataHistory();
      console.log('Sensor data updated:', sensorData);
      res.json({ success: true });
    } else {
      console.error('Invalid sensor data received:', req.body);
      res.status(400).json({ error: 'Invalid sensor data' });
    }
  } catch (error) {
    console.error('Error in /updateSensorData:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/getSensorTrends', (req, res) => {
  try {
    const oneDayAgo = Date.now() - 86400000;
    res.json({
      hourlyAverages: sensorDataHistory.hourlyAverages.filter(entry => entry.timestamp >= oneDayAgo),
      healthyRanges: {
        temperature: sensorDataHistory.healthyRanges.temperature.total > 0 
          ? (sensorDataHistory.healthyRanges.temperature.inRange / sensorDataHistory.healthyRanges.temperature.total * 100) 
          : 0,
        humidity: sensorDataHistory.healthyRanges.humidity.total > 0 
          ? (sensorDataHistory.healthyRanges.humidity.inRange / sensorDataHistory.healthyRanges.humidity.total * 100) 
          : 0,
        soilMoisture: sensorDataHistory.healthyRanges.soilMoisture.total > 0 
          ? (sensorDataHistory.healthyRanges.soilMoisture.inRange / sensorDataHistory.healthyRanges.soilMoisture.total * 100) 
          : 0
      }
    });
  } catch (error) {
    console.error('Error in /getSensorTrends:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/getMode', (req, res) => {
  try {
    res.json({ mode });
  } catch (error) {
    console.error('Error in /getMode:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/setMode', (req, res) => {
  try {
    const { mode: newMode } = req.body;
    if (newMode === 'auto' || newMode === 'manual') {
      mode = newMode;
      console.log('Mode set to:', mode);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid mode' });
    }
  } catch (error) {
    console.error('Error in /setMode:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/toggleRelay/:relayNumber', (req, res) => {
  try {
    const relayNumber = parseInt(req.params.relayNumber);
    if (relayNumber === 1 || relayNumber === 2) {
      if (mode === 'manual') {
        relayState[`relayState${relayNumber}`] = !relayState[`relayState${relayNumber}`];
        console.log(`Relay ${relayNumber} toggled to:`, relayState[`relayState${relayNumber}`]);
        res.json({ success: true });
      } else {
        res.status(400).json({ error: 'Cannot toggle relay in auto mode' });
      }
    } else {
      res.status(400).json({ error: 'Invalid relay number' });
    }
  } catch (error) {
    console.error('Error in /toggleRelay:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/getPumpSettings', (req, res) => {
  try {
    res.json(pumpSettings);
  } catch (error) {
    console.error('Error in /getPumpSettings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/updatePumpSettings', (req, res) => {
  try {
    const { pumpStartHour, pumpStartMinute, pumpDuration, pumpInterval } = req.body;
    if (
      Number.isInteger(pumpStartHour) && pumpStartHour >= 0 && pumpStartHour <= 23 &&
      Number.isInteger(pumpStartMinute) && pumpStartMinute >= 0 && pumpStartMinute <= 59 &&
      Number.isInteger(pumpDuration) && pumpDuration > 0 &&
      Number.isInteger(pumpInterval) && pumpInterval > 0
    ) {
      pumpSettings = { pumpStartHour, pumpStartMinute, pumpDuration, pumpInterval };
      console.log('Pump settings updated:', pumpSettings);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid pump settings' });
    }
  } catch (error) {
    console.error('Error in /updatePumpSettings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/getLightingSettings', (req, res) => {
  try {
    res.json(lightingSettings);
  } catch (error) {
    console.error('Error in /getLightingSettings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/updateLightingSettings', (req, res) => {
  try {
    const { fanTemperatureThreshold, lightOnDuration, lightIntervalManual } = req.body;
    if (
      typeof fanTemperatureThreshold === 'number' &&
      typeof lightOnDuration === 'number' && lightOnDuration > 0 &&
      typeof lightIntervalManual === 'number' && lightIntervalManual > 0
    ) {
      lightingSettings = { fanTemperatureThreshold, lightOnDuration, lightIntervalManual };
      console.log('Lighting settings updated:', lightingSettings);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid lighting settings' });
    }
  } catch (error) {
    console.error('Error in /updateLightingSettings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Start server and load data
async function startServer() {
  await loadSensorDataHistory();
  app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

startServer();
