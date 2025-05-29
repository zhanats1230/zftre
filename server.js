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
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public' directory

let relayState = {
  relayState1: false,
  relayState2: false
};

let sensorData = {
  temperature: 0,
  humidity: 0,
  soilMoisture: 0
};

let lastSensorUpdate = 0; // Timestamp of last sensor data update
let mode = 'manual'; // Default mode
let lightingSettings = {
  fanTemperatureThreshold: 25,
  lightOnDuration: 60,
  lightIntervalManual: 120
};
let pumpSettings = {
  pumpStartHour: 6,
  pumpStartMinute: 0,
  pumpDuration: 30,
  pumpInterval: 60
};

// Predefined crop profiles
let cropProfiles = {
  potato: {
    name: 'Potato',
    fanTemperatureThreshold: 22,
    lightOnDuration: 60,
    lightIntervalManual: 120,
    pumpStartHour: 6,
    pumpStartMinute: 0,
    pumpDuration: 30,
    pumpInterval: 60
  },
  carrot: {
    name: 'Carrot',
    fanTemperatureThreshold: 20,
    lightOnDuration: 45,
    lightIntervalManual: 90,
    pumpStartHour: 7,
    pumpStartMinute: 0,
    pumpDuration: 20,
    pumpInterval: 45
  }
};

let selectedCrop = null; // Currently selected crop (null if custom settings)

// Store raw and aggregated data
let sensorDataHistory = {
  raw: [], // Raw readings with timestamps
  hourlyAverages: [], // Aggregated hourly averages
  healthyRanges: { // Percentage of time in healthy range
    temperature: { inRange: 0, total: 0 },
    humidity: { inRange: 0, total: 0 },
    soilMoisture: { inRange: 0, total: 0 }
  },
  cropProfiles, // Store crop profiles
  selectedCrop // Store selected crop
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
    // Load crop profiles and selected crop
    cropProfiles = sensorDataHistory.cropProfiles || cropProfiles;
    selectedCrop = sensorDataHistory.selectedCrop || null;
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
      },
      cropProfiles,
      selectedCrop
    };
  }
}

