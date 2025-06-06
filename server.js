const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const port = process.env.PORT || 80;

const { Octokit } = require("@octokit/rest");
const octokit = new Octokit({ 
  auth: process.env.GITHUB_TOKEN 
});
const REPO_OWNER = "zhanats1230";
const REPO_NAME = "zftre";  // Just the repository name

// Paths to store data
const DATA_FILE = 'sensorDataHistory.json';
const CROP_SETTINGS_FILE = 'cropSettings.json';
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

// Загрузка истории данных сенсоров
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

// Сохранение истории данных сенсоров
async function saveSensorDataHistory() {
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(sensorDataHistory, null, 2));
    console.log('Sensor data history saved to file');
  } catch (error) {
    console.error('Error saving sensor data history:', error);
  }
}

async function loadCropSettings() {
  try {
    const data = await fs.readFile(CROP_SETTINGS_FILE, 'utf8');
    const settings = JSON.parse(data);
    cropSettings = settings.crops || cropSettings;
    currentCrop = settings.currentCrop || currentCrop;
    console.log(`Crop settings loaded. Current crop: ${currentCrop}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No crop settings file found, using defaults');
    } else {
      console.error('Error loading crop settings:', error);
    }
  }
}

// Эндпоинт для получения настроек культур
app.get('/getCropSettings', (req, res) => {
  try {
    res.json({
      currentCropKey: currentCrop,
      availableCrops: cropSettings
    });
  } catch (error) {
    console.error('Error in /getCropSettings:', error);
    res.status(500).json({ 
      error: 'Server error',
      currentCropKey: 'potato',
      availableCrops: cropSettings
    });
  }
});


// Сохранение настроек культур
async function saveCropSettings() {
  try {
    const dataToSave = {
      crops: cropSettings,
      currentCrop: currentCrop
    };
    const content = JSON.stringify(dataToSave, null, 2);
    
    // Сохраняем локально
    await fs.writeFile(CROP_SETTINGS_FILE, content);
    
    // Сохраняем в GitHub
    if (process.env.GITHUB_TOKEN) {
      await octokit.repos.createOrUpdateFileContents({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: CROP_SETTINGS_FILE,
        message: "Update crop settings",
        content: Buffer.from(content).toString('base64'),
        sha: await getFileSha(CROP_SETTINGS_FILE)
      });
      console.log('Crop settings saved to file and GitHub');
    }
  } catch (error) {
    console.error('Error saving crop settings:', error);
  }
}

async function getFileSha(filePath) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      path: filePath
    });
    return data.sha;
  } catch (error) {
    return null; // Файл не существует
  }
}

// Вычисление средних значений
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

// Обновление здоровых диапазонов
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

let mode = 'auto';

let lightingSettings = {
  fanTemperatureThreshold: 31.0,
  lightOnDuration: 60000,
  lightIntervalManual: 60000
};

let pumpSettings = {
  pumpStartHour: 18,
  pumpStartMinute: 0,
  pumpDuration: 10,
  pumpInterval: 240
};

// Настройки культур по умолчанию
// Начальные настройки культур
let cropSettings = {};
let currentCrop = 'potato';



// Сохранение настроек культур


// Загрузка данных при запуске
loadSensorDataHistory();
loadCropSettings(); // Добавлена загрузка настроек культур

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Greenhouse Control</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"></script>
  <style>
    body {
      background: linear-gradient(to bottom, #f9fafb, #e5e7eb);
      min-height: 100vh;
      font-family: 'Inter', sans-serif;
    }
    .card {
      transition: transform 0.3s, box-shadow 0.3s;
      background: linear-gradient(145deg, #ffffff, #f7f7f9);
      border: 1px solid #e5e7eb;
      border-radius: 16px;
      position: relative;
      overflow: hidden;
    }
    .card:hover {
      transform: translateY(-4px);
      box-shadow: 0 12px 24px rgba(0, 0, 0, 0.1);
    }
    .btn {
      transition: background-color 0.3s, transform 0.2s, box-shadow 0.2s;
      background: linear-gradient(to right, #14b8a6, #2dd4bf);
    }
    .btn:hover {
      transform: scale(1.05);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      animation: pulse 1.5s infinite;
    }
    .tab {
      transition: background-color 0.3s, color 0.3s;
    }
    .tab.active {
      background-color: #14b8a6;
      color: white;
      border-radius: 8px;
    }
    .progress-bar {
      height: 8px;
      border-radius: 4px;
      background: #e5e7eb;
      overflow: hidden;
    }
    .progress-bar-fill {
      height: 100%;
      transition: width 0.5s ease-in-out;
      background: #14b8a6;
    }
    .status-badge {
      display: inline-flex;
      align-items: center;
      padding: 0.5rem 1rem;
      border-radius: 9999px;
      font-weight: 500;
      transition: background-color 0.3s;
    }
    .modal {
      transition: opacity 0.3s ease, transform 0.3s ease;
      transform: translateY(20px);
      opacity: 0;
    }
    .modal.show {
      transform: translateY(0);
      opacity: 1;
    }
    .modal-overlay {
      transition: opacity 0.3s ease;
    }
    .section-header {
      background: linear-gradient(to right, #14b8a6, #2dd4bf);
      color: white;
      padding: 1.25rem;
      border-radius: 12px 12px 0 0;
      margin: -1.5rem -1.5rem 1.5rem;
      box-shadow: 0 4px 12px rgba(20, 184, 166, 0.3);
      display: flex;
      align-items: center;
      font-size: 1.5rem;
      font-weight: 700;
    }
    .section-header i {
      margin-right: 0.75rem;
      font-size: 1.75rem;
    }
    .input-card {
      position: relative;
      padding: 1rem;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(8px);
      border: 1px solid rgba(20, 184, 166, 0.2);
      transition: all 0.3s ease;
      animation: slideIn 0.5s ease-out;
    }
    .input-card:nth-child(odd) {
      background: rgba(240, 253, 250, 0.9);
    }
    .input-card:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 12px rgba(20, 184, 166, 0.15);
    }
    .input-card input {
      width: 100%;
      padding: 0.75rem 0.75rem 0.75rem 3rem;
      border: none;
      border-bottom: 2px solid transparent;
      background: transparent;
      font-size: 1.1rem;
      color: #1f2937;
      outline: none;
      transition: border-bottom 0.3s ease;
    }
    .input-card input:focus {
      border-bottom: 2px solid #14b8a6;
      animation: borderGlow 0.5s ease;
    }
    .icon-circle {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      width: 2rem;
      height: 2rem;
      background: linear-gradient(to bottom, #14b8a6, #2dd4bf);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-size: 1.1rem;
      transition: transform 0.3s ease;
    }
    .input-card:hover .icon-circle {
      transform: translateY(-50%) scale(1.1);
    }
    .input-label {
      display: block;
      font-weight: 600;
      font-size: 0.9rem;
      text-transform: uppercase;
      background: linear-gradient(to right, #14b8a6, #2dd4bf);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
      transition: transform 0.3s ease;
    }
    .input-card:hover .input-label {
      transform: translateX(4px);
    }
    .wave-divider {
      height: 2px;
      background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1440 20"><path fill="none" stroke="%2314b8a6" stroke-width="2" d="M0,10 C360,20 1080,0 1440,10" /></svg>') repeat-x;
      margin: 2rem 0;
    }
    .ripple-btn {
      position: relative;
      overflow: hidden;
      transition: all 0.3s ease;
      background: linear-gradient(to right, #14b8a6, #2dd4bf);
      padding: 0.75rem 1.5rem;
      font-size: 1.1rem;
      font-weight: 600;
      border-radius: 8px;
      color: white;
    }
    .ripple-btn:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 12px rgba(20, 184, 166, 0.3);
    }
    .ripple-btn:active::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 0;
      height: 0;
      background: rgba(255, 255, 255, 0.4);
      border-radius: 50%;
      transform: translate(-50%, -50%);
      animation: ripple 0.6s ease-out;
    }
    .ripple-btn i {
      margin-right: 0.5rem;
      font-size: 1.3rem;
    }
    .logout-btn {
      background: linear-gradient(to right, #ef4444, #f87171);
      transition: all 0.3s ease;
    }
    .logout-btn:hover {
      transform: scale(1.05);
      box-shadow: 0 4px 8px rgba(239, 68, 68, 0.3);
    }
    .connection-indicator {
      display: flex;
      align-items: center;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      font-size: 1rem;
      font-weight: 500;
      color: white;
      transition: all 0.3s ease;
    }
    .connection-indicator i {
      margin-right: 0.5rem;
      font-size: 1.2rem;
    }
    .connection-indicator.online {
      background: linear-gradient(to right, #14b8a6, #2dd4bf);
    }
    .connection-indicator.offline {
      background: linear-gradient(to right, #ef4444, #f87171);
    }
    .connection-indicator:hover {
      transform: scale(1.05);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
    }
    @keyframes slideIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes borderGlow {
      0% { border-bottom-color: transparent; }
      100% { border-bottom-color: #14b8a6; }
    }
    @keyframes ripple {
      0% { width: 0; height: 0; opacity: 0.5; }
      100% { width: 200px; height: 200px; opacity: 0; }
    }
    @keyframes pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.03); }
      100% { transform: scale(1); }
    }
    .crop-badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      background: linear-gradient(to right, #8b5cf6, #a78bfa);
      color: white;
      font-weight: 600;
      font-size: 0.85rem;
      margin-right: 0.5rem;
    }
    .crop-select {
      width: 100%;
      padding: 0.75rem;
      border-radius: 8px;
      border: 1px solid #d1d5db;
      background: white;
      font-size: 1rem;
      color: #1f2937;
      outline: none;
      transition: border-color 0.3s, box-shadow 0.3s;
    }
    .crop-select:focus {
      border-color: #14b8a6;
      box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.2);
    }
  </style>
</head>
<body class="font-sans text-gray-900">
  <!-- Password Section -->
  <div id="passwordSection" class="flex items-center justify-center min-h-screen">
    <div class="bg-white p-8 rounded-2xl shadow-xl card max-w-sm w-full">
      <h2 class="text-3xl font-bold text-center text-gray-900 mb-6"><i class="fa-solid fa-lock mr-2 text-teal-500"></i> Greenhouse Login</h2>
      <input id="passwordInput" type="password" class="w-full p-3 border border-gray-200 rounded-lg mb-4 focus:outline-none focus:ring-2 focus:ring-teal-500" placeholder="Enter Password">
      <button id="submitPassword" class="w-full bg-teal-500 text-white p-3 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-sign-in-alt mr-2"></i> Login</button>
      <p id="passwordError" class="text-red-500 mt-4 text-center hidden">Incorrect Password</p>
    </div>
  </div>

  <!-- Main Control Section (Hidden Initially) -->
  <div id="controlSection" class="container mx-auto p-6 hidden">
    <div class="flex items-center justify-between mb-8">
      <h1 class="text-4xl font-bold text-gray-900"><i class="fa-solid fa-leaf mr-2 text-teal-500"></i> Greenhouse Control</h1>
      <div class="flex space-x-4">
        <button id="toggleMode" class="bg-teal-500 text-white px-4 py-2 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-sync mr-2"></i> Switch Mode</button>
        <div id="connectionIndicator" class="connection-indicator offline"><i class="fa-solid fa-wifi-slash"></i> Offline</div>
        <button id="logoutButton" class="logout-btn text-white px-4 py-2 rounded-lg"><i class="fa-solid fa-sign-out-alt mr-2"></i> Logout</button>
      </div>
    </div>

    <!-- Tabs Navigation -->
    <div class="flex border-b border-gray-200 mb-8">
      <button id="tabDashboard" class="tab flex-1 py-3 px-4 text-center text-gray-600 font-semibold hover:bg-gray-100 active">Dashboard</button>
      <button id="tabRelays" class="tab flex-1 py-3 px-4 text-center text-gray-600 font-semibold hover:bg-gray-100">Relays</button>
      <button id="tabSettings" class="tab flex-1 py-3 px-4 text-center text-gray-600 font-semibold hover:bg-gray-100">Settings</button>
    </div>

    <!-- Tab Content -->
    <div id="dashboardContent" class="tab-content">
      <!-- System Status -->
      <div class="mb-8">
        <div class="bg-white p-6 rounded-2xl shadow-lg card">
          <div class="section-header">
            <h3 class="text-xl font-semibold"><i class="fa-solid fa-gauge mr-2"></i> System Status</h3>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <p class="mb-3">Mode: <span id="currentMode" class="status-badge bg-gray-100 text-gray-800">—</span></p>
            <p class="mb-3">Lighting: <span id="relayState1" class="status-badge bg-gray-100 text-gray-800">—</span></p>
            <p class="mb-3">Ventilation: <span id="relayState2" class="status-badge bg-gray-100 text-gray-800">—</span></p>
          </div>
        </div>
      </div>

      <!-- Sensors -->
      <div>
        <div class="section-header" style="margin: 0 0 1.5rem;">
          <h3 class="text-xl font-semibold"><i class="fa-solid fa-thermometer mr-2"></i> Environmental Sensors</h3>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <!-- Temperature -->
          <div class="bg-white p-6 rounded-2xl shadow-lg card">
            <h4 class="text-lg font-semibold text-gray-900 mb-3"><i class="fa-solid fa-temperature-high mr-2 text-teal-500"></i> Temperature</h4>
            <p id="temperature" class="text-lg mb-3">— °C</p>
            <div class="progress-bar"><div id="temperatureProgress" class="progress-bar-fill" style="width: 0%"></div></div>
            <button id="tempChartBtn" class="mt-4 bg-teal-500 text-white px-4 py-2 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-chart-line mr-2"></i> View Trends</button>
          </div>
          <!-- Humidity -->
          <div class="bg-white p-6 rounded-2xl shadow-lg card">
            <h4 class="text-lg font-semibold text-gray-900 mb-3"><i class="fa-solid fa-tint mr-2 text-teal-500"></i> Humidity</h4>
            <p id="humidity" class="text-lg mb-3">— %</p>
            <div class="progress-bar"><div id="humidityProgress" class="progress-bar-fill" style="width: 0%"></div></div>
            <button id="humidityChartBtn" class="mt-4 bg-teal-500 text-white px-4 py-2 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-chart-line mr-2"></i> View Trends</button>
          </div>
          <!-- Soil Moisture -->
          <div class="bg-white p-6 rounded-2xl shadow-lg card">
            <h4 class="text-lg font-semibold text-gray-900 mb-3"><i class="fa-solid fa-seedling mr-2 text-teal-500"></i> Soil Moisture</h4>
            <p id="soilMoisture" class="text-lg mb-3">— %</p>
            <div class="progress-bar"><div id="soilMoistureProgress" class="progress-bar-fill" style="width: 0%"></div></div>
            <button id="soilMoistureChartBtn" class="mt-4 bg-teal-500 text-white px-4 py-2 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-chart-line mr-2"></i> View Trends</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Chart Modals -->
    <div id="tempModal" class="modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center hidden modal-overlay">
      <div class="bg-white p-6 rounded-2xl max-w-2xl w-full">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-semibold text-gray-900"><i class="fa-solid fa-temperature-high mr-2 text-teal-500"></i> Temperature Trends</h3>
          <button id="closeTempModal" class="text-gray-600 hover:text-gray-900"><i class="fa-solid fa-times"></i></button>
        </div>
        <canvas id="tempChart"></canvas>
      </div>
    </div>
    <div id="humidityModal" class="modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center hidden modal-overlay">
      <div class="bg-white p-6 rounded-2xl max-w-2xl w-full">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-semibold text-gray-900"><i class="fa-solid fa-tint mr-2 text-teal-500"></i> Humidity Trends</h3>
          <button id="closeHumidityModal" class="text-gray-600 hover:text-gray-900"><i class="fa-solid fa-times"></i></button>
        </div>
        <canvas id="humidityChart"></canvas>
      </div>
    </div>
    <div id="soilMoistureModal" class="modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center hidden modal-overlay">
      <div class="bg-white p-6 rounded-2xl max-w-2xl w-full">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-semibold text-gray-900"><i class="fa-solid fa-seedling mr-2 text-teal-500"></i> Soil Moisture Trends</h3>
          <button id="closeSoilMoistureModal" class="text-gray-600 hover:text-gray-900"><i class="fa-solid fa-times"></i></button>
        </div>
        <canvas id="soilMoistureChart"></canvas>
      </div>
    </div>

    <div id="relaysContent" class="tab-content hidden">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Lighting -->
        <div class="bg-white p-6 rounded-2xl shadow-lg card">
          <h3 class="text-xl font-semibold text-gray-900 mb-4"><i class="fa-solid fa-lightbulb mr-2 text-teal-500"></i> Lighting</h3>
          <p id="relayState1Control" class="text-lg mb-4">Lighting: —</p>
          <button id="toggleRelay1" class="w-full bg-teal-500 text-white p-3 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-power-off mr-2"></i> Toggle Lighting</button>
        </div>
        <!-- Ventilation -->
        <div class="bg-white p-6 rounded-2xl shadow-lg card">
          <h3 class="text-xl font-semibold text-gray-900 mb-4"><i class="fa-solid fa-fan mr-2 text-teal-500"></i> Ventilation</h3>
          <p id="relayState2Control" class="text-lg mb-4">Ventilation: —</p>
          <button id="toggleRelay2" class="w-full bg-teal-500 text-white p-3 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-power-off mr-2"></i> Toggle Ventilation</button>
        </div>
      </div>
    </div>

<div id="settingsContent" class="tab-content hidden">
  <!-- Crop Selection -->
  <div class="bg-white p-6 rounded-2xl shadow-lg card mb-8">
    <div class="section-header">
      <i class="fa-solid fa-seedling"></i>
      <h3>Crop Selection</h3>
    </div>
    <div class="grid grid-cols-1 gap-6">
      <div>
        <label class="block text-gray-700 font-bold mb-2" for="cropSelect">Select Crop</label>
        <select id="cropSelect" class="crop-select">
          <!-- Опции будут добавляться через JavaScript -->
        </select>
      </div>
      <div id="customCropFields" class="hidden">
        <div class="grid grid-cols-1 gap-4">
          <div>
            <label class="block text-gray-700 font-bold mb-2" for="newCropName">Crop Name</label>
            <input id="newCropName" type="text" class="w-full p-2 border border-gray-300 rounded-lg" placeholder="Enter crop name">
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="block text-gray-700 font-bold mb-2" for="newCropKey">Crop Key</label>
              <input id="newCropKey" type="text" class="w-full p-2 border border-gray-300 rounded-lg" placeholder="Unique key (e.g. custom_crop)">
            </div>
          </div>
        </div>
      </div>
      <div class="flex justify-end">
        <button id="applyCrop" class="ripple-btn"><i class="fa-solid fa-check mr-2"></i> Apply Crop Settings</button>
        <button id="deleteCrop" class="logout-btn ripple-btn">
  <i class="fa-solid fa-trash mr-2"></i> Delete Crop
</button>
      </div>
    </div>
  </div>

  <!-- Crop Settings Editor -->
  <div class="bg-white p-6 rounded-2xl shadow-lg card mb-8">
    <div class="section-header">
      <i class="fa-solid fa-sliders-h"></i>
      <h3>Crop Settings Editor</h3>
    </div>
    <div class="mb-4">
      <p class="text-gray-700">Current Crop: <span id="currentCropName" class="crop-badge">Potato</span></p>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-8">
      <div class="input-card">
        <label class="input-label">Temp Threshold (°C)</label>
        <div class="icon-circle"><i class="fa-solid fa-temperature-half"></i></div>
        <input id="cropFanTemperatureThreshold" type="number" step="0.1" value="22.0" placeholder="Enter °C">
      </div>
      <div class="input-card">
        <label class="input-label">Light Duration (min)</label>
        <div class="icon-circle"><i class="fa-solid fa-sun"></i></div>
        <input id="cropLightOnDuration" type="number" value="120" placeholder="Enter minutes">
      </div>
      <div class="input-card">
        <label class="input-label">Light Interval (min)</label>
        <div class="icon-circle"><i class="fa-solid fa-clock-rotate-left"></i></div>
        <input id="cropLightIntervalManual" type="number" value="360" placeholder="Enter minutes">
      </div>
    </div>
    <div class="grid grid-cols-1 sm:grid-cols-4 gap-8 mt-4">
      <div class="input-card">
        <label class="input-label">Pump Start Hour</label>
        <div class="icon-circle"><i class="fa-solid fa-clock"></i></div>
        <input id="cropPumpStartHour" type="number" min="0" max="23" value="8" placeholder="0-23">
      </div>
      <div class="input-card">
        <label class="input-label">Pump Start Minute</label>
        <div class="icon-circle"><i class="fa-solid fa-clock"></i></div>
        <input id="cropPumpStartMinute" type="number" min="0" max="59" value="0" placeholder="0-59">
      </div>
      <div class="input-card">
        <label class="input-label">Pump Duration (sec)</label>
        <div class="icon-circle"><i class="fa-solid fa-stopwatch-20"></i></div>
        <input id="cropPumpDuration" type="number" min="1" value="15" placeholder="Seconds">
      </div>
      <div class="input-card">
        <label class="input-label">Pump Interval (min)</label>
        <div class="icon-circle"><i class="fa-solid fa-hourglass-half"></i></div>
        <input id="cropPumpInterval" type="number" min="1" value="180" placeholder="Minutes">
      </div>
    </div>
    <div class="wave-divider"></div>
    <div class="flex justify-between mt-4">
      <button id="saveCropSettings" class="ripple-btn"><i class="fa-solid fa-save mr-2"></i> Save Crop Settings</button>
      <button id="deleteCrop" class="logout-btn ripple-btn"><i class="fa-solid fa-trash mr-2"></i> Delete Crop</button>
    </div>
  </div>
</div>

  <script>
    console.log('Script loaded');
    const correctPassword = 'admin';

    function handleLogin() {
      console.log('handleLogin called');
      const passwordInput = document.getElementById('passwordInput');
      const passwordError = document.getElementById('passwordError');
      const passwordSection = document.getElementById('passwordSection');
      const controlSection = document.getElementById('controlSection');

      if (!passwordInput || !passwordError || !passwordSection || !controlSection) {
        console.error('DOM elements missing:', { passwordInput, passwordError, passwordSection, controlSection });
        alert('Error: Page elements not found. Please refresh the page.');
        return;
      }

      const password = passwordInput.value.trim().toLowerCase();
      console.log('Password entered:', password);

      if (password === correctPassword.toLowerCase()) {
        console.log('Password correct, showing control section');
        localStorage.setItem('isLoggedIn', 'true');
        passwordSection.classList.add('hidden');
        controlSection.classList.remove('hidden');
        passwordInput.value = '';
        passwordError.classList.add('hidden');
        initializeApp();
      } else {
        console.log('Incorrect password');
        passwordError.classList.remove('hidden');
        alert('Incorrect password, please try again.');
      }
    }

    function handleLogout() {
      console.log('Logging out');
      localStorage.removeItem('isLoggedIn');
      localStorage.removeItem('lightingSettings');
      localStorage.removeItem('pumpSettings');
      const passwordSection = document.getElementById('passwordSection');
      const controlSection = document.getElementById('controlSection');
      controlSection.classList.add('hidden');
      passwordSection.classList.remove('hidden');
    }

    function setupLoginListeners() {
      console.log('Setting up login listeners');
      const submitButton = document.getElementById('submitPassword');
      const passwordInput = document.getElementById('passwordInput');

      if (submitButton) {
        console.log('Submit button found, attaching click listener');
        submitButton.addEventListener('click', () => {
          console.log('Login button clicked');
          handleLogin();
        });
      } else {
        console.error('Submit button not found');
        alert('Error: Submit button not found. Please refresh the page.');
      }

      if (passwordInput) {
        console.log('Password input found, attaching keypress listener');
        passwordInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            console.log('Enter key pressed');
            handleLogin();
          }
        });
      } else {
        console.error('Password input not found');
        alert('Error: Password input not found. Please refresh the page.');
      }
    }

    async function checkConnection() {
      const indicator = document.getElementById('connectionIndicator');
      try {
        const response = await fetch('/getSensorStatus', { method: 'GET', cache: 'no-store' });
        const data = await response.json();
        if (data.isOnline) {
          indicator.classList.remove('offline');
          indicator.classList.add('online');
          indicator.innerHTML = '<i class="fa-solid fa-wifi"></i> Online';
          console.log('Greenhouse is online');
        } else {
          indicator.classList.remove('online');
          indicator.classList.add('offline');
          indicator.innerHTML = '<i class="fa-solid fa-wifi-slash"></i> Offline';
          console.log('Greenhouse is offline');
        }
      } catch (error) {
        indicator.classList.remove('online');
        indicator.classList.add('offline');
        indicator.innerHTML = '<i class="fa-solid fa-wifi-slash"></i> Offline';
        console.log('Error checking greenhouse status:', error);
      }
    }

document.getElementById('deleteCrop').addEventListener('click', async () => {
  if (confirm('Are you sure you want to delete the current crop? This action cannot be undone.')) {
    try {
      const response = await fetch('/deleteCrop', { method: 'POST' });
      if (response.ok) {
        alert('Crop deleted successfully!');
        const cropData = await loadCropSettings();
        updateCropDropdown(cropData);
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to delete crop');
      }
    } catch (error) {
      console.error('Error deleting crop:', error);
      alert('Error deleting crop');
    }
  }
});


    // Check login status on page load
    document.addEventListener('DOMContentLoaded', () => {
      console.log('DOM fully loaded');
      setupLoginListeners();
      const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
      const passwordSection = document.getElementById('passwordSection');
      const controlSection = document.getElementById('controlSection');

      if (isLoggedIn && passwordSection && controlSection) {
        console.log('User is logged in, bypassing password section');
        passwordSection.classList.add('hidden');
        controlSection.classList.remove('hidden');
        initializeApp();
      }

      // Setup logout button
      const logoutButton = document.getElementById('logoutButton');
      if (logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
      }
    });

    const tabs = {
      dashboard: document.getElementById('dashboardContent'),
      relays: document.getElementById('relaysContent'),
      settings: document.getElementById('settingsContent')
    };
    const tabButtons = {
      dashboard: document.getElementById('tabDashboard'),
      relays: document.getElementById('tabRelays'),
      settings: document.getElementById('tabSettings')
    };

    function switchTab(tabName) {
      Object.values(tabs).forEach(tab => tab.classList.add('hidden'));
      Object.values(tabButtons).forEach(btn => btn.classList.remove('active'));
      tabs[tabName].classList.remove('hidden');
      tabButtons[tabName].classList.add('active');
    }

    Object.keys(tabButtons).forEach(tabName => {
      tabButtons[tabName].addEventListener('click', () => switchTab(tabName));
    });

    let tempChart, humidityChart, soilMoistureChart;
    const maxDataPoints = 30;
    function initializeCharts() {
      const ctxTemp = document.getElementById('tempChart').getContext('2d');
      const ctxHumidity = document.getElementById('humidityChart').getContext('2d');
      const ctxSoilMoisture = document.getElementById('soilMoistureChart').getContext('2d');

      tempChart = new Chart(ctxTemp, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Temperature (°C)',
            data: [],
            borderColor: '#14b8a6',
            backgroundColor: 'rgba(20, 184, 166, 0.2)',
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          scales: { y: { beginAtZero: true, max: 40 } }
        }
      });

      humidityChart = new Chart(ctxHumidity, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Humidity (%)',
            data: [],
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.2)',
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          scales: { y: { beginAtZero: true, max: 100 } }
        }
      });

      soilMoistureChart = new Chart(ctxSoilMoisture, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Soil Moisture (%)',
            data: [],
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.2)',
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true,
          scales: { y: { viewingAtZero: true, max: 100 } }
        }
      });
    }

    function toggleModal(modalId, show) {
      const modal = document.getElementById(modalId);
      if (show) {
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.add('show'), 10);
      } else {
        modal.classList.remove('show');
        setTimeout(() => modal.classList.add('hidden'), 300);
      }
    }

    document.getElementById('tempChartBtn').addEventListener('click', () => toggleModal('tempModal', true));
    document.getElementById('humidityChartBtn').addEventListener('click', () => toggleModal('humidityModal', true));
    document.getElementById('soilMoistureChartBtn').addEventListener('click', () => toggleModal('soilMoistureModal', true));
    document.getElementById('closeTempModal').addEventListener('click', () => toggleModal('tempModal', false));
    document.getElementById('closeHumidityModal').addEventListener('click', () => toggleModal('humidityModal', false));
    document.getElementById('closeSoilMoistureModal').addEventListener('click', () => toggleModal('soilMoistureModal', false));

    let globalCropSettings = null;

async function loadCropSettings() {
  try {
    const response = await fetch('/getCropSettings');
    if (response.ok) {
      const data = await response.json();
      console.log('Loaded crop settings:', data);
      return data;
    } else {
      console.error('Error loading crop settings:', response.status);
      return {
        currentCropKey: 'potato',
        availableCrops: {}
      };
    }
  } catch (error) {
    console.error('Error loading crop settings:', error);
    return {
      currentCropKey: 'potato',
      availableCrops: {}
    };
  }
}

async function updateCropDropdown() {
  try {
    const response = await fetch('/getCropsList');
    const crops = await response.json();
    const cropSelect = document.getElementById('cropSelect');
    
    // Очищаем существующие опции
    cropSelect.innerHTML = '';
    
    // Добавляем культуры в выпадающий список
    crops.forEach(crop => {
      const option = document.createElement('option');
      option.value = crop.key;
      option.textContent = crop.name;
      cropSelect.appendChild(option);
    });
    
    // Добавляем опцию для создания новой культуры
    const customOption = document.createElement('option');
    customOption.value = 'custom';
    customOption.textContent = 'Custom Crop...';
    cropSelect.appendChild(customOption);
    
    // Загружаем текущую культуру и ее настройки
    await loadCurrentCropSettings();
  } catch (error) {
    console.error('Error updating crop dropdown:', error);
  }
}
// Добавим новую функцию для загрузки настроек текущей культуры
async function loadCurrentCropSettings() {
  try {
    const response = await fetch('/getCurrentCropSettings');
    const data = await response.json();
    
    // Устанавливаем выбранную культуру в dropdown
    const cropSelect = document.getElementById('cropSelect');
    if (cropSelect) {
      cropSelect.value = data.currentCrop;
      document.getElementById('currentCropName').textContent = 
        cropSelect.options[cropSelect.selectedIndex].text;
    }
    
    // Заполняем поля настроек
    if (data.settings) {
      document.getElementById('cropFanTemperatureThreshold').value = 
        data.settings.fanTemperatureThreshold || 25.0;
      document.getElementById('cropLightOnDuration').value = 
        (data.settings.lightOnDuration || 7200000) / 60000; // конвертируем в минуты
      document.getElementById('cropLightIntervalManual').value = 
        (data.settings.lightIntervalManual || 21600000) / 60000;
      document.getElementById('cropPumpStartHour').value = 
        data.settings.pumpStartHour || 8;
      document.getElementById('cropPumpStartMinute').value = 
        data.settings.pumpStartMinute || 0;
      document.getElementById('cropPumpDuration').value = 
        data.settings.pumpDuration || 15;
      document.getElementById('cropPumpInterval').value = 
        data.settings.pumpInterval || 180;
    }
  } catch (error) {
    console.error('Error loading current crop settings:', error);
  }
}    


async function applyCropSettings() {
    const cropSelect = document.getElementById('cropSelect');
    const selectedCrop = cropSelect.value;
    
    if (selectedCrop === 'custom') {
      // Создание новой культуры
      const cropKey = document.getElementById('newCropKey').value.trim();
      const cropName = document.getElementById('newCropName').value.trim();
      
      if (!cropKey || !cropName) {
        alert('Please enter both crop key and name');
        return;
      }
      
      try {
        const response = await fetch('/addCrop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            cropKey,
            cropName,
            fanTemperatureThreshold: document.getElementById('cropFanTemperatureThreshold').value,
            lightOnDuration: document.getElementById('cropLightOnDuration').value,
            lightIntervalManual: document.getElementById('cropLightIntervalManual').value,
            pumpStartHour: document.getElementById('cropPumpStartHour').value,
            pumpStartMinute: document.getElementById('cropPumpStartMinute').value,
            pumpDuration: document.getElementById('cropPumpDuration').value,
            pumpInterval: document.getElementById('cropPumpInterval').value
          })
        });
        
        if (response.ok) {
          alert('New crop created!');
          const cropData = await loadCropSettings();
          updateCropDropdown(cropData);
        } else {
          const error = await response.text();
          alert(error || 'Failed to create crop');
        }
      } catch (error) {
        console.error('Error creating crop:', error);
        alert('Error creating crop');
      }
    } else {
      // Применение существующей культуры
      try {
        const response = await fetch('/setCurrentCrop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ crop: selectedCrop })
        });
        
        if (response.ok) {
          const cropData = await loadCropSettings();
          updateCropDropdown(cropData);
          alert('Crop applied!');
        } else {
          const error = await response.text();
          alert(error || 'Failed to apply crop');
        }
      } catch (error) {
        console.error('Error applying crop:', error);
        alert('Error applying crop');
      }
    }
  }

async function initializeApp() {
  try {
    switchTab('dashboard');
    initializeCharts();
    updateRelayState();
    updateSensorData();
    updateMode();
    updateSettings();
    checkConnection();
    await updateCropDropdown(); // Добавьте эту строку
    // Загрузка настроек культур и обновление выпадающего списка
    const cropData = await loadCropSettings();
    updateCropDropdown(cropData);

    // Инициализация обработчиков событий
    document.getElementById('toggleRelay1').addEventListener('click', () => toggleRelay(1));
    document.getElementById('toggleRelay2').addEventListener('click', () => toggleRelay(2));
    document.getElementById('toggleMode').addEventListener('click', toggleMode);
    document.getElementById('applyCrop').addEventListener('click', applyCropSettings);
    document.getElementById('saveCropSettings').addEventListener('click', saveCropSettings);
    document.getElementById('deleteCrop').addEventListener('click', deleteCurrentCrop);
    
   // Обновим обработчик изменения выбора культуры
document.getElementById('cropSelect').addEventListener('change', async function() {
  const customFields = document.getElementById('customCropFields');
  if (this.value === 'custom') {
    customFields.classList.remove('hidden');
    // Очищаем поля для новой культуры
    document.getElementById('newCropKey').value = '';
    document.getElementById('newCropName').value = '';
  } else {
    customFields.classList.add('hidden');
    // Загружаем настройки выбранной культуры
    await loadCurrentCropSettings();
  }
});


    setInterval(updateSensorData, 5000);
    setInterval(updateRelayState, 5000);
    setInterval(updateMode, 5000);
    setInterval(checkConnection, 10000);
  try {
    const response = await fetch('/getCropSettings');
    const data = await response.json();
    
    // Устанавливаем текущую культуру в интерфейсе
    const cropSelect = document.getElementById('cropSelect');
    if (cropSelect) {
      cropSelect.value = data.currentCrop;
      document.getElementById('currentCropName').textContent = 
        cropSelect.options[cropSelect.selectedIndex].text;
    }
  } catch (error) {
    console.error('Error loading crop settings:', error);
  }
}


async function applyCropSettings() {
  const cropSelect = document.getElementById('cropSelect');
  const selectedCrop = cropSelect.value;
  
  if (selectedCrop === 'custom') {
    // Создание новой культуры
    const cropKey = document.getElementById('newCropKey').value.trim();
    const cropName = document.getElementById('newCropName').value.trim();
    
    if (!cropKey || !cropName) {
      alert('Please enter both crop key and name');
      return;
    }
    
    try {
      const response = await fetch('/addCrop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cropKey,
          cropName,
          fanTemperatureThreshold: document.getElementById('cropFanTemperatureThreshold').value,
          lightOnDuration: document.getElementById('cropLightOnDuration').value,
          lightIntervalManual: document.getElementById('cropLightIntervalManual').value,
          pumpStartHour: document.getElementById('cropPumpStartHour').value,
          pumpStartMinute: document.getElementById('cropPumpStartMinute').value,
          pumpDuration: document.getElementById('cropPumpDuration').value,
          pumpInterval: document.getElementById('cropPumpInterval').value
        })
      });
      
      if (response.ok) {
        alert('New crop created successfully!');
        await updateCropDropdown();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to create crop');
      }
    } catch (error) {
      console.error('Error creating crop:', error);
      alert('Error creating crop');
    }
  } else {
    // Применение существующей культуры
    try {
      const response = await fetch('/setCurrentCrop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crop: selectedCrop })
      });
      
      if (response.ok) {
        await loadCurrentCropSettings();
        alert('Crop settings applied successfully!');
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to apply crop settings');
      }
    } catch (error) {
      console.error('Error applying crop settings:', error);
      alert('Error applying crop settings');
    }
  }
}

// Добавьте этот обработчик в initializeApp
document.getElementById('cropSelect').addEventListener('change', function() {
  const customFields = document.getElementById('customCropFields');
  if (this.value === 'custom') {
    customFields.classList.remove('hidden');
  } else {
    customFields.classList.add('hidden');
  }
});
    
    async function saveCropSettings() {
  try {
    const settings = {
      fanTemperatureThreshold: parseFloat(document.getElementById('cropFanTemperatureThreshold').value),
      lightOnDuration: parseInt(document.getElementById('cropLightOnDuration').value) * 60000,
      lightIntervalManual: parseInt(document.getElementById('cropLightIntervalManual').value) * 60000,
      pumpStartHour: parseInt(document.getElementById('cropPumpStartHour').value),
      pumpStartMinute: parseInt(document.getElementById('cropPumpStartMinute').value),
      pumpDuration: parseInt(document.getElementById('cropPumpDuration').value),
      pumpInterval: parseInt(document.getElementById('cropPumpInterval').value)
    };
    
    const response = await fetch('/saveCropSettings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    
    if (response.ok) {
      alert('Crop settings saved successfully!');
      await loadCurrentCropSettings();
    } else {
      const error = await response.json();
      alert(error.error || 'Failed to save crop settings');
    }
  } catch (error) {
    console.error('Error saving crop settings:', error);
    alert('Error saving crop settings');
  }
}
    
    async function deleteCurrentCrop() {
  if (confirm('Are you sure you want to delete the current crop? This action cannot be undone.')) {
    try {
      const response = await fetch('/deleteCrop', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crop: currentCrop })
      });
      
      if (response.ok) {
        alert('Crop deleted successfully!');
        await updateCropDropdown();
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to delete crop');
      }
    } catch (error) {
      console.error('Error deleting crop:', error);
      alert('Error deleting crop');
    }
  }
}

    async function initializeApp() {
  try {
    switchTab('dashboard');
    initializeCharts();
    updateRelayState();
    updateSensorData();
    updateMode();
    updateSettings();
    checkConnection();
    
    // Инициализация работы с культурами
    await updateCropDropdown();
    
    // Инициализация обработчиков событий
    document.getElementById('toggleRelay1').addEventListener('click', () => toggleRelay(1));
    document.getElementById('toggleRelay2').addEventListener('click', () => toggleRelay(2));
    document.getElementById('toggleMode').addEventListener('click', toggleMode);
    
    document.getElementById('applyCrop').addEventListener('click', applyCropSettings);
    document.getElementById('saveCropSettings').addEventListener('click', saveCropSettings);
    document.getElementById('deleteCrop').addEventListener('click', deleteCurrentCrop);
    
    setInterval(updateSensorData, 5000);
    setInterval(updateRelayState, 5000);
    setInterval(updateMode, 5000);
    setInterval(checkConnection, 10000);
  } catch (error) {
    console.error('Error initializing app:', error);
    alert('Failed to initialize the application. Please refresh the page.');
  }
}

    async function updateRelayState() {
      try {
        const response = await fetch('/getRelayState');
        const data = await response.json();
        const relay1Badge = document.getElementById('relayState1');
        const relay2Badge = document.getElementById('relayState2');
        const relay1Control = document.getElementById('relayState1Control');
        const relay2Control = document.getElementById('relayState2Control');

        relay1Badge.textContent = data.relayState1 ? 'ON' : 'OFF';
        relay1Badge.className = 'status-badge ' + (data.relayState1 ? 'bg-teal-100 text-teal-800' : 'bg-red-100 text-red-800');
relay2Badge.textContent = data.relayState2 ? 'ON' : 'OFF';
relay2Badge.className = 'status-badge ' + (data.relayState2 ? 'bg-teal-100 text-teal-800' : 'bg-red-100 text-red-800');
relay1Control.textContent = 'Lighting: ' + (data.relayState1 ? 'ON' : 'OFF');
relay2Control.textContent = 'Ventilation: ' + (data.relayState2 ? 'ON' : 'OFF');
      } catch (error) {
        console.error('Error fetching relay state:', error);
      }
    }

    async function updateSensorData() {
      try {
        const response = await fetch('/getSensorData');
        const data = await response.json();
        document.getElementById('temperature').textContent = data.temperature + ' °C';
document.getElementById('humidity').textContent = data.humidity + ' %';
document.getElementById('soilMoisture').textContent = data.soilMoisture + ' %';

document.getElementById('temperatureProgress').style.width = Math.min((data.temperature / 40) * 100, 100) + '%';
document.getElementById('humidityProgress').style.width = Math.min(data.humidity, 100) + '%';
document.getElementById('soilMoistureProgress').style.width = Math.min(data.soilMoisture, 100) + '%';

        const timestamp = new Date().toLocaleTimeString();
        updateChartData('temperature', timestamp, data.temperature);
        updateChartData('humidity', timestamp, data.humidity);
        updateChartData('soilMoisture', timestamp, data.soilMoisture);
      } catch (error) {
        console.error('Error fetching sensor data:', error);
      }
    }

    function updateChartData(sensor, timestamp, value) {
      const key = sensor + 'Data';
      let storedData = JSON.parse(localStorage.getItem(key)) || { labels: [], values: [] };
      storedData.labels.push(timestamp);
      storedData.values.push(value);

      if (storedData.labels.length > maxDataPoints) {
        storedData.labels.shift();
        storedData.values.shift();
      }

      localStorage.setItem(key, JSON.stringify(storedData));

      const chart = {
        temperature: tempChart,
        humidity: humidityChart,
        soilMoisture: soilMoistureChart
      }[sensor];

      chart.data.labels = storedData.labels;
      chart.data.datasets[0].data = storedData.values;
      chart.update();
    }

    async function updateMode() {
      try {
        const response = await fetch('/getMode');
        const data = await response.json();
        const modeBadge = document.getElementById('currentMode');
        modeBadge.textContent = data.mode.charAt(0).toUpperCase() + data.mode.slice(1);
        modeBadge.className = 'status-badge ' + (data.mode === 'auto' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800');
      } catch (error) {
        console.error('Error fetching mode:', error);
      }
    }

    async function updateSettings() {
      try {
        // Check localStorage first
        const storedLighting = JSON.parse(localStorage.getItem('lightingSettings'));
        const storedPump = JSON.parse(localStorage.getItem('pumpSettings'));

        if (storedLighting) {
          document.getElementById('fanTemperatureThreshold').value = storedLighting.fanTemperatureThreshold;
          document.getElementById('lightOnDuration').value = storedLighting.lightOnDuration / 60000;
          document.getElementById('lightIntervalManual').value = storedLighting.lightIntervalManual / 60000;
        } else {
          const lightingResponse = await fetch('/getLightingSettings');
          const lightingData = await lightingResponse.json();
          document.getElementById('fanTemperatureThreshold').value = lightingData.fanTemperatureThreshold;
          document.getElementById('lightOnDuration').value = lightingData.lightOnDuration / 60000;
          document.getElementById('lightIntervalManual').value = lightingData.lightOnDuration / 60000;
        }

        if (storedPump) {
          document.getElementById('pumpStartHour').value = storedPump.pumpStartHour;
          document.getElementById('pumpStartMinute').value = storedPump.pumpStartMinute;
          document.getElementById('pumpDuration').value = storedPump.pumpDuration;
          document.getElementById('pumpInterval').value = storedPump.pumpInterval;
        } else {
          const pumpResponse = await fetch('/getPumpSettings');
          const pumpData = await pumpResponse.json();
          document.getElementById('pumpStartHour').value = pumpData.pumpStartHour;
          document.getElementById('pumpStartMinute').value = pumpData.pumpStartMinute;
          document.getElementById('pumpDuration').value = pumpData.pumpDuration;
          document.getElementById('pumpInterval').value = pumpData.pumpInterval;
        }
      } catch (error) {
        console.error('Error fetching settings:', error);
      }
    }

    async function toggleRelay(relayNumber) {
      try {
        const response = await fetch('/toggleRelay/' + relayNumber, {
          method: 'POST'
        });
        if (response.ok) {
          await updateRelayState();
        } else {
          const error = await response.json();
          alert(error.error || 'Failed to toggle relay');
        }
      } catch (error) {
        console.error('Error toggling relay:', error);
        alert('Error toggling relay');
      }
    }

    async function toggleMode() {
      try {
        const currentMode = document.getElementById('currentMode').textContent.toLowerCase();
        const newMode = currentMode.includes('auto') ? 'manual' : 'auto';
        const response = await fetch('/setMode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: newMode })
        });
        if (response.ok) {
          await updateMode();
        } else {
          const error = await response.json();
          alert(error.error || 'Failed to switch mode');
        }
      } catch (error) {
        console.error('Error switching mode:', error);
        alert('Error switching mode');
      }
    }

    

    
  </script>
</body>
</html>
`);
});
// API Endpoints
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
app.get('/getCropsList', async (req, res) => {
  try {
    await loadCropSettings(); // Загружаем актуальные настройки
    const cropsList = Object.keys(cropSettings).map(key => ({
      key: key,
      name: cropSettings[key].name || key
    }));
    res.json(cropsList);
  } catch (error) {
    console.error('Error getting crops list:', error);
    res.status(500).json({ error: 'Server error' });
  }
});
app.get('/getCurrentCropSettings', async (req, res) => {
  try {
    await loadCropSettings();
    res.json({
      currentCrop: currentCrop,
      settings: cropSettings[currentCrop] || {}
    });
  } catch (error) {
    console.error('Error getting current crop settings:', error);
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

// Crop Settings Endpoints
app.get('/getCropSettings', (req, res) => {
  try {
    res.json({
      currentCropKey: currentCrop,
      availableCrops: cropSettings
    });
  } catch (error) {
    console.error('Error in /getCropSettings:', error);
    res.status(500).json({ 
      error: 'Server error',
      currentCropKey: 'potato',
      availableCrops: cropSettings
    });
  }
});

/ Эндпоинт для установки текущей культуры
app.post('/setCurrentCrop', async (req, res) => {
  try {
    const { crop } = req.body;
    
    if (cropSettings[crop]) {
      currentCrop = crop;
      await saveCropSettings(); // Сохраняем изменения
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid crop selection' });
    }
  } catch (error) {
    console.error('Error in /setCurrentCrop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/saveCropSettings', async (req, res) => {
  try {
    const settings = req.body;
    
    if (
      typeof settings.fanTemperatureThreshold === 'number' &&
      typeof settings.lightOnDuration === 'number' && settings.lightOnDuration > 0 &&
      typeof settings.lightIntervalManual === 'number' && settings.lightIntervalManual > 0 &&
      typeof settings.pumpStartHour === 'number' && settings.pumpStartHour >= 0 && settings.pumpStartHour <= 23 &&
      typeof settings.pumpStartMinute === 'number' && settings.pumpStartMinute >= 0 && settings.pumpStartMinute <= 59 &&
      typeof settings.pumpDuration === 'number' && settings.pumpDuration > 0 &&
      typeof settings.pumpInterval === 'number' && settings.pumpInterval > 0
    ) {
      cropSettings[currentCrop] = {
        ...cropSettings[currentCrop],
        ...settings
      };
      
      console.log('Crop settings updated for', currentCrop, cropSettings[currentCrop]);
      await saveCropSettings();
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid crop settings' });
    }
  } catch (error) {
    console.error('Error in /saveCropSettings:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/deleteCrop', async (req, res) => {
  try {
    const { crop } = req.body;
    
    if (!cropSettings[crop]) {
      return res.status(400).json({ error: 'Crop not found' });
    }
    
    delete cropSettings[crop];
    
    // Если удаляем текущую культуру, устанавливаем первую доступную или 'potato'
    if (currentCrop === crop) {
      const availableCrops = Object.keys(cropSettings);
      currentCrop = availableCrops.length > 0 ? availableCrops[0] : 'potato';
    }
    
    await saveCropSettings();
    res.json({ success: true });
    
  } catch (error) {
    console.error('Error in /deleteCrop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/addCrop', async (req, res) => {
  try {
    const { cropKey, cropName, fanTemperatureThreshold, lightOnDuration, lightIntervalManual, pumpStartHour, pumpStartMinute, pumpDuration, pumpInterval } = req.body;
    
    if (!cropKey || !cropName) {
      return res.status(400).json({ error: 'Crop key and name are required' });
    }
    
    if (cropSettings[cropKey]) {
      return res.status(400).json({ error: 'Crop with this key already exists' });
    }
    
    cropSettings[cropKey] = {
      name: cropName,
      fanTemperatureThreshold: parseFloat(fanTemperatureThreshold) || 25.0,
      lightOnDuration: parseInt(lightOnDuration) * 60000 || 7200000,
      lightIntervalManual: parseInt(lightIntervalManual) * 60000 || 21600000,
      pumpStartHour: parseInt(pumpStartHour) || 8,
      pumpStartMinute: parseInt(pumpStartMinute) || 0,
      pumpDuration: parseInt(pumpDuration) || 15,
      pumpInterval: parseInt(pumpInterval) || 180
    };
    
    currentCrop = cropKey;
    await saveCropSettings();
    console.log('New crop added:', cropKey, cropSettings[cropKey]);
    res.json({ success: true });
  } catch (error) {
    console.error('Error in /addCrop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(port, async () => {
  await loadSensorDataHistory();
  await loadCropSettings(); // Гарантируем загрузку настроек
  
  console.log(`Server running on port ${port}`);
});
