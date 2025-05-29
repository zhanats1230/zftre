const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const port = 80;

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

// Initialize variables that were undefined in the original code
let mode = 'manual';
let pumpSettings = {
  pumpStartHour: 0,
  pumpStartMinute: 0,
  pumpDuration: 0,
  pumpInterval: 0
};
let lightingSettings = {
  fanTemperatureThreshold: 25,
  lightOnDuration: 0,
  lightIntervalManual: 0
};

// Simple password for authentication
const CORRECT_PASSWORD = '12345678';

// Middleware for checking authentication
function isAuthenticated(req, res, next) {
  if (req.body.isAuthenticated) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

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
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Greenhouse Control</title>
    <link href="https://cdn.jsdelivr.net/npm/tailwindcss@2.2.19/dist/tailwind.min.css" rel="stylesheet">
    <script src="https://kit.fontawesome.com/a076d05399.js" crossorigin="anonymous"></script>
    <style>
        body { background-color: #f0f4f8; }
        .tab { display: none; }
        .tab.active { display: block; }
        .bg-greenhouse { background-image: url('https://source.unsplash.com/random/1920x1080/?greenhouse'); background-size: cover; }
        .trend-chart { width: 100%; height: 200px; }
        .crop-icon { width: 24px; height: 24px; margin-right: 8px; }
    </style>
</head>
<body class="bg-greenhouse">
    <div id="loginPage" class="block">
        <div class="max-w-md mx-auto mt-10 bg-white p-6 rounded-lg shadow-lg">
            <h1 class="text-2xl font-bold text-green-800 mb-4">Greenhouse Login</h1>
            <input type="password" id="passwordInput" class="w-full p-2 mb-4 border rounded" placeholder="Enter Password">
            <div id="loginError" class="hidden text-red-600 mb-4">Incorrect Password</div>
            <button onclick="login()" class="w-full bg-green-600 text-white p-2 rounded hover:bg-green-700">Login</button>
        </div>
    </div>

    <div id="mainPage" class="hidden">
        <div class="max-w-4xl mx-auto mt-10">
            <div class="flex justify-between items-center mb-6">
                <h1 class="text-3xl font-bold text-green-800">Greenhouse Control</h1>
                <div>
                    <button onclick="toggleMode()" id="modeButton" class="bg-blue-600 text-white px-4 py-2 rounded mr-2">
                        Switch Mode
                    </button>
                    <span id="statusIndicator" class="inline-block px-4 py-2 bg-red-600 text-white rounded">Offline</span>
                    <button onclick="logout()" class="bg-gray-600 text-white px-4 py-2 rounded ml-2">Logout</button>
                </div>
            </div>

            <div class="flex mb-4">
                <button onclick="showTab('dashboard')" class="flex-1 bg-green-600 text-white p-2 rounded-l hover:bg-green-700">Dashboard</button>
                <button onclick="showTab('relays')" class="flex-1 bg-green-600 text-white p-2 hover:bg-green-700">Relays</button>
                <button onclick="showTab('settings')" class="flex-1 bg-green-600 text-white p-2 rounded-r hover:bg-green-700">Settings</button>
            </div>

            <div id="dashboard" class="tab active">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="bg-white p-6 rounded-lg shadow-lg">
                        <h2 class="text-xl font-semibold mb-4"><i class="fas fa-info-circle"></i> System Status</h2>
                        <p>Mode: <span id="mode">—</span></p>
                        <p>Lighting: <span id="lightingStatus">—</span></p>
                        <p>Ventilation: <span id="ventilationStatus">—</span></p>
                    </div>

                    <div class="bg-white p-6 rounded-lg shadow-lg">
                        <h2 class="text-xl font-semibold mb-4"><i class="fas fa-leaf"></i> Environmental Sensors</h2>
                        <div class="grid grid-cols-1 gap-4">
                            <div>
                                <h3 class="font-semibold"><i class="fas fa-thermometer-half crop-icon"></i>Temperature</h3>
                                <p id="temperature">— °C</p>
                                <button onclick="showTrend('temperatureTrends')" class="text-blue-600 hover:underline">View Trends</button>
                            </div>
                            <div>
                                <h3 class="font-semibold"><i class="fas fa-tint crop-icon"></i>Humidity</h3>
                                <p id="humidity">— %</p>
                                <button onclick="showTrend('humidityTrends')" class="text-blue-600 hover:underline">View Trends</button>
                            </div>
                            <div>
                                <h3 class="font-semibold"><i class="fas fa-seedling crop-icon"></i>Soil Moisture</h3>
                                <p id="soilMoisture">— %</p>
                                <button onclick="showTrend('soilMoistureTrends')" class="text-blue-600 hover:underline">View Trends</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div id="temperatureTrends" class="tab">
                <div class="bg-white p-6 rounded-lg shadow-lg">
                    <h2 class="text-xl font-semibold mb-4"><i class="fas fa-thermometer-half"></i> Temperature Trends</h2>
                    <canvas id="temperatureChart" class="trend-chart"></canvas>
                    <p>Temperature in healthy range: <span id="temperatureHealthy">—%</span></p>
                    <button onclick="showTab('dashboard')" class="mt-4 bg-green-600 text-white p-2 rounded">Back to Dashboard</button>
                </div>
            </div>

            <div id="humidityTrends" class="tab">
                <div class="bg-white p-6 rounded-lg shadow-lg">
                    <h2 class="text-xl font-semibold mb-4"><i class="fas fa-tint"></i> Humidity Trends</h2>
                    <canvas id="humidityChart" class="trend-chart"></canvas>
                    <p>Humidity in healthy range: <span id="humidityHealthy">—%</span></p>
                    <button onclick="showTab('dashboard')" class="mt-4 bg-green-600 text-white p-2 rounded">Back to Dashboard</button>
                </div>
            </div>

            <div id="soilMoistureTrends" class="tab">
                <div class="bg-white p-6 rounded-lg shadow-lg">
                    <h2 class="text-xl font-semibold mb-4"><i class="fas fa-seedling"></i> Soil Moisture Trends</h2>
                    <canvas id="soilMoistureChart" class="trend-chart"></canvas>
                    <p>Soil Moisture in healthy range: <span id="soilMoistureHealthy">—%</span></p>
                    <button onclick="showTab('dashboard')" class="mt-4 bg-green-600 text-white p-2 rounded">Back to Dashboard</button>
                </div>
            </div>

            <div id="relays" class="tab">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="bg-white p-6 rounded-lg shadow-lg">
                        <h2 class="text-xl font-semibold mb-4"><i class="fas fa-lightbulb"></i> Lighting</h2>
                        <p>Lighting: <span id="relay1Status">—</span></p>
                        <button onclick="toggleRelay(1)" class="mt-4 bg-green-600 text-white p-2 rounded">Toggle Lighting</button>
                    </div>
                    <div class="bg-white p-6 rounded-lg shadow-lg">
                        <h2 class="text-xl font-semibold mb-4"><i class="fas fa-fan"></i> Ventilation</h2>
                        <p>Ventilation: <span id="relay2Status">—</span></p>
                        <button onclick="toggleRelay(2)" class="mt-4 bg-green-600 text-white p-2 rounded">Toggle Ventilation</button>
                    </div>
                </div>
            </div>

            <div id="settings" class="tab">
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div class="bg-white p-6 rounded-lg shadow-lg">
                        <h2 class="text-xl font-semibold mb-4"><i class="fas fa-seedling"></i> Crop Selection</h2>
                        <select id="cropSelect" onchange="loadCropSettings()" class="w-full p-2 mb-4 border rounded">
                            <option value="">Select Crop</option>
                            <option value="potato">Potato</option>
                            <option value="carrot">Carrot</option>
                            <option value="tomato">Tomato</option>
                            <option value="custom">Custom</option>
                        </select>
                        <button onclick="showCustomCropForm()" class="bg-blue-600 text-white p-2 rounded">Add/Edit Custom Crop</button>
                    </div>

                    <div id="customCropForm" class="bg-white p-6 rounded-lg shadow-lg hidden">
                        <h2 class="text-xl font-semibold mb-4"><i class="fas fa-plus"></i> Custom Crop</h2>
                        <input id="customCropName" type="text" class="w-full p-2 mb-4 border rounded" placeholder="Crop Name">
                        <input id="customTempThreshold" type="number" class="w-full p-2 mb-4 border rounded" placeholder="Fan Temperature Threshold (°C)">
                        <input id="customLightDuration" type="number" class="w-full p-2 mb-4 border rounded" placeholder="Light Duration (min)">
                        <input id="customLightInterval" type="number" class="w-full p-2 mb-4 border rounded" placeholder="Light Interval (min)">
                        <input id="customPumpStartHour" type="number" class="w-full p-2 mb-4 border rounded" placeholder="Pump Start Hour">
                        <input id="customPumpStartMinute" type="number" class="w-full p-2 mb-4 border rounded" placeholder="Pump Start Minute">
                        <input id="customPumpDuration" type="number" class="w-full p-2 mb-4 border rounded" placeholder="Pump Duration (sec)">
                        <input id="customPumpInterval" type="number" class="w-full p-2 mb-4 border rounded" placeholder="Pump Interval (min)">
                        <button onclick="saveCustomCrop()" class="bg-green-600 text-white p-2 rounded">Save Custom Crop</button>
                        <button onclick="hideCustomCropForm()" class="bg-gray-600 text-white p-2 rounded ml-2">Cancel</button>
                    </div>

                    <div class="bg-white p-6 rounded-lg shadow-lg">
                        <h2 class="text-xl font-semibold mb-4"><i class="fas fa-cog"></i> Manual Mode Settings</h2>
                        <div class="mb-4">
                            <label>Temp Threshold (°C)</label>
                            <input id="fanTemperatureThreshold" type="number" class="w-full p-2 border rounded">
                        </div>
                        <div class="mb-4">
                            <label>Light Duration (min)</label>
                            <input id="lightOnDuration" type="number" class="w-full p-2 border rounded">
                        </div>
                        <div class="mb-4">
                            <label>Light Interval (min)</label>
                            <input id="lightIntervalManual" type="number" class="w-full p-2 border rounded">
                        </div>
                        <button onclick="saveLightingSettings()" class="bg-green-600 text-white p-2 rounded">Save Settings</button>
                    </div>

                    <div class="bg-white p-6 rounded-lg shadow-lg">
                        <h2 class="text-xl font-semibold mb-4"><i class="fas fa-tint"></i> Pump Settings</h2>
                        <div class="mb-4">
                            <label>Start Hour</label>
                            <input id="pumpStartHour" type="number" class="w-full p-2 border rounded">
                        </div>
                        <div class="mb-4">
                            <label>Start Minute</label>
                            <input id="pumpStartMinute" type="number" class="w-full p-2 border rounded">
                        </div>
                        <div class="mb-4">
                            <label>Duration (sec)</label>
                            <input id="pumpDuration" type="number" class="w-full p-2 border rounded">
                        </div>
                        <div class="mb-4">
                            <label>Interval (min)</label>
                            <input id="pumpInterval" type="number" class="w-full p-2 border rounded">
                        </div>
                        <button onclick="savePumpSettings()" class="bg-green-600 text-white p-2 rounded">Save Settings</button>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/chart.js@3.7.1/dist/chart.min.js"></script>
    <script>
        let mode = "manual";
        let charts = {};
        let isAuthenticated = false;

        // Predefined crop settings
        const cropSettings = {
            potato: {
                fanTemperatureThreshold: 25,
                lightOnDuration: 720,
                lightIntervalManual: 360,
                pumpStartHour: 6,
                pumpStartMinute: 0,
                pumpDuration: 30,
                pumpInterval: 120
            },
            carrot: {
                fanTemperatureThreshold: 22,
                lightOnDuration: 600,
                lightIntervalManual: 300,
                pumpStartHour: 7,
                pumpStartMinute: 0,
                pumpDuration: 20,
                pumpInterval: 90
            },
            tomato: {
                fanTemperatureThreshold: 27,
                lightOnDuration: 840,
                lightIntervalManual: 420,
                pumpStartHour: 8,
                pumpStartMinute: 0,
                pumpDuration: 40,
                pumpInterval: 150
            }
        };

        // Load custom crops from localStorage
        let customCrops = JSON.parse(localStorage.getItem('customCrops')) || {};

        async function login() {
            const passwordInput = document.getElementById('passwordInput').value;
            const loginError = document.getElementById('loginError');

            try {
                const response = await fetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'password=' + encodeURIComponent(passwordInput)
});

                const data = await response.json();
                if (response.ok && data.success) {
                    isAuthenticated = true;
                    document.getElementById('loginPage').classList.add('hidden');
                    document.getElementById('mainPage').classList.remove('hidden');
                    updateUI();
                } else {
                    loginError.classList.remove('hidden');
                    loginError.textContent = data.error || 'Incorrect Password';
                }
            } catch (error) {
                console.error('Login error:', error);
                loginError.classList.remove('hidden');
                loginError.textContent = 'Server error, please try again later';
            }
        }

        async function logout() {
            try {
                const response = await fetch('/logout', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' }
                });
                if (response.ok) {
                    isAuthenticated = false;
                    document.getElementById('mainPage').classList.add('hidden');
                    document.getElementById('loginPage').classList.remove('hidden');
                    document.getElementById('passwordInput').value = '';
                    document.getElementById('loginError').classList.add('hidden');
                }
            } catch (error) {
                console.error('Logout error:', error);
            }
        }

        async function updateUI() {
            if (!isAuthenticated) return;

            try {
                const [sensorRes, relayRes, modeRes, trendsRes, statusRes, lightingRes, pumpRes] = await Promise.all([
                    fetch('/getSensorData', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ isAuthenticated: true })
                    }),
                    fetch('/getRelayState', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ isAuthenticated: true })
                    }),
                    fetch('/getMode', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ isAuthenticated: true })
                    }),
                    fetch('/getSensorTrends', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ isAuthenticated: true })
                    }),
                    fetch('/getSensorStatus'),
                    fetch('/getLightingSettings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ isAuthenticated: true })
                    }),
                    fetch('/getPumpSettings', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ isAuthenticated: true })
                    })
                ]);

                if (sensorRes.ok && relayRes.ok && modeRes.ok && trendsRes.ok && statusRes.ok && lightingRes.ok && pumpRes.ok) {
                    const sensorData = await sensorRes.json();
                    const relayState = await relayRes.json();
                    const modeData = await modeRes.json();
                    const trendsData = await trendsRes.json();
                    const statusData = await statusRes.json();
                    const lightingData = await lightingRes.json();
                    const pumpData = await pumpRes.json();

                    document.getElementById('temperature').textContent = sensorData.temperature + ' °C';
                    document.getElementById('humidity').textContent = sensorData.humidity + ' %';
                    document.getElementById('soilMoisture').textContent = sensorData.soilMoisture + ' %';
                    document.getElementById('relay1Status').textContent = relayState.relayState1 ? 'On' : 'Off';
                    document.getElementById('relay2Status').textContent = relayState.relayState2 ? 'On' : 'Off';
                    document.getElementById('lightingStatus').textContent = relayState.relayState1 ? 'On' : 'Off';
                    document.getElementById('ventilationStatus').textContent = relayState.relayState2 ? 'On' : 'Off';
                    document.getElementById('mode').textContent = modeData.mode.charAt(0).toUpperCase() + modeData.mode.slice(1);
                    document.getElementById('modeButton').textContent = 'Switch to ' + (modeData.mode === 'auto' ? 'Manual' : 'Auto') + ' Mode';
                    document.getElementById('statusIndicator').textContent = statusData.isOnline ? 'Online' : 'Offline';
                    document.getElementById('statusIndicator').className = 'inline-block px-4 py-2 ' + (statusData.isOnline ? 'bg-green-600' : 'bg-red-600') + ' text-white rounded';
                    document.getElementById('temperatureHealthy').textContent = trendsData.healthyRanges.temperature.toFixed(1) + '%';
                    document.getElementById('humidityHealthy').textContent = trendsData.healthyRanges.humidity.toFixed(1) + '%';
                    document.getElementById('soilMoistureHealthy').textContent = trendsData.healthyRanges.soilMoisture.toFixed(1) + '%';
                    document.getElementById('fanTemperatureThreshold').value = lightingData.fanTemperatureThreshold;
                    document.getElementById('lightOnDuration').value = lightingData.lightOnDuration;
                    document.getElementById('lightIntervalManual').value = lightingData.lightIntervalManual;
                    document.getElementById('pumpStartHour').value = pumpData.pumpStartHour;
                    document.getElementById('pumpStartMinute').value = pumpData.pumpStartMinute;
                    document.getElementById('pumpDuration').value = pumpData.pumpDuration;
                    document.getElementById('pumpInterval').value = pumpData.pumpInterval;
                } else {
                    console.error('Error fetching data:', {
                        sensor: sensorRes.status,
                        relay: relayRes.status,
                        mode: modeRes.status,
                        trends: trendsRes.status,
                        status: statusRes.status,
                        lighting: lightingRes.status,
                        pump: pumpRes.status
                    });
                }
            } catch (error) {
                console.error('Error updating UI:', error);
            }
            updateCropSelect();
        }

        function showTab(tabId) {
            document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
            document.getElementById(tabId).classList.add('active');
        }

        function showTrend(trendId) {
            showTab(trendId);
            updateCharts();
        }

        async function toggleMode() {
            if (!isAuthenticated) return;
            try {
                const newMode = mode === 'auto' ? 'manual' : 'auto';
                const response = await fetch('/setMode', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ mode: newMode, isAuthenticated: true })
                });
                if (response.ok) {
                    mode = newMode;
                    updateUI();
                }
            } catch (error) {
                console.error('Error toggling mode:', error);
            }
        }

        async function toggleRelay(relayNumber) {
            if (!isAuthenticated) return;
            try {
                const response = await fetch('/toggleRelay/' + relayNumber, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isAuthenticated: true })
                });
                if (response.ok) {
                    updateUI();
                }
            } catch (error) {
                console.error('Error toggling relay:', error);
            }
        }

        async function saveLightingSettings() {
            if (!isAuthenticated) return;
            try {
                const settings = {
                    fanTemperatureThreshold: parseFloat(document.getElementById('fanTemperatureThreshold').value),
                    lightOnDuration: parseInt(document.getElementById('lightOnDuration').value),
                    lightIntervalManual: parseInt(document.getElementById('lightIntervalManual').value),
                    isAuthenticated: true
                };
                const response = await fetch('/updateLightingSettings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings)
                });
                if (response.ok) {
                    updateUI();
                }
            } catch (error) {
                console.error('Error saving lighting settings:', error);
            }
        }

        async function savePumpSettings() {
            if (!isAuthenticated) return;
            try {
                const settings = {
                    pumpStartHour: parseInt(document.getElementById('pumpStartHour').value),
                    pumpStartMinute: parseInt(document.getElementById('pumpStartMinute').value),
                    pumpDuration: parseInt(document.getElementById('pumpDuration').value),
                    pumpInterval: parseInt(document.getElementById('pumpInterval').value),
                    isAuthenticated: true
                };
                const response = await fetch('/updatePumpSettings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(settings)
                });
                if (response.ok) {
                    updateUI();
                }
            } catch (error) {
                console.error('Error saving pump settings:', error);
            }
        }

        function showCustomCropForm() {
            document.getElementById('customCropForm').classList.remove('hidden');
        }

        function hideCustomCropForm() {
            document.getElementById('customCropForm').classList.add('hidden');
            document.getElementById('customCropName').value = '';
            document.getElementById('customTempThreshold').value = '';
            document.getElementById('customLightDuration').value = '';
            document.getElementById('customLightInterval').value = '';
            document.getElementById('customPumpStartHour').value = '';
            document.getElementById('customPumpStartMinute').value = '';
            document.getElementById('customPumpDuration').value = '';
            document.getElementById('customPumpInterval').value = '';
        }

        function saveCustomCrop() {
            const cropName = document.getElementById('customCropName').value.toLowerCase();
            if (cropName && !cropSettings[cropName]) {
                customCrops[cropName] = {
                    fanTemperatureThreshold: parseFloat(document.getElementById('customTempThreshold').value),
                    lightOnDuration: parseInt(document.getElementById('customLightDuration').value),
                    lightIntervalManual: parseInt(document.getElementById('customLightInterval').value),
                    pumpStartHour: parseInt(document.getElementById('customPumpStartHour').value),
                    pumpStartMinute: parseInt(document.getElementById('customPumpStartMinute').value),
                    pumpDuration: parseInt(document.getElementById('customPumpDuration').value),
                    pumpInterval: parseInt(document.getElementById('customPumpInterval').value)
                };
                localStorage.setItem('customCrops', JSON.stringify(customCrops));
                updateCropSelect();
                hideCustomCropForm();
                document.getElementById('cropSelect').value = cropName;
                loadCropSettings();
            }
        }

        function updateCropSelect() {
            const select = document.getElementById('cropSelect');
            select.innerHTML = '<option value="">Select Crop</option>' +
                              '<option value="potato">Potato</option>' +
                              '<option value="carrot">Carrot</option>' +
                              '<option value="tomato">Tomato</option>';
            Object.keys(customCrops).forEach(crop => {
                const capitalizedCrop = crop.charAt(0).toUpperCase() + crop.slice(1);
                select.innerHTML += '<option value="' + crop + '">' + capitalizedCrop + '</option>';
            });
            select.innerHTML += '<option value="custom">Custom</option>';
        }

        function loadCropSettings() {
            const crop = document.getElementById('cropSelect').value;
            if (crop && crop !== 'custom') {
                const settings = cropSettings[crop] || customCrops[crop];
                if (settings) {
                    document.getElementById('fanTemperatureThreshold').value = settings.fanTemperatureThreshold;
                    document.getElementById('lightOnDuration').value = settings.lightOnDuration;
                    document.getElementById('lightIntervalManual').value = settings.lightIntervalManual;
                    document.getElementById('pumpStartHour').value = settings.pumpStartHour;
                    document.getElementById('pumpStartMinute').value = settings.pumpStartMinute;
                    document.getElementById('pumpDuration').value = settings.pumpDuration;
                    document.getElementById('pumpInterval').value = settings.pumpInterval;
                    saveLightingSettings();
                    savePumpSettings();
                }
            }
        }

        async function updateCharts() {
            if (!isAuthenticated) return;
            try {
                const response = await fetch('/getSensorTrends', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isAuthenticated: true })
                });
                if (response.ok) {
                    const data = await response.json();
                    const labels = data.hourlyAverages.map(entry => new Date(entry.timestamp).toLocaleTimeString());
                    if (!charts.temperature) {
                        charts.temperature = new Chart(document.getElementById('temperatureChart'), {
                            type: 'line',
                            data: { labels: [], datasets: [{ label: 'Temperature (°C)', data: [], borderColor: 'red', fill: false }] },
                            options: { scales: { y: { beginAtZero: false } } }
                        });
                        charts.humidity = new Chart(document.getElementById('humidityChart'), {
                            type: 'line',
                            data: { labels: [], datasets: [{ label: 'Humidity (%)', data: [], borderColor: 'blue', fill: false }] },
                            options: { scales: { y: { beginAtZero: false } } }
                        });
                        charts.soilMoisture = new Chart(document.getElementById('soilMoistureChart'), {
                            type: 'line',
                            data: { labels: [], datasets: [{ label: 'Soil Moisture (%)', data: [], borderColor: 'green', fill: false }] },
                            options: { scales: { y: { beginAtZero: false } } }
                        });
                    }
                    charts.temperature.data.labels = labels;
                    charts.temperature.data.datasets[0].data = data.hourlyAverages.map(entry => entry.temperature);
                    charts.temperature.update();
                    charts.humidity.data.labels = labels;
                    charts.humidity.data.datasets[0].data = data.hourlyAverages.map(entry => entry.humidity);
                    charts.humidity.update();
                    charts.soilMoisture.data.labels = labels;
                    charts.soilMoisture.data.datasets[0].data = data.hourlyAverages.map(entry => entry.soilMoisture);
                    charts.soilMoisture.update();
                    document.getElementById('temperatureHealthy').textContent = data.healthyRanges.temperature.toFixed(1) + '%';
                    document.getElementById('humidityHealthy').textContent = data.healthyRanges.humidity.toFixed(1) + '%';
                    document.getElementById('soilMoistureHealthy').textContent = data.healthyRanges.soilMoisture.toFixed(1) + '%';
                }
            } catch (error) {
                console.error('Error updating charts:', error);
            }
        }

        setInterval(updateUI, 5000);
        updateUI();
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