// Save sensor data history to file
async function saveSensorDataHistory() {
  try {
    sensorDataHistory.cropProfiles = cropProfiles;
    sensorDataHistory.selectedCrop = selectedCrop;
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

// Update healthy range metrics (fixed syntax error)
function updateHealthyRanges({ temperature, humidity, soilMoisture }) {
  sensorDataHistory.healthyRanges.temperature.total++;
  sensorDataHistory.healthyRanges.humidity.total++;
  sensorDataHistory.healthyRanges.soilMoisture.total++;

  if (temperature >= HEALTHY_RANGES.temperature.min && temperature <= HEALTHY_RANGES.temperature.max) {
    sensorDataHistory.healthyRanges.temperature.inRange++;
  }
  if (humidity >= HEALTHY_RANGES.humidity.min && humidity <= HEALTHY_RANGES.humidity.max) {
    sensorDataHistory.healthyRanges.humidity.inRange++;
  }
  if (soilMoisture >= HEALTHY_RANGES.soilMoisture.min && soilMoisture <= HEALTHY_RANGES.soilMoisture.max) {
    sensorDataHistory.healthyRanges.soilMoisture.inRange++;
  }
}

// Serve the login page with updated Settings tab
app.get('/login', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Greenhouse Login</title>
      <style>
        body { font-family: Arial, sans-serif; margin: 0; padding: 0; background-color: #f4f4f4; }
        .container { max-width: 1200px; margin: auto; padding: 20px; }
        .tab-content { display: none; }
        .tab-content.active { display: block; }
        .column { display: inline-block; vertical-align: top; width: 30%; margin-right: 3%; }
        .column:last-child { margin-right: 0; }
        .card { background: white; padding: 20px; margin-bottom: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
        button, input[type="submit"] { padding: 10px 20px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:hover, input[type="submit"]:hover { background: #218838; }
        input, select { padding: 8px; margin: 5px 0; width: calc(100% - 16px); }
        .tabs { margin-bottom: 20px; }
        .tabs button { background: #ddd; padding: 10px; margin-right: 5px; border: none; cursor: pointer; }
        .tabs button.active { background: #28a745; color: white; }
      </style>
      <script>
        function showTab(tabId) {
          document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
          document.querySelectorAll('.tabs button').forEach(btn => btn.classList.remove('active'));
          document.getElementById(tabId).classList.add('active');
          document.querySelector('[onclick="showTab(\'' + tabId + '\')"]').classList.add('active');
        }
        async function selectCrop() {
          const cropSelect = document.getElementById('cropSelect');
          const cropKey = cropSelect.value;
          if (cropKey) {
            const response = await fetch('/selectCrop', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ cropKey })
            });
            const result = await response.json();
            if (result.success) {
              alert('Crop settings applied!');
              // Update settings inputs
              document.getElementById('fanTemperatureThreshold').value = result.settings.fanTemperatureThreshold;
              document.getElementById('lightOnDuration').value = result.settings.lightOnDuration;
              document.getElementById('lightIntervalManual').value = result.settings.lightIntervalManual;
              document.getElementById('pumpStartHour').value = result.settings.pumpStartHour;
              document.getElementById('pumpStartMinute').value = result.settings.pumpStartMinute;
              document.getElementById('pumpDuration').value = result.settings.pumpDuration;
              document.getElementById('pumpInterval').value = result.settings.pumpInterval;
            } else {
              alert('Error applying crop settings: ' + result.error);
            }
          }
        }
        async function addOrUpdateCrop() {
          const cropName = document.getElementById('newCropName').value;
          if (!cropName) {
            alert('Please enter a crop name');
            return;
          }
          const cropSettings = {
            name: cropName,
            fanTemperatureThreshold: parseFloat(document.getElementById('fanTemperatureThreshold').value),
            lightOnDuration: parseInt(document.getElementById('lightOnDuration').value),
            lightIntervalManual: parseInt(document.getElementById('lightIntervalManual').value),
            pumpStartHour: parseInt(document.getElementById('pumpStartHour').value),
            pumpStartMinute: parseInt(document.getElementById('pumpStartMinute').value),
            pumpDuration: parseInt(document.getElementById('pumpDuration').value),
            pumpInterval: parseInt(document.getElementById('pumpInterval').value)
          };
          const response = await fetch('/addOrUpdateCrop', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(cropSettings)
          });
          const result = await response.json();
          if (result.success) {
            alert('Crop saved successfully!');
            // Refresh crop dropdown
            const cropSelect = document.getElementById('cropSelect');
            const newOption = new Option(cropSettings.name, cropSettings.name.toLowerCase().replace(/\s+/g, '_'));
            cropSelect.add(newOption);
            cropSelect.value = cropSettings.name.toLowerCase().replace(/\s+/g, '_');
          } else {
            alert('Error saving crop: ' + result.error);
          }
        }
      </script>
    </head>
    <body>
      <div class="container">
        <div id="login" class="tab-content">
          <h2>Greenhouse Login</h2>
          <form action="/login" method="POST">
            <input type="text" placeholder="Username" required>
            <input type="password" placeholder="Password" required>
            <input type="submit" value="Login">
            <p>Incorrect Password</p>
          </form>
        </div>

        <div id="control" class="tab-content active">
          <h2>Greenhouse Control</h2>
          <button>Switch Mode</button>
          <span>Offline</span>
          <button>Logout</button>

          <div class="tabs">
            <button class="active" onclick="showTab('dashboard')">Dashboard</button>
            <button onclick="showTab('relays')">Relays</button>
            <button onclick="showTab('settings')">Settings</button>
          </div>

          <div id="dashboard" class="tab-content active">
            <div class="column">
              <div class="card">
                <h3>System Status</h3>
                <p>Mode: —</p>
                <p>Lighting: —</p>
                <p>Ventilation: —</p>
              </div>
            </div>
            <div class="column">
              <div class="card">
                <h3>Environmental Sensors</h3>
                <div>
                  <h4>Temperature</h4>
                  <p>— °C</p>
                  <button>View Trends</button>
                </div>
                <div>
                  <h4>Humidity</h4>
                  <p>— %</p>
                  <button>View Trends</button>
                </div>
                <div>
                  <h4>Soil Moisture</h4>
                  <p>— %</p>
                  <button>View Trends</button>
                </div>
              </div>
            </div>
          </div>

          <div id="temperatureTrends" class="tab-content">
            <h3>Temperature Trends</h3>
            <canvas id="temperatureChart"></canvas>
          </div>
          <div id="humidityTrends" class="tab-content">
            <h3>Humidity Trends</h3>
            <canvas id="humidityChart"></canvas>
          </div>
          <div id="soilMoistureTrends" class="tab-content">
            <h3>Soil Moisture Trends</h3>
            <canvas id="soilMoistureChart"></canvas>
          </div>

          <div id="relays" class="tab-content">
            <div class="column">
              <div class="card">
                <h3>Lighting</h3>
                <p>Lighting: —</p>
                <button>Toggle Lighting</button>
              </div>
              <div class="card">
                <h3>Ventilation</h3>
                <p>Ventilation: —</p>
                <button>Toggle Ventilation</button>
              </div>
            </div>
          </div>

          <div id="settings" class="tab-content">
            <div class="column">
              <div class="card">
                <h3>Manual Mode Settings</h3>
                <div>
                  <label>Temp Threshold (°C)</label>
                  <input id="fanTemperatureThreshold" type="number" value="25">
                </div>
                <div>
                  <label>Light Duration (min)</label>
                  <input id="lightOnDuration" type="number" value="60">
                </div>
                <div>
                  <label>Light Interval (min)</label>
                  <input id="lightIntervalManual" type="number" value="120">
                </div>
                <input type="submit" value="Save Settings" onclick="fetch('/updateLightingSettings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fanTemperatureThreshold: parseFloat(document.getElementById('fanTemperatureThreshold').value), lightOnDuration: parseInt(document.getElementById('lightOnDuration').value), lightIntervalManual: parseInt(document.getElementById('lightIntervalManual').value) }) }).then(res => res.json()).then(data => alert(data.success ? 'Settings saved!' : 'Error: ' + data.error))">
              </div>
            </div>
            <div class="column">
              <div class="card">
                <h3>Pump Settings</h3>
                <div>
                  <label>Start Hour</label>
                  <input id="pumpStartHour" type="number" value="6">
                </div>
                <div>
                  <label>Start Minute</label>
                  <input id="pumpStartMinute" type="number" value="0">
                </div>
                <div>
                  <label>Duration (sec)</label>
                  <input id="pumpDuration" type="number" value="30">
                </div>
                <div>
                  <label>Interval (min)</label>
                  <input id="pumpInterval" type="number" value="60">
                </div>
                <input type="submit" value="Save Settings" onclick="fetch('/updatePumpSettings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pumpStartHour: parseInt(document.getElementById('pumpStartHour').value), pumpStartMinute: parseInt(document.getElementById('pumpStartMinute').value), pumpDuration: parseInt(document.getElementById('pumpDuration').value), pumpInterval: parseInt(document.getElementById('pumpInterval').value) }) }).then(res => res.json()).then(data => alert(data.success ? 'Settings saved!' : 'Error: ' + data.error))">
              </div>
            </div>
            <div class="column">
              <div class="card">
                <h3>Crop Selection</h3>
                <div>
                  <label>Select Crop</label>
                  let cropOptions = '<option value="">Custom Settings</option>';
cropOptions += Object.keys(cropProfiles).map(function(key) {
    return '<option value="' + key + '">' + cropProfiles[key].name + '</option>';
}).join('');

document.getElementById('cropSelect').innerHTML = cropOptions;
                </div>
                <div>
                  <label>Add/Edit Crop Name</label>
                  <input id="newCropName" type="text" placeholder="Enter crop name">
                </div>
                <input type="submit" value="Save Crop" onclick="addOrUpdateCrop()">
              </div>
            </div>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

// Serve the main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
      selectedCrop = null; // Reset selected crop when manually updating settings
      console.log('Pump settings updated:', pumpSettings);
      saveSensorDataHistory();
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
      selectedCrop = null; // Reset selected crop when manually updating settings
      console.log('Lighting settings updated:', lightingSettings);
      saveSensorDataHistory();
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid lighting settings' });
    }
  } catch (error) {
    console.error('Error in /updateLightingSettings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/getCropProfiles', (req, res) => {
  try {
    res.json({ cropProfiles, selectedCrop });
  } catch (error) {
    console.error('Error in /getCropProfiles:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/selectCrop', (req, res) => {
  try {
    const { cropKey } = req.body;
    if (cropKey && cropProfiles[cropKey]) {
      selectedCrop = cropKey;
      const crop = cropProfiles[cropKey];
      lightingSettings = {
        fanTemperatureThreshold: crop.fanTemperatureThreshold,
        lightOnDuration: crop.lightOnDuration,
        lightIntervalManual: crop.lightIntervalManual
      };
      pumpSettings = {
        pumpStartHour: crop.pumpStartHour,
        pumpStartMinute: crop.pumpStartMinute,
        pumpDuration: crop.pumpDuration,
        pumpInterval: crop.pumpInterval
      };
      console.log(`Selected crop: ${crop.name}`);
      saveSensorDataHistory();
      res.json({ success: true, settings: { ...lightingSettings, ...pumpSettings } });
    } else {
      selectedCrop = null;
      res.status(400).json({ error: 'Invalid crop key' });
    }
  } catch (error) {
    console.error('Error in /selectCrop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/addOrUpdateCrop', (req, res) => {
  try {
    const { name, fanTemperatureThreshold, lightOnDuration, lightIntervalManual, pumpStartHour, pumpStartMinute, pumpDuration, pumpInterval } = req.body;
    if (
      typeof name === 'string' && name.trim() &&
      typeof fanTemperatureThreshold === 'number' &&
      typeof lightOnDuration === 'number' && lightOnDuration > 0 &&
      typeof lightIntervalManual === 'number' && lightIntervalManual > 0 &&
      Number.isInteger(pumpStartHour) && pumpStartHour >= 0 && pumpStartHour <= 23 &&
      Number.isInteger(pumpStartMinute) && pumpStartMinute >= 0 && pumpStartMinute <= 59 &&
      Number.isInteger(pumpDuration) && pumpDuration > 0 &&
      Number.isInteger(pumpInterval) && pumpInterval > 0
    ) {
      const cropKey = name.toLowerCase().replace(/\s+/g, '_');
      cropProfiles[cropKey] = {
        name: name.trim(),
        fanTemperatureThreshold,
        lightOnDuration,
        lightIntervalManual,
        pumpStartHour,
        pumpStartMinute,
        pumpDuration,
        pumpInterval
      };
      selectedCrop = cropKey;
      lightingSettings = { fanTemperatureThreshold, lightOnDuration, lightIntervalManual };
      pumpSettings = { pumpStartHour, pumpStartMinute, pumpDuration, pumpInterval };
      console.log(`Crop ${name} added/updated`);
      saveSensorDataHistory();
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid crop settings' });
    }
  } catch (error) {
    console.error('Error in /addOrUpdateCrop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  loadSensorDataHistory();
});
