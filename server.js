const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const port = 80;

const DATA_FILE = 'sensorDataHistory.json';
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

let relayState = {
  relayState1: false,
  relayState2: false
};

let sensorData = {
  temperature: 0,
  humidity: 0,
  soilMoisture: 0
};

let lastSensorUpdate = 0;

let sensorDataHistory = {
  raw: [],
  hourlyAverages: [],
  healthyRanges: {
    temperature: { inRange: 0, total: 0 },
    humidity: { inRange: 0, total: 0 },
    soilMoisture: { inRange: 0, total: 0 }
  }
};

const HEALTHY_RANGES = {
  temperature: { min: 20, max: 30 },
  humidity: { min: 50, max: 80 },
  soilMoisture: { min: 30, max: 70 }
};

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

const CORRECT_PASSWORD = '12345678';

function isAuthenticated(req, res, next) {
  if (req.headers['x-authenticated'] === 'true') {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

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

async function saveSensorDataHistory() {
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(sensorDataHistory, null, 2));
    console.log('Sensor data history saved to file');
  } catch (error) {
    console.error('Error saving sensor data history:', error);
  }
}

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
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body {
            background: linear-gradient(135deg, #1e3a8a, #10b981);
            min-height: 100vh;
            font-family: 'Inter', sans-serif;
        }
        .section {
            display: none;
            animation: fadeIn 0.5s ease-in-out;
        }
        .section.active {
            display: block;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
        .card {
            transition: transform 0.3s ease, box-shadow 0.3s ease;
        }
        .card:hover {
            transform: translateY(-5px);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.2);
        }
        .btn {
            transition: all 0.3s ease;
        }
        .btn:hover {
            transform: scale(1.05);
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
        }
    </style>
</head>
<body class="text-white">
    <!-- Login Section -->
    <div id="login-section" class="section active min-h-screen flex items-center justify-center">
        <div class="bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl p-8 w-full max-w-md card">
            <h1 class="text-3xl font-bold text-center mb-6 text-emerald-200">Greenhouse Login</h1>
            <div id="login-error" class="hidden text-red-400 text-center mb-4">Incorrect Password</div>
            <input id="password-input" type="password" placeholder="Enter Password" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
            <button onclick="handleLogin()" class="btn w-full py-3 bg-emerald-500 hover:bg-emerald-600 rounded-lg font-semibold">Login</button>
        </div>
    </div>

    <!-- Main Content -->
    <div id="main-content" class="hidden">
        <header class="bg-gray-900 bg-opacity-80 backdrop-blur-md p-4 sticky top-0 z-10">
            <div class="max-w-7xl mx-auto flex justify-between items-center">
                <h1 class="text-2xl font-bold text-emerald-400">Greenhouse Control</h1>
                <div class="flex items-center space-x-4">
                    <button onclick="switchMode()" class="btn px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg">Switch Mode</button>
                    <span id="online-status" class="text-sm font-medium text-gray-300">Offline</span>
                    <button onclick="handleLogout()" class="btn px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg">Logout</button>
                </div>
            </div>
        </header>

        <nav class="bg-gray-800 bg-opacity-80 p-4">
            <div class="max-w-7xl mx-auto flex space-x-4">
                <button onclick="showSection('dashboard-section')" class="nav-btn btn px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded-lg">Dashboard</button>
                <button onclick="showSection('relays-section')" class="nav-btn btn px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded-lg">Relays</button>
                <button onclick="showSection('settings-section')" class="nav-btn btn px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded-lg">Settings</button>
            </div>
        </nav>

        <div id="dashboard-section" class="section active max-w-7xl mx-auto p-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl p-6 card">
                    <h2 class="text-xl font-semibold mb-4 text-emerald-300">System Status</h2>
                    <p>Mode: <span id="mode-display">—</span></p>
                    <p>Lighting: <span id="lighting-status">—</span></p>
                    <p>Ventilation: <span id="ventilation-status">—</span></p>
                </div>
                <div class="bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl p-6 card">
                    <h2 class="text-xl font-semibold mb-4 text-emerald-300">Environmental Sensors</h2>
                    <div class="space-y-4">
                        <div>
                            <p>Temperature: <span id="temperature-display">— °C</span></p>
                            <button onclick="showSection('temperature-trends-section')" class="btn px-3 py-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg">View Trends</button>
                        </div>
                        <div>
                            <p>Humidity: <span id="humidity-display">— %</span></p>
                            <button onclick="showSection('humidity-trends-section')" class="btn px-3 py-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg">View Trends</button>
                        </div>
                        <div>
                            <p>Soil Moisture: <span id="soil-moisture-display">— %</span></p>
                            <button onclick="showSection('soil-moisture-trends-section')" class="btn px-3 py-1 bg-indigo-600 hover:bg-indigo-700 rounded-lg">View Trends</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div id="temperature-trends-section" class="section max-w-7xl mx-auto p-6">
            <div class="bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl p-6 card">
                <h2 class="text-xl font-semibold mb-4 text-emerald-300">Temperature Trends</h2>
                <p>Temperature in healthy range: <span id="temperature-healthy">—%</span></p>
                <canvas id="temperature-chart" class="mt-4"></canvas>
                <button onclick="showSection('dashboard-section')" class="btn mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg">Back to Dashboard</button>
            </div>
        </div>
        <div id="humidity-trends-section" class="section max-w-7xl mx-auto p-6">
            <div class="bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl p-6 card">
                <h2 class="text-xl font-semibold mb-4 text-emerald-300">Humidity Trends</h2>
                <p>Humidity in healthy range: <span id="humidity-healthy">—%</span></p>
                <canvas id="humidity-chart" class="mt-4"></canvas>
                <button onclick="showSection('dashboard-section')" class="btn mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg">Back to Dashboard</button>
            </div>
        </div>
        <div id="soil-moisture-trends-section" class="section max-w-7xl mx-auto p-6">
            <div class="bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl p-6 card">
                <h2 class="text-xl font-semibold mb-4 text-emerald-300">Soil Moisture Trends</h2>
                <p>Soil Moisture in healthy range: <span id="soil-moisture-healthy">—%</span></p>
                <canvas id="soil-moisture-chart" class="mt-4"></canvas>
                <button onclick="showSection('dashboard-section')" class="btn mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg">Back to Dashboard</button>
            </div>
        </div>

        <div id="relays-section" class="section max-w-7xl mx-auto p-6">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div class="bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl p-6 card">
                    <h2 class="text-xl font-semibold mb-4 text-emerald-300">Lighting</h2>
                    <p>Lighting: <span id="lighting-toggle-status">—</span></p>
                    <button onclick="toggleRelay(1)" class="btn mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg">Toggle Lighting</button>
                </div>
                <div class="bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl p-6 card">
                    <h2 class="text-xl font-semibold mb-4 text-emerald-300">Ventilation</h2>
                    <p>Ventilation: <span id="ventilation-toggle-status">—</span></p>
                    <button onclick="toggleRelay(2)" class="btn mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg">Toggle Ventilation</button>
                </div>
            </div>
        </div>

        <div id="settings-section" class="section max-w-7xl mx-auto p-6">
            <div class="space-y-6">
                <div class="bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl p-6 card">
                    <h2 class="text-xl font-semibold mb-4 text-emerald-300">Crop Selection</h2>
                    <select id="crop-select" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
                        <option value="potato">Potato</option>
                        <option value="carrot">Carrot</option>
                        <option value="tomato">Tomato</option>
                        <option value="custom">Custom</option>
                    </select>
                    <button onclick="showCustomCropForm()" class="btn mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg">Add/Edit Custom Crop</button>
                </div>
                <div id="custom-crop-form" class="hidden bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl p-6 card">
                    <h2 class="text-xl font-semibold mb-4 text-emerald-300">Custom Crop</h2>
                    <input type="text" id="custom-crop-name" placeholder="Crop Name" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <input type="number" id="custom-temp-min" placeholder="Min Temperature (°C)" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <input type="number" id="custom-temp-max" placeholder="Max Temperature (°C)" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <input type="number" id="custom-humidity-min" placeholder="Min Humidity (%)" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <input type="number" id="custom-humidity-max" placeholder="Max Humidity (%)" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <input type="number" id="custom-soil-moisture-min" placeholder="Min Soil Moisture (%)" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <input type="number" id="custom-soil-moisture-max" placeholder="Max Soil Moisture (%)" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <div class="flex space-x-4">
                        <button onclick="saveCustomCrop()" class="btn px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded-lg">Save Custom Crop</button>
                        <button onclick="cancelCustomCrop()" class="btn px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg">Cancel</button>
                    </div>
                </div>
                <div class="bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl p-6 card">
                    <h2 class="text-xl font-semibold mb-4 text-emerald-300">Manual Mode Settings</h2>
                    <input type="number" id="temp-threshold" placeholder="Temp Threshold (°C)" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <input type="number" id="light-duration" placeholder="Light Duration (min)" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <input type="number" id="light-interval" placeholder="Light Interval (min)" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <button onclick="saveManualSettings()" class="btn px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded-lg">Save Settings</button>
                </div>
                <div class="bg-white bg-opacity-10 backdrop-blur-lg rounded-2xl p-6 card">
                    <h2 class="text-xl font-semibold mb-4 text-emerald-300">Pump Settings</h2>
                    <input type="number" id="pump-start-hour" placeholder="Start Hour" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <input type="number" id="pump-start-minute" placeholder="Start Minute" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <input type="number" id="pump-duration" placeholder="Duration (sec)" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <input type="number" id="pump-interval" placeholder="Interval (min)" class="w-full p-3 rounded-lg bg-gray-800 bg-opacity-50 text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 mb-4">
                    <button onclick="savePumpSettings()" class="btn px-4 py-2 bg-emerald-500 hover:bg-emerald-600 rounded-lg">Save Settings</button>
                </div>
            </div>
        </div>
    </div>

    <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
    <script>
        let isAuthenticated = false;

        function showSection(sectionId) {
            document.querySelectorAll('.section').forEach(section => {
                section.classList.remove('active');
            });
            document.getElementById(sectionId).classList.add('active');
        }

        async function handleLogin() {
            const password = document.getElementById('password-input').value;
            try {
                const response = await fetch('/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password })
                });
                const result = await response.json();
                if (result.success) {
                    isAuthenticated = true;
                    document.getElementById('login-section').classList.remove('active');
                    document.getElementById('main-content').classList.remove('hidden');
                    updateUI();
                } else {
                    document.getElementById('login-error').classList.remove('hidden');
                }
            } catch (error) {
                console.error('Login error:', error);
                document.getElementById('login-error').textContent = 'Server error';
                document.getElementById('login-error').classList.remove('hidden');
            }
        }

        async function handleLogout() {
            try {
                await fetch('/logout', { method: 'POST' });
                isAuthenticated = false;
                document.getElementById('main-content').classList.add('hidden');
                document.getElementById('login-section').classList.add('active');
                document.getElementById('login-error').classList.add('hidden');
                document.getElementById('password-input').value = '';
            } catch (error) {
                console.error('Logout error:', error);
            }
        }

        async function switchMode() {
            if (!isAuthenticated) return;
            try {
                const response = await fetch('/getMode', { 
                    headers: { 'X-Authenticated': 'true' }
                });
                const { mode } = await response.json();
                const newMode = mode === 'auto' ? 'manual' : 'auto';
                await fetch('/setMode', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Authenticated': 'true' },
                    body: JSON.stringify({ mode: newMode })
                });
                updateUI();
            } catch (error) {
                console.error('Switch mode error:', error);
            }
        }

        async function toggleRelay(relayNumber) {
            if (!isAuthenticated) return;
            try {
                const response = await fetch('/toggleRelay/' + relayNumber, {
                    method: 'POST',
                    headers: { 'X-Authenticated': 'true' }
                });
                if (response.ok) {
                    updateUI();
                }
            } catch (error) {
                console.error('Toggle relay error:', error);
            }
        }

        async function updateUI() {
            if (!isAuthenticated) return;
            try {
                const statusResponse = await fetch('/getSensorStatus', { headers: { 'X-Authenticated': 'true' } });
                const { isOnline } = await statusResponse.json();
                document.getElementById('online-status').textContent = isOnline ? 'Online' : 'Offline';
                document.getElementById('online-status').classList.toggle('text-green-400', isOnline);
                document.getElementById('online-status').classList.toggle('text-red-400', !isOnline);

                const modeResponse = await fetch('/getMode', { headers: { 'X-Authenticated': 'true' } });
                const { mode } = await modeResponse.json();
                document.getElementById('mode-display').textContent = mode;

                const relayResponse = await fetch('/getRelayState', { headers: { 'X-Authenticated': 'true' } });
                const relayState = await relayResponse.json();
                document.getElementById('lighting-status').textContent = relayState.relayState1 ? 'On' : 'Off';
                document.getElementById('ventilation-status').textContent = relayState.relayState2 ? 'On' : 'Off';
                document.getElementById('lighting-toggle-status').textContent = relayState.relayState1 ? 'On' : 'Off';
                document.getElementById('ventilation-toggle-status').textContent = relayState.relayState2 ? 'On' : 'Off';

                const sensorResponse = await fetch('/getSensorData', { headers: { 'X-Authenticated': 'true' } });
                const sensorData = await sensorResponse.json();
                document.getElementById('temperature-display').textContent = sensorData.temperature + ' °C';
document.getElementById('humidity-display').textContent = sensorData.humidity + ' %';
document.getElementById('soil-moisture-display').textContent = sensorData.soilMoisture + ' %';

                const trendsResponse = await fetch('/getSensorTrends', { headers: { 'X-Authenticated': 'true' } });
                const trends = await trendsResponse.json();
                document.getElementById('temperature-healthy').textContent = trends.healthyRanges.temperature.toFixed(1) + '%';
document.getElementById('humidity-healthy').textContent = trends.healthyRanges.humidity.toFixed(1) + '%';
document.getElementById('soil-moisture-healthy').textContent = trends.healthyRanges.soilMoisture.toFixed(1) + '%';

                updateCharts(trends.hourlyAverages);
            } catch (error) {
                console.error('Update UI error:', error);
            }
        }

        function updateCharts(hourlyAverages) {
            const labels = hourlyAverages.map(entry => new Date(entry.timestamp).toLocaleTimeString());
            const temperatureData = hourlyAverages.map(entry => entry.temperature);
            const humidityData = hourlyAverages.map(entry => entry.humidity);
            const soilMoistureData = hourlyAverages.map(entry => entry.soilMoisture);

            new Chart(document.getElementById('temperature-chart'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Temperature (°C)',
                        data: temperatureData,
                        borderColor: '#34d399',
                        backgroundColor: 'rgba(52, 211, 153, 0.2)',
                        fill: true
                    }]
                },
                options: { scales: { y: { beginAtZero: true } } }
            });

            new Chart(document.getElementById('humidity-chart'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Humidity (%)',
                        data: humidityData,
                        borderColor: '#3b82f6',
                        backgroundColor: 'rgba(59, 130, 246, 0.2)',
                        fill: true
                    }]
                },
                options: { scales: { y: { beginAtZero: true } } }
            });

            new Chart(document.getElementById('soil-moisture-chart'), {
                type: 'line',
                data: {
                    labels,
                    datasets: [{
                        label: 'Soil Moisture (%)',
                        data: soilMoistureData,
                        borderColor: '#f59e0b',
                        backgroundColor: 'rgba(245, 158, 11, 0.2)',
                        fill: true
                    }]
                },
                options: { scales: { y: { beginAtZero: true } } }
            });
        }

        function showCustomCropForm() {
            document.getElementById('custom-crop-form').classList.remove('hidden');
        }

        function cancelCustomCrop() {
            document.getElementById('custom-crop-form').classList.add('hidden');
        }

        function saveCustomCrop() {
            document.getElementById('custom-crop-form').classList.add('hidden');
        }

        async function saveManualSettings() {
            if (!isAuthenticated) return;
            try {
                const settings = {
                    fanTemperatureThreshold: parseFloat(document.getElementById('temp-threshold').value),
                    lightOnDuration: parseFloat(document.getElementById('light-duration').value),
                    lightIntervalManual: parseFloat(document.getElementById('light-interval').value)
                };
                await fetch('/updateLightingSettings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Authenticated': 'true' },
                    body: JSON.stringify(settings)
                });
            } catch (error) {
                console.error('Save manual settings error:', error);
            }
        }

        async function savePumpSettings() {
            if (!isAuthenticated) return;
            try {
                const settings = {
                    pumpStartHour: parseInt(document.getElementById('pump-start-hour').value),
                    pumpStartMinute: parseInt(document.getElementById('pump-start-minute').value),
                    pumpDuration: parseInt(document.getElementById('pump-duration').value),
                    pumpInterval: parseInt(document.getElementById('pump-interval').value)
                };
                await fetch('/updatePumpSettings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Authenticated': 'true' },
                    body: JSON.stringify(settings)
                });
            } catch (error) {
                console.error('Save pump settings error:', error);
            }
        }

        setInterval(updateUI, 5000);
    </script>
</body>
</html>
`);
});
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/getSensorStatus', (req, res) => {
  try {
    const now = Date.now();
    const isOnline = now - lastSensorUpdate < 30000;
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

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
  loadSensorDataHistory();
});