app.post('/login', (req, res) => {
  try {
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    if (password === CORRECT_PASSWORD) {
      res.json({ success: true, isAuthenticated: true });
      console.log('Login successful');
    } else {
      console.log('Login failed: Incorrect password');
      res.status(401).json({ error: 'Incorrect Password' });
    }
  } catch (error) {
    console.error('Error in /login:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/logout', (req, res) => {
  try {
    res.json({ success: true });
  } catch (error) {
    console.error('Error in /logout:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/getRelayState', isAuthenticated, (req, res) => {
  try {
    res.json(relayState);
  } catch (error) {
    console.error('Error in /getRelayState:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/getSensorData', isAuthenticated, (req, res) => {
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

app.get('/getSensorTrends', isAuthenticated, (req, res) => {
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

app.get('/getMode', isAuthenticated, (req, res) => {
  try {
    res.json({ mode });
  } catch (error) {
    console.error('Error in /getMode:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/setMode', isAuthenticated, (req, res) => {
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

app.post('/toggleRelay/:relayNumber', isAuthenticated, (req, res) => {
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

app.get('/getPumpSettings', isAuthenticated, (req, res) => {
  try {
    res.json(pumpSettings);
  } catch (error) {
    console.error('Error in /getPumpSettings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/updatePumpSettings', isAuthenticated, (req, res) => {
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

app.get('/getLightingSettings', isAuthenticated, (req, res) => {
  try {
    res.json(lightingSettings);
  } catch (error) {
    console.error('Error in /getLightingSettings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/updateLightingSettings', isAuthenticated, (req, res) => {
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

// Start the server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  loadSensorDataHistory(); // Load sensor data history on startup
});
