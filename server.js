const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const port = 80;

// Paths for data storage
const DATA_FILE = 'sensorDataHistory.json';
const CROP_FILE = 'cropProfiles.json';

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files from 'public' directory

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

// Store raw and aggregated sensor data
let sensorDataHistory = {
  raw: [],
  hourlyAverages: [],
  healthyRanges: {
    temperature: { inRange: 0, total: 0 },
    humidity: { inRange: 0, total: 0 },
    soilMoisture: { inRange: 0, total: 0 }
  }
};

// Crop profiles with predefined and custom settings
let cropProfiles = {
  potato: {
    name: 'Potato',
    healthyRanges: { temperature: { min: 15, max: 25 }, humidity: { min: 60, max: 80 }, soilMoisture: { min: 50, max: 70 } },
    pumpSettings: { pumpStartHour: 8, pumpStartMinute: 0, pumpDuration: 30, pumpInterval: 120 },
    lightingSettings: { fanTemperatureThreshold: 24, lightOnDuration: 480, lightIntervalManual: 960 }
  },
  carrot: {
    name: 'Carrot',
    healthyRanges: { temperature: { min: 18, max: 24 }, humidity: { min: 65, max: 85 }, soilMoisture: { min: 60, max: 80 } },
    pumpSettings: { pumpStartHour: 7, pumpStartMinute: 30, pumpDuration: 25, pumpInterval: 90 },
    lightingSettings: { fanTemperatureThreshold: 23, lightOnDuration: 360, lightIntervalManual: 720 }
  },
  tomato: {
    name: 'Tomato',
    healthyRanges: { temperature: { min: 20, max: 28 }, humidity: { min: 50, max: 70 }, soilMoisture: { min: 55, max: 75 } },
    pumpSettings: { pumpStartHour: 9, pumpStartMinute: 0, pumpDuration: 40, pumpInterval: 100 },
    lightingSettings: { fanTemperatureThreshold: 26, lightOnDuration: 600, lightIntervalManual: 840 }
  }
};

let selectedCrop = 'potato'; // Default crop

// Healthy range thresholds (updated based on selected crop)
let HEALTHY_RANGES = cropProfiles[selectedCrop].healthyRanges;

// Load sensor data history from file on startup
async function loadSensorDataHistory() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    sensorDataHistory = JSON.parse(data);
    const oneDayAgo = Date.now() - 86400000;
    sensorDataHistory.raw = sensorDataHistory.raw.filter(entry => entry.timestamp >= oneDayAgo);
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

// Load crop profiles from file on startup
async function loadCropProfiles() {
  try {
    const data = await fs.readFile(CROP_FILE, 'utf8');
    const loaded = JSON.parse(data);
    cropProfiles = { ...cropProfiles, ...loaded.crops };
    selectedCrop = loaded.selectedCrop || 'potato';
    HEALTHY_RANGES = cropProfiles[selectedCrop].healthyRanges;
    pumpSettings = cropProfiles[selectedCrop].pumpSettings;
    lightingSettings = cropProfiles[selectedCrop].lightingSettings;
    console.log(`Loaded crop profiles, selected crop: ${selectedCrop}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing crop profiles file found, using defaults');
    } else {
      console.error('Error loading crop profiles:', error);
    }
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

// Save crop profiles to file
async function saveCropProfiles() {
  try {
    await fs.writeFile(CROP_FILE, JSON.stringify({ crops: cropProfiles, selectedCrop }, null, 2));
    console.log('Crop profiles saved to file');
  } catch (error) {
    console.error('Error saving crop profiles:', error);
  }
}

// Compute hourly averages
function computeHourlyAverages() {
  const oneDayAgo = Date.now() - 86400000;
  const hourlyBuckets = {};

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

// Load data on startup
Promise.all([loadSensorDataHistory(), loadCropProfiles()]).then(() => {
  // Apply default crop settings
  pumpSettings = cropProfiles[selectedCrop].pumpSettings;
  lightingSettings = cropProfiles[selectedCrop].lightingSettings;
  HEALTHY_RANGES = cropProfiles[selectedCrop].healthyRanges;
});

// Serve the login page
app.get('/login', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Greenhouse Control</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://kit.fontawesome.com/a076d05399.js" crossorigin="anonymous"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
</head>
<body class="bg-green-100 min-h-screen">
  <div class="container mx-auto p-4">
    <!-- Header -->
    <header class="bg-green-700 text-white p-4 rounded-lg shadow-lg mb-4 flex justify-between items-center">
      <h1 class="text-2xl font-bold"><i class="fas fa-seedling mr-2"></i>Greenhouse Control</h1>
      <div>
        <button id="modeButton" onclick="toggleMode()" class="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded mr-2">Switch Mode</button>
        <span id="status" class="text-sm">Offline</span>
        <button onclick="logout()" class="bg-red-500 hover:bg-red-600 text-white px-4 py-2 rounded">Logout</button>
      </div>
    </header>

    <!-- Navigation Tabs -->
    <nav class="bg-white p-2 rounded-lg shadow mb-4">
      <ul class="flex space-x-4">
        <li><button onclick="showTab('dashboard')" class="tab-button bg-green-500 text-white px-4 py-2 rounded">Dashboard</button></li>
        <li><button onclick="showTab('relays')" class="tab-button bg-gray-300 text-gray-700 px-4 py-2 rounded">Relays</button></li>
        <li><button onclick="showTab('settings')" class="tab-button bg-gray-300 text-gray-700 px-4 py-2 rounded">Settings</button></li>
      </ul>
    </nav>

    <!-- Dashboard Tab -->
    <div id="dashboard" class="tab-content">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- System Status -->
        <div class="bg-white p-4 rounded-lg shadow">
          <h2 class="text-xl font-bold mb-2"><i class="fas fa-tachometer-alt mr-2"></i>System Status</h2>
          <p>Mode: <span id="mode">—</span></p>
          <p>Lighting: <span id="lighting">—</span></p>
          <p>Ventilation: <span id="ventilation">—</span></p>
          <p>Selected Crop: <span id="selectedCrop">—</span></p>
        </div>

        <!-- Environmental Sensors -->
        <div class="bg-white p-4 rounded-lg shadow">
          <h2 class="text-xl font-bold mb-2"><i class="fas fa-thermometer-half mr-2"></i>Environmental Sensors</h2>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <h3 class="font-semibold"><i class="fas fa-temperature-high mr-1"></i>Temperature</h3>
              <p id="temperature">— °C</p>
              <p id="tempHealth">— % in healthy range</p>
              <button onclick="showTab('tempTrends')" class="text-blue-500 hover:underline">View Trends</button>
            </div>
            <div>
              <h3 class="font-semibold"><i class="fas fa-tint mr-1"></i>Humidity</h3>
              <p id="humidity">— %</p>
              <p id="humidityHealth">— % in healthy range</p>
              <button onclick="showTab('humidityTrends')" class="text-blue-500 hover:underline">View Trends</button>
            </div>
            <div>
              <h3 class="font-semibold"><i class="fas fa-water mr-1"></i>Soil Moisture</h3>
              <p id="soilMoisture">— %</p>
              <p id="soilMoistureHealth">— % in healthy range</p>
              <button onclick="showTab('soilMoistureTrends')" class="text-blue-500 hover:underline">View Trends</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Trends Tabs -->
    <div id="tempTrends" class="tab-content hidden">
      <h2 class="text-xl font-bold mb-2"><i class="fas fa-temperature-high mr-2"></i>Temperature Trends</h2>
      <canvas id="tempChart" class="w-full h-64"></canvas>
      <button onclick="showTab('dashboard')" class="bg-green-500 text-white px-4 py-2 rounded mt-2">Back to Dashboard</button>
    </div>
    <div id="humidityTrends" class="tab-content hidden">
      <h2 class="text-xl font-bold mb-2"><i class="fas fa-tint mr-2"></i>Humidity Trends</h2>
      <canvas id="humidityChart" class="w-full h-64"></canvas>
      <button onclick="showTab('dashboard')" class="bg-green-500 text-white px-4 py-2 rounded mt-2">Back to Dashboard</button>
    </div>
    <div id="soilMoistureTrends" class="tab-content hidden">
      <h2 class="text-xl font-bold mb-2"><i class="fas fa-water mr-2"></i>Soil Moisture Trends</h2>
      <canvas id="soilMoistureChart" class="w-full h-64"></canvas>
      <button onclick="showTab('dashboard')" class="bg-green-500 text-white px-4 py-2 rounded mt-2">Back to Dashboard</button>
    </div>

    <!-- Relays Tab -->
    <div id="relays" class="tab-content hidden">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div class="bg-white p-4 rounded-lg shadow">
          <h2 class="text-xl font-bold mb-2"><i class="fas fa-lightbulb mr-2"></i>Lighting</h2>
          <p>Lighting: <span id="relay1">—</span></p>
          <button onclick="toggleRelay(1)" class="bg-yellow-500 text-white px-4 py-2 rounded mt-2 hover:bg-yellow-600">Toggle Lighting</button>
        </div>
        <div class="bg-white p-4 rounded-lg shadow">
          <h2 class="text-xl font-bold mb-2"><i class="fas fa-fan mr-2"></i>Ventilation</h2>
          <p>Ventilation: <span id="relay2">—</span></p>
          <button onclick="toggleRelay(2)" class="bg-blue-500 text-white px-4 py-2 rounded mt-2 hover:bg-blue-600">Toggle Ventilation</button>
        </div>
      </div>
    </div>

    <!-- Settings Tab -->
    <div id="settings" class="tab-content hidden">
      <!-- Crop Selection -->
      <div class="bg-white p-4 rounded-lg shadow mb-4">
        <h2 class="text-xl font-bold mb-2"><i class="fas fa-seedling mr-2"></i>Crop Selection</h2>
        <select id="cropSelect" onchange="selectCrop()" class="border p-2 rounded w-full mb-2">
          <option value="">Select Crop</option>
        </select>
      </div>

      <!-- Manual Mode Settings -->
      <div class="bg-white p-4 rounded-lg shadow mb-4">
        <h2 class="text-xl font-bold mb-2"><i class="fas fa-cog mr-2"></i>Manual Mode Settings</h2>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label>Temp Threshold (°C)</label>
            <input id="fanTemperatureThreshold" type="number" class="border p-2 w-full rounded" value="25">
          </div>
          <div>
            <label>Light Duration (min)</label>
            <input id="lightOnDuration" type="number" class="border p-2 w-full rounded" value="360">
          </div>
          <div>
            <label>Light Interval (min)</label>
            <input id="lightIntervalManual" type="number" class="border p-2 w-full rounded" value="720">
          </div>
        </div>
        <button onclick="updateLightingSettings()" class="bg-green-500 text-white px-4 py-2 rounded mt-4 hover:bg-green-600">Save Settings</button>
      </div>

      <!-- Pump Settings -->
      <div class="bg-white p-4 rounded-lg shadow mb-4">
        <h2 class="text-xl font-bold mb-2"><i class="fas fa-tint mr-2"></i>Pump Settings</h2>
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div>
            <label>Start Hour</label>
            <input id="pumpStartHour" type="number" min="0" max="23" class="border p-2 w-full rounded" value="8">
          </div>
          <div>
            <label>Start Minute</label>
            <input id="pumpStartMinute" type="number" min="0" max="59" class="border p-2 w-full rounded" value="0">
          </div>
          <div>
            <label>Duration (sec)</label>
            <input id="pumpDuration" type="number" class="border p-2 w-full rounded" value="30">
          </div>
          <div>
            <label>Interval (min)</label>
            <input id="pumpInterval" type="number" class="border p-2 w-full rounded" value="60">
          </div>
        </div>
        <button onclick="updatePumpSettings()" class="bg-green-500 text-white px-4 py-2 rounded mt-4 hover:bg-green-600">Save Settings</button>
      </div>

      <!-- Custom Crop Profile -->
      <div class="bg-white p-4 rounded-lg shadow">
        <h2 class="text-xl font-bold mb-2"><i class="fas fa-plus-circle mr-2"></i>Add/Edit Crop Profile</h2>
        <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label>Crop Name</label>
            <input id="cropName" type="text" class="border p-2 w-full rounded" placeholder="e.g., Custom Crop">
          </div>
          <div>
            <label>Temperature Range (°C)</label>
            <div class="flex space-x-2">
              <input id="tempMin" type="number" class="border p-2 w-1/2 rounded" placeholder="Min">
              <input id="tempMax" type="number" class="border p-2 w-1/2 rounded" placeholder="Max">
            </div>
          </div>
          <div>
            <label>Humidity Range (%)</label>
            <div class="flex space-x-2">
              <input id="humidityMin" type="number" class="border p-2 w-1/2 rounded" placeholder="Min">
              <input id="humidityMax" type="number" class="border p-2 w-1/2 rounded" placeholder="Max">
            </div>
          </div>
          <div>
            <label>Soil Moisture Range (%)</label>
            <div class="flex space-x-2">
              <input id="soilMoistureMin" type="number" class="border p-2 w-1/2 rounded" placeholder="Min">
              <input id="soilMoistureMax" type="number" class="border p-2 w-1/2 rounded" placeholder="Max">
            </div>
          </div>
          <div>
            <label>Pump Start Hour</label>
            <input id="cropPumpStartHour" type="number" min="0" max="23" class="border p-2 w-full rounded">
          </div>
          <div>
            <label>Pump Start Minute</label>
            <input id="cropPumpStartMinute" type="number" min="0" max="59" class="border p-2 w-full rounded">
          </div>
          <div>
            <label>Pump Duration (sec)</label>
            <input id="cropPumpDuration" type="number" class="border p-2 w-full rounded">
          </div>
          <div>
            <label>Pump Interval (min)</label>
            <input id="cropPumpInterval" type="number" class="border p-2 w-full rounded">
          </div>
          <div>
            <label>Fan Temp Threshold (°C)</label>
            <input id="cropFanTemperatureThreshold" type="number" class="border p-2 w-full rounded">
          </div>
          <div>
            <label>Light Duration (min)</label>
            <input id="cropLightOnDuration" type="number" class="border p-2 w-full rounded">
          </div>
          <div>
            <label>Light Interval (min)</label>
            <input id="cropLightIntervalManual" type="number" class="border p-2 w-full rounded">
          </div>
        </div>
        <button onclick="addCropProfile()" class="bg-green-500 text-white px-4 py-2 rounded mt-4 hover:bg-green-600">Save Crop Profile</button>
      </div>
    </div>
  </div>

  <script>
    let mode = 'manual';
    let tempChart, humidityChart, soilMoistureChart;

    async function fetchData() {
      // Fetch sensor status
      const statusRes = await fetch('/getSensorStatus');
      const status = await statusRes.json();
      document.getElementById('status').textContent = status.isOnline ? 'Online' : 'Offline';
      document.getElementById('status').classList.toggle('text-green-500', status.isOnline);
      document.getElementById('status').classList.toggle('text-red-500', !status.isOnline);

      // Fetch relay state
      const relayRes = await fetch('/getRelayState');
      const relayState = await relayRes.json();
      document.getElementById('lighting').textContent = relayState.relayState1 ? 'On' : 'Off';
      document.getElementById('ventilation').textContent = relayState.relayState2 ? 'On' : 'Off';
      document.getElementById('relay1').textContent = relayState.relayState1 ? 'On' : 'Off';
      document.getElementById('relay2').textContent = relayState.relayState2 ? 'On' : 'Off';

      // Fetch sensor data
      const sensorRes = await fetch('/getSensorData');
      const sensorData = await sensorRes.json();
      document.getElementById('temperature').textContent = `${sensorData.temperature.toFixed(1)} °C`;
      document.getElementById('humidity').textContent = `${sensorData.humidity.toFixed(1)} %`;
      document.getElementById('soilMoisture').textContent = `${sensorData.soilMoisture.toFixed(1)} %`;

      // Fetch mode
      const modeRes = await fetch('/getMode');
      const modeData = await modeRes.json();
      mode = modeData.mode;
      document.getElementById('mode').textContent = mode;
      document.getElementById('modeButton').textContent = mode === 'manual' ? 'Switch to Auto' : 'Switch to Manual';

      // Fetch crop profiles
      const cropRes = await fetch('/getCropProfiles');
      const cropData = await cropRes.json();
      const cropSelect = document.getElementById('cropSelect');
      cropSelect.innerHTML = '<option value="">Select Crop</option>';
      Object.keys(cropData.crops).forEach(crop => {
        const option = document.createElement('option');
        option.value = crop;
        option.textContent = cropData.crops[crop].name;
        if (crop === cropData.selectedCrop) option.selected = true;
        cropSelect.appendChild(option);
      });
      document.getElementById('selectedCrop').textContent = cropData.crops[cropData.selectedCrop]?.name || 'None';

      // Fetch sensor trends
      const trendsRes = await fetch('/getSensorTrends');
      const trends = await trendsRes.json();
      document.getElementById('tempHealth').textContent = `${trends.healthyRanges.temperature.toFixed(1)} % in healthy range`;
      document.getElementById('humidityHealth').textContent = `${trends.healthyRanges.humidity.toFixed(1)} % in healthy range`;
      document.getElementById('soilMoistureHealth').textContent = `${trends.healthyRanges.soilMoisture.toFixed(1)} % in healthy range`;

      // Update charts
      updateCharts(trends.hourlyAverages);
    }

    function updateCharts(hourlyAverages) {
      const labels = hourlyAverages.map(data => new Date(data.timestamp).toLocaleTimeString());
      const tempData = hourlyAverages.map(data => data.temperature);
      const humidityData = hourlyAverages.map(data => data.humidity);
      const soilMoistureData = hourlyAverages.map(data => data.soilMoisture);

      if (tempChart) tempChart.destroy();
      if (humidityChart) humidityChart.destroy();
      if (soilMoistureChart) soilMoistureChart.destroy();

      tempChart = new Chart(document.getElementById('tempChart'), {
        type: 'line',
        data: {
          labels,
          datasets: [{ label: 'Temperature (°C)', data: tempData, borderColor: 'red', fill: false }]
        },
        options: { scales: { y: { beginAtZero: true } } }
      });

      humidityChart = new Chart(document.getElementById('humidityChart'), {
        type: 'line',
        data: {
          labels,
          datasets: [{ label: 'Humidity (%)', data: humidityData, borderColor: 'blue', fill: false }]
        },
        options: { scales: { y: { beginAtZero: true } } }
      });

      soilMoistureChart = new Chart(document.getElementById('soilMoistureChart'), {
        type: 'line',
        data: {
          labels,
          datasets: [{ label: 'Soil Moisture (%)', data: soilMoistureData, borderColor: 'green', fill: false }]
        },
        options: { scales: { y: { beginAtZero: true } } }
      });
    }

    async function toggleMode() {
      const newMode = mode === 'manual' ? 'auto' : 'manual';
      const res = await fetch('/setMode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: newMode })
      });
      if (res.ok) {
        mode = newMode;
        document.getElementById('mode').textContent = mode;
        document.getElementById('modeButton').textContent = mode === 'manual' ? 'Switch to Auto' : 'Switch to Manual';
      }
    }

    async function toggleRelay(relayNumber) {
      if (mode === 'manual') {
        const res = await fetch(`/toggleRelay/${relayNumber}`, { method: 'POST' });
        if (res.ok) {
          const relayState = await (await fetch('/getRelayState')).json();
          document.getElementById(`relay${relayNumber}`).textContent = relayState[`relayState${relayNumber}`] ? 'On' : 'Off';
          document.getElementById(relayNumber === 1 ? 'lighting' : 'ventilation').textContent = relayState[`relayState${relayNumber}`] ? 'On' : 'Off';
        }
      } else {
        alert('Cannot toggle relay in auto mode');
      }
    }

    async function updateLightingSettings() {
      const settings = {
        fanTemperatureThreshold: parseFloat(document.getElementById('fanTemperatureThreshold').value),
        lightOnDuration: parseInt(document.getElementById('lightOnDuration').value),
        lightIntervalManual: parseInt(document.getElementById('lightIntervalManual').value)
      };
      const res = await fetch('/updateLightingSettings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        alert('Lighting settings updated');
      } else {
        alert('Error updating lighting settings');
      }
    }

    async function updatePumpSettings() {
      const settings = {
        pumpStartHour: parseInt(document.getElementById('pumpStartHour').value),
        pumpStartMinute: parseInt(document.getElementById('pumpStartMinute').value),
        pumpDuration: parseInt(document.getElementById('pumpDuration').value),
        pumpInterval: parseInt(document.getElementById('pumpInterval').value)
      };
      const res = await fetch('/updatePumpSettings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      });
      if (res.ok) {
        alert('Pump settings updated');
      } else {
        alert('Error updating pump settings');
      }
    }

    async function selectCrop() {
      const crop = document.getElementById('cropSelect').value;
      if (crop) {
        const res = await fetch('/selectCrop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ crop })
        });
        if (res.ok) {
          const cropData = await (await fetch('/getCropProfiles')).json();
          document.getElementById('selectedCrop').textContent = cropData.crops[crop].name;
          // Update settings fields
          const { pumpSettings, lightingSettings } = cropData.crops[crop];
          document.getElementById('pumpStartHour').value = pumpSettings.pumpStartHour;
          document.getElementById('pumpStartMinute').value = pumpSettings.pumpStartMinute;
          document.getElementById('pumpDuration').value = pumpSettings.pumpDuration;
          document.getElementById('pumpInterval').value = pumpSettings.pumpInterval;
          document.getElementById('fanTemperatureThreshold').value = lightingSettings.fanTemperatureThreshold;
          document.getElementById('lightOnDuration').value = lightingSettings.lightOnDuration;
          document.getElementById('lightIntervalManual').value = lightingSettings.lightIntervalManual;
        }
      }
    }

    async function addCropProfile() {
      const profile = {
        name: document.getElementById('cropName').value,
        healthyRanges: {
          temperature: {
            min: parseFloat(document.getElementById('tempMin').value),
            max: parseFloat(document.getElementById('tempMax').value)
          },
          humidity: {
            min: parseFloat(document.getElementById('humidityMin').value),
            max: parseFloat(document.getElementById('humidityMax').value)
          },
          soilMoisture: {
            min: parseFloat(document.getElementById('soilMoistureMin').value),
            max: parseFloat(document.getElementById('soilMoistureMax').value)
          }
        },
        pumpSettings: {
          pumpStartHour: parseInt(document.getElementById('cropPumpStartHour').value),
          pumpStartMinute: parseInt(document.getElementById('cropPumpStartMinute').value),
          pumpDuration: parseInt(document.getElementById('cropPumpDuration').value),
          pumpInterval: parseInt(document.getElementById('cropPumpInterval').value)
        },
        lightingSettings: {
          fanTemperatureThreshold: parseFloat(document.getElementById('cropFanTemperatureThreshold').value),
          lightOnDuration: parseInt(document.getElementById('cropLightOnDuration').value),
          lightIntervalManual: parseInt(document.getElementById('cropLightIntervalManual').value)
        }
      };
      const res = await fetch('/addCropProfile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile)
      });
      if (res.ok) {
        alert('Crop profile saved');
        // Refresh crop dropdown
        const cropRes = await fetch('/getCropProfiles');
        const cropData = await cropRes.json();
        const cropSelect = document.getElementById('cropSelect');
        cropSelect.innerHTML = '<option value="">Select Crop</option>';
        Object.keys(cropData.crops).forEach(crop => {
          const option = document.createElement('option');
          option.value = crop;
          option.textContent = cropData.crops[crop].name;
          if (crop === cropData.selectedCrop) option.selected = true;
          cropSelect.appendChild(option);
        });
        document.getElementById('selectedCrop').textContent = cropData.crops[cropData.selectedCrop]?.name || 'None';
      } else {
        alert('Error saving crop profile');
      }
    }

    function showTab(tabId) {
      document.querySelectorAll('.tab-content').forEach(tab => tab.classList.add('hidden'));
      document.getElementById(tabId).classList.remove('hidden');
      document.querySelectorAll('.tab-button').forEach(btn => btn.classList.replace('bg-green-500', 'bg-gray-300'));
      document.querySelectorAll('.tab-button').forEach(btn => btn.classList.replace('text-white', 'text-gray-700'));
      document.querySelector(`button[onclick="showTab('${tabId}')"]`).classList.replace('bg-gray-300', 'bg-green-500');
      document.querySelector(`button[onclick="showTab('${tabId}')"]`).classList.replace('text-gray-700', 'text-white');
    }

    function logout() {
      window.location.href = '/login';
    }

    // Initialize
    showTab('dashboard');
    fetchData();
    setInterval(fetchData, 5000);
  </script>
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
      const oneDayAgo = Date.now() - 86400000;
      sensorDataHistory.raw = sensorDataHistory.raw.filter(entry => entry.timestamp >= oneDayAgo);
      computeHourlyAverages();
      updateHealthyRanges({ temperature, humidity, soilMoisture });
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
      typeof fanTemperatureThreshold === 'number' && !isNaN(fanTemperatureThreshold) &&
      Number.isInteger(lightOnDuration) && lightOnDuration > 0 &&
      Number.isInteger(lightIntervalManual) && lightIntervalManual > 0
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

// New endpoints for crop profiles
app.get('/getCropProfiles', (req, res) => {
  try {
    res.json({ crops: cropProfiles, selectedCrop });
  } catch (error) {
    console.error('Error in /getCropProfiles:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/selectCrop', (req, res) => {
  try {
    const { crop } = req.body;
    if (cropProfiles[crop]) {
      selectedCrop = crop;
      HEALTHY_RANGES = cropProfiles[crop].healthyRanges;
      pumpSettings = cropProfiles[crop].pumpSettings;
      lightingSettings = cropProfiles[crop].lightingSettings;
      saveCropProfiles();
      console.log(`Crop selected: ${crop}`);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid crop' });
    }
  } catch (error) {
    console.error('Error in /selectCrop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/addCropProfile', (req, res) => {
  try {
    const { name, healthyRanges, pumpSettings, lightingSettings } = req.body;
    if (
      name && typeof name === 'string' && name.trim() && !cropProfiles[name.toLowerCase()] &&
      healthyRanges &&
      typeof healthyRanges.temperature.min === 'number' && !isNaN(healthyRanges.temperature.min) &&
      typeof healthyRanges.temperature.max === 'number' && !isNaN(healthyRanges.temperature.max) &&
      typeof healthyRanges.humidity.min === 'number' && !isNaN(healthyRanges.humidity.min) &&
      typeof healthyRanges.humidity.max === 'number' && !isNaN(healthyRanges.humidity.max) &&
      typeof healthyRanges.soilMoisture.min === 'number' && !isNaN(healthyRanges.soilMoisture.min) &&
      typeof healthyRanges.soilMoisture.max === 'number' && !isNaN(healthyRanges.soilMoisture.max) &&
      pumpSettings &&
      Number.isInteger(pumpSettings.pumpStartHour) && pumpSettings.pumpStartHour >= 0 && pumpSettings.pumpStartHour <= 23 &&
      Number.isInteger(pumpSettings.pumpStartMinute) && pumpSettings.pumpStartMinute >= 0 && pumpSettings.pumpStartMinute <= 59 &&
      Number.isInteger(pumpSettings.pumpDuration) && pumpSettings.pumpDuration > 0 &&
      Number.isInteger(pumpSettings.pumpInterval) && pumpSettings.pumpInterval > 0 &&
      lightingSettings &&
      typeof lightingSettings.fanTemperatureThreshold === 'number' && !isNaN(lightingSettings.fanTemperatureThreshold) &&
      Number.isInteger(lightingSettings.lightOnDuration) && lightingSettings.lightOnDuration > 0 &&
      Number.isInteger(lightingSettings.lightIntervalManual) && lightingSettings.lightIntervalManual > 0
    ) {
      cropProfiles[name.toLowerCase()] = { name: name.trim(), healthyRanges, pumpSettings, lightingSettings };
      saveCropProfiles();
      console.log(`Crop profile added: ${name}`);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid crop profile' });
    }
  } catch (error) {
    console.error('Error in /addCropProfile:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
