
const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const app = express();
const port = process.env.PORT || 80;
const MAX_HISTORY_HOURS = 48;
const { Octokit } = require("@octokit/rest");
const octokit = new Octokit({ 
  auth: process.env.GITHUB_TOKEN 
});
const REPO_OWNER = "zhanats1230";
const REPO_NAME = "zftre";
const MAX_MINUTE_HISTORY_MINUTES = 24 * 60; // 24 часа в минутах
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
  minuteAverages: [], // вместо hourlyAverages
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

let mode = 'auto';
let cropSettings = {};
let currentCrop = 'potato';

// Загрузка истории данных сенсоров
async function loadSensorDataHistory() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    sensorDataHistory = JSON.parse(data);
    const oneDayAgo = Date.now() - 86400000;
    sensorDataHistory = {
      raw: loadedData.raw || [],
      minuteAverages: loadedData.minuteAverages || loadedData.hourlyAverages || [],
      healthyRanges: loadedData.healthyRanges || {
        temperature: { inRange: 0, total: 0 },
        humidity: { inRange: 0, total: 0 },
        soilMoisture: { inRange: 0, total: 0 }
      }
    };
    sensorDataHistory.raw = sensorDataHistory.raw.filter(entry => entry.timestamp >= oneDayAgo);
    sensorDataHistory.minuteAverages = sensorDataHistory.minuteAverages.filter(entry => entry.timestamp >= oneDayAgo);
    
    console.log(`Loaded ${sensorDataHistory.raw.length} raw entries and ${sensorDataHistory.minuteAverages.length} minute averages`);
  } catch (error) {
    // ... остальной код без изменений
    sensorDataHistory = { 
      raw: [], 
      minuteAverages: [], // изменили здесь
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
    const cutoff = Date.now() - (MAX_MINUTE_HISTORY_MINUTES * 60000);
    const dataToSave = {
      raw: sensorDataHistory.raw.filter(entry => entry.timestamp >= cutoff),
      minuteAverages: sensorDataHistory.minuteAverages.filter(entry => entry.timestamp >= cutoff),
      healthyRanges: sensorDataHistory.healthyRanges
    };
    
    await fs.writeFile(DATA_FILE, JSON.stringify(dataToSave, null, 2));
  } catch (error) {
    console.error('Error saving history:', error);
  }
}


// Загрузка настроек культур
async function loadCropSettings() {
  try {
    const data = await fs.readFile(CROP_SETTINGS_FILE, 'utf8');
    const settings = JSON.parse(data);
    
    cropSettings = settings.crops || {};
    currentCrop = settings.currentCrop || 'potato';
    
    console.log(`Crop settings loaded. Current crop: ${currentCrop}`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No crop settings file found, using defaults');
      cropSettings = {
        potato: {
          name: "Potato",
          fanTemperatureThreshold: 25.0,
          lightOnDuration: 7200000,   // 2 часа
          lightIntervalManual: 21600000, // 6 часов
          pumpStartHour: 8,
          pumpStartMinute: 0,
          pumpDuration: 15,
          pumpInterval: 180
        }
      };
      currentCrop = 'potato';
      await saveCropSettings();
    } else {
      console.error('Error loading crop settings:', error);
    }
  }
}

// Сохранение настроек культур
async function saveCropSettings() {
  try {
    const dataToSave = {
      crops: cropSettings,
      currentCrop: currentCrop
    };
    
    const content = JSON.stringify(dataToSave, null, 2);
    await fs.writeFile(CROP_SETTINGS_FILE, content);
    
    if (process.env.GITHUB_TOKEN) {
      await octokit.repos.createOrUpdateFileContents({ // Исправлен 'repos8786' на 'repos'
        owner: REPO_OWNER,
        repo: REPO_NAME,
        path: CROP_SETTINGS_FILE,
        message: "Update crop settings",
        content: Buffer.from(content).toString('base64'),
        sha: await getFileSha(CROP_SETTINGS_FILE)
      });
    }
    console.log('Crop settings saved');
  } catch (error) {
    console.error('Error saving crop settings:', error);
  }
}

// Получение SHA файла для GitHub
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
function computeMinuteAverages() {
  const cutoff = Date.now() - (MAX_MINUTE_HISTORY_MINUTES * 60000);
  const minuteBuckets = {};
  
  sensorDataHistory.raw = sensorDataHistory.raw.filter(entry => entry.timestamp >= cutoff);

  sensorDataHistory.raw.forEach(entry => {
    const date = new Date(entry.timestamp);
    const minuteKey = `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${date.getHours()}-${date.getMinutes()}`;
    
    if (!minuteBuckets[minuteKey]) {
      minuteBuckets[minuteKey] = {
        temperature: [],
        humidity: [],
        soilMoisture: [],
        timestamp: date.setSeconds(0, 0) // Округляем до минуты
      };
    }
    
    minuteBuckets[minuteKey].temperature.push(entry.temperature);
    minuteBuckets[minuteKey].humidity.push(entry.humidity);
    minuteBuckets[minuteKey].soilMoisture.push(entry.soilMoisture);
  });

  sensorDataHistory.minuteAverages = Object.keys(minuteBuckets).map(key => {
    const bucket = minuteBuckets[key];
    return {
      timestamp: bucket.timestamp,
      temperature: bucket.temperature.length ? bucket.temperature.reduce((sum, val) => sum + val, 0) / bucket.temperature.length : 0,
      humidity: bucket.humidity.length ? bucket.humidity.reduce((sum, val) => sum + val, 0) / bucket.humidity.length : 0,
      soilMoisture: bucket.soilMoisture.length ? bucket.soilMoisture.reduce((sum, val) => sum + val, 0) / bucket.soilMoisture.length : 0
    };
  });

  // Сортируем по времени
  sensorDataHistory.minuteAverages.sort((a, b) => a.timestamp - b.timestamp);
}
// Вычисление средних значений
function computeHourlyAverages() {
  const cutoff = Date.now() - (MAX_HISTORY_HOURS * 3600000);
  const oneDayAgo = Date.now() - 86400000;
  const hourlyBuckets = {};
  sensorDataHistory.raw = sensorDataHistory.raw.filter(entry => entry.timestamp >= cutoff);

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

// HTML и клиентский JavaScript
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
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
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
    /* Добавьте в секцию стилей */
.aspect-w-16 {
  position: relative;
  padding-bottom: 56.25%; /* 16:9 Aspect Ratio */
}

.aspect-h-9 {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

#cameraStream {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background-color: #000;
}
    .btn:hover {
      transform: scale(1.05);
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
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
    .chart-container {
  position: relative;
  height: 70vh;
  width: 100%;
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
      margin-right: 10px;
    }
    .ripple-btn:hover {
      transform: scale(1.05);
      box-shadow: 0 6px 12px rgba(20, 184, 166, 0.3);
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
        <button id="toggleMode" class="bg-teal-500 text-white px-4 py-2 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-sync mr-2"></i> Переключить режим</button>
        <div id="connectionIndicator" class="connection-indicator offline"><i class="fa-solid fa-wifi-slash"></i> Offline</div>
        <button id="logoutButton" class="logout-btn text-white px-4 py-2 rounded-lg"><i class="fa-solid fa-sign-out-alt mr-2"></i> Logout</button>
      </div>
    </div>

    <!-- Tabs Navigation -->
    <div class="flex border-b border-gray-200 mb-8">
      <button id="tabDashboard" class="tab flex-1 py-3 px-4 text-center text-gray-600 font-semibold hover:bg-gray-100 active">Панель инструментов</button>
      <button id="tabRelays" class="tab flex-1 py-3 px-4 text-center text-gray-600 font-semibold hover:bg-gray-100">Реле</button>
      <button id="tabSettings" class="tab flex-1 py-3 px-4 text-center text-gray-600 font-semibold hover:bg-gray-100">Настройки</button>
      <button id="tabCamera" class="tab flex-1 py-3 px-4 text-center text-gray-600 font-semibold hover:bg-gray-100">Камера</button>
    </div>

    <!-- Tab Content -->
    <div id="dashboardContent" class="tab-content">
      <!-- System Status -->
      <div class="mb-8">
        <div class="bg-white p-6 rounded-2xl shadow-lg card">
          <div class="section-header">
            <h3 class="text-xl font-semibold"><i class="fa-solid fa-gauge mr-2"></i> Состояние системы</h3>
          </div>
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <p class="mb-3">Режим: <span id="currentMode" class="status-badge bg-gray-100 text-gray-800">—</span></p>
            <p class="mb-3">Освещение: <span id="relayState1" class="status-badge bg-gray-100 text-gray-800">—</span></p>
            <p class="mb-3">Вентиляция: <span id="relayState2" class="status-badge bg-gray-100 text-gray-800">—</span></p>
          </div>
        </div>
      </div>

      <!-- Sensors -->
      <div class="mb-8">
        <div class="section-header" style="margin: 0 0 1.5rem;">
          <h3 class="text-xl font-semibold"><i class="fa-solid fa-thermometer mr-2"></i> Датчики окружающей среды</h3>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div class="bg-white p-6 rounded-2xl shadow-lg card">
            <h3 class="text-lg font-semibold text-gray-900 mb-2"><i class="fa-solid fa-temperature-high mr-2 text-teal-500"></i> Температура</h3>
            <p class="text-2xl font-bold" id="temperature">— °C</p>
            <div class="progress-bar mt-2"><div id="temperatureProgress" class="progress-bar-fill" style="width: 0%;"></div></div>
            <button id="tempChartBtn" class="mt-4 bg-teal-500 text-white px-4 py-2 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-chart-line mr-2"></i> Просмотр графика</button>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-lg card">
            <h3 class="text-lg font-semibold text-gray-900 mb-2"><i class="fa-solid fa-tint mr-2 text-teal-500"></i> Влажность</h3>
            <p class="text-2xl font-bold" id="humidity">— %</p>
            <div class="progress-bar mt-2"><div id="humidityProgress" class="progress-bar-fill" style="width: 0%;"></div></div>
            <button id="humidityChartBtn" class="mt-4 bg-teal-500 text-white px-4 py-2 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-chart-line mr-2"></i> Просмотр графика</button>
          </div>
          <div class="bg-white p-6 rounded-2xl shadow-lg card">
            <h3 class="text-lg font-semibold text-gray-900 mb-2"><i class="fa-solid fa-seedling mr-2 text-teal-500"></i> Влажность почвы</h3>
            <p class="text-2xl font-bold" id="soilMoisture">— %</p>
            <div class="progress-bar mt-2"><div id="soilMoistureProgress" class="progress-bar-fill" style="width: 0%;"></div></div>
            <button id="soilMoistureChartBtn" class="mt-4 bg-teal-500 text-white px-4 py-2 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-chart-line mr-2"></i> Просмотр графика</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Chart Modals -->
    <div id="tempModal" class="modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center hidden modal-overlay">
      <div class="bg-white p-6 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-semibold text-gray-900"><i class="fa-solid fa-temperature-high mr-2 text-teal-500"></i> Temperature Trends (24h)</h3>
          <button id="closeTempModal" class="text-gray-600 hover:text-gray-900 text-2xl"><i class="fa-solid fa-times"></i></button>
        </div>
        <div class="chart-container flex-grow">
          <canvas id="tempChart"></canvas>
        </div>
      </div>
    </div>
    <div id="humidityModal" class="modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center hidden modal-overlay">
      <div class="bg-white p-6 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-semibold text-gray-900"><i class="fa-solid fa-tint mr-2 text-teal-500"></i> Humidity Trends (24h)</h3>
          <button id="closeHumidityModal" class="text-gray-600 hover:text-gray-900 text-2xl"><i class="fa-solid fa-times"></i></button>
        </div>
        <div class="chart-container flex-grow">
          <canvas id="humidityChart"></canvas>
        </div>
      </div>
    </div>
    <div id="soilMoistureModal" class="modal fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center hidden modal-overlay">
      <div class="bg-white p-6 rounded-2xl w-full max-w-4xl h-[80vh] flex flex-col">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-semibold text-gray-900"><i class="fa-solid fa-seedling mr-2 text-teal-500"></i> Soil Moisture Trends (24h)</h3>
          <button id="closeSoilMoistureModal" class="text-gray-600 hover:text-gray-900 text-2xl"><i class="fa-solid fa-times"></i></button>
        </div>
        <div class="chart-container flex-grow">
          <canvas id="soilMoistureChart"></canvas>
        </div>
      </div>
    </div>

    <div id="relaysContent" class="tab-content hidden">
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Lighting -->
        <div class="bg-white p-6 rounded-2xl shadow-lg card">
          <h3 class="text-xl font-semibold text-gray-900 mb-4"><i class="fa-solid fa-lightbulb mr-2 text-teal-500"></i> Освещение</h3>
          <p id="relayState1Control" class="text-lg mb-4">Освещение: —</p>
          <button id="toggleRelay1" class="w-full bg-teal-500 text-white p-3 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-power-off mr-2"></i> Переключить</button>
        </div>
        <!-- Ventilation -->
        <div class="bg-white p-6 rounded-2xl shadow-lg card">
          <h3 class="text-xl font-semibold text-gray-900 mb-4"><i class="fa-solid fa-fan mr-2 text-teal-500"></i> Вентиляция</h3>
          <p id="relayState2Control" class="text-lg mb-4">Вентиляция: —</p>
          <button id="toggleRelay2" class="w-full bg-teal-500 text-white p-3 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-power-off mr-2"></i> Переключить</button>
        </div>
      </div>
    </div>

    <div id="settingsContent" class="tab-content hidden">
      <!-- Crop Selection -->
      <div class="bg-white p-6 rounded-2xl shadow-lg card mb-8">
        <div class="section-header">
          <i class="fa-solid fa-seedling"></i>
          <h3>Выбор культуры</h3>
        </div>
        <div class="grid grid-cols-1 gap-6">
          <div>
            <label class="block text-gray-700 font-bold mb-2" for="cropSelect">Выбрать культуру</label>
            <select id="cropSelect" class="crop-select"></select>
          </div>
          <div id="customCropFields" class="hidden">
            <div class="grid grid-cols-1 gap-4">
              <div>
                <label class="block text-gray-700 font-bold mb-2" for="newCropName">Название культуры</label>
                <input id="newCropName" type="text" class="w-full p-2 border border-gray-300 rounded-lg" placeholder="Enter crop name">
              </div>
              <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label class="block text-gray-700 font-bold mb-2" for="newCropKey">Ключ культуры</label>
                  <input id="newCropKey" type="text" class="w-full p-2 border border-gray-300 rounded-lg" placeholder="Unique key (e.g. custom_crop)">
                </div>
              </div>
            </div>
          </div>
          <div class="flex justify-end">
            <button id="applyCrop" class="ripple-btn"><i class="fa-solid fa-check mr-2"></i> Применить настройки </button>
            <button id="deleteCrop" class="logout-btn ripple-btn"><i class="fa-solid fa-trash mr-2"></i> Удалить культуру</button>
          </div>
        </div>
      </div>

      <!-- Crop Settings Editor -->
      <div class="bg-white p-6 rounded-2xl shadow-lg card mb-8">
        <div class="section-header">
          <i class="fa-solid fa-sliders-h"></i>
          <h3>Редактор настроек культур</h3>
        </div>
        <div class="mb-4">
          <p class="text-gray-700">Текущая культура: <span id="currentCropName" class="crop-badge">Potato</span></p>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-8">
          <div class="input-card">
            <label class="input-label">Порог температуры (°C)</label>
            <div class="icon-circle"><i class="fa-solid fa-temperature-half"></i></div>
            <input id="cropFanTemperatureThreshold" type="number" step="0.1" value="25.0" placeholder="Enter °C">
          </div>
          <div class="input-card">
            <label class="input-label">Продолжительность освещения (мин)</label>
            <div class="icon-circle"><i class="fa-solid fa-sun"></i></div>
            <input id="cropLightOnDuration" type="number" value="120" placeholder="Enter minutes">
          </div>
          <div class="input-card">
            <label class="input-label">Интервал освещения (мин)</label>
            <div class="icon-circle"><i class="fa-solid fa-clock-rotate-left"></i></div>
            <input id="cropLightIntervalManual" type="number" value="360" placeholder="Enter minutes">
          </div>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-8 mt-4">
          <div class="input-card">
            <label class="input-label">Часы запуска насоса</label>
            <div class="icon-circle"><i class="fa-solid fa-clock"></i></div>
            <input id="cropPumpStartHour" type="number" min="0" max="23" value="8" placeholder="0-23">
          </div>
          <div class="input-card">
            <label class="input-label">Минута запуска насоса</label>
            <div class="icon-circle"><i class="fa-solid fa-clock"></i></div>
            <input id="cropPumpStartMinute" type="number" min="0" max="59" value="0" placeholder="0-59">
          </div>
          <div class="input-card">
            <label class="input-label">Время работы насоса (сек)</label>
            <div class="icon-circle"><i class="fa-solid fa-stopwatch-20"></i></div>
            <input id="cropPumpDuration" type="number" min="1" value="15" placeholder="Seconds">
          </div>
          <div class="input-card">
            <label class="input-label">Интервал работы насоса (мин)</label>
            <div class="icon-circle"><i class="fa-solid fa-hourglass-half"></i></div>
            <input id="cropPumpInterval" type="number" min="1" value="180" placeholder="Minutes">
          </div>
        </div>
        <div class="wave-divider"></div>
        <div class="flex justify-between mt-4">
          <button id="saveCropSettings" class="ripple-btn"><i class="fa-solid fa-save mr-2"></i> Сохранить настройки</button>
          
        </div>
      </div>
    </div>
    <div id="cameraContent" class="tab-content hidden">
  <div class="bg-white p-6 rounded-2xl shadow-lg card">
    <div class="section-header">
      <i class="fa-solid fa-video"></i>
      <h3>Просмотр теплицы</h3>
    </div>
    
    <div class="aspect-w-16 aspect-h-9 mb-4">
      <img id="cameraStream" src="" class="w-full h-auto rounded-lg" alt="Live feed">
    </div>
    
    <div class="flex justify-between">
      <button id="backFromCamera" class="ripple-btn">
        <i class="fa-solid fa-arrow-left mr-2"></i> Назад
      </button>
      <button id="refreshCamera" class="ripple-btn">
        <i class="fa-solid fa-rotate mr-2"></i> Обновить
      </button>
    </div>
  </div>
</div>

    <script>
      const correctPassword = 'admin';

      function handleLogin() {
        const passwordInput = document.getElementById('passwordInput');
        const passwordError = document.getElementById('passwordError');
        const passwordSection = document.getElementById('passwordSection');
        const controlSection = document.getElementById('controlSection');

        const password = passwordInput.value.trim().toLowerCase();
        if (password === correctPassword.toLowerCase()) {
          localStorage.setItem('isLoggedIn', 'true');
          passwordSection.classList.add('hidden');
          controlSection.classList.remove('hidden');
          passwordInput.value = '';
          passwordError.classList.add('hidden');
          initializeApp();
        } else {
          passwordError.classList.remove('hidden');
          alert('Incorrect password, please try again.');
        }
      }

      function handleLogout() {
        localStorage.removeItem('isLoggedIn');
        const passwordSection = document.getElementById('passwordSection');
        const controlSection = document.getElementById('controlSection');
        controlSection.classList.add('hidden');
        passwordSection.classList.remove('hidden');
      }

      function setupLoginListeners() {
        const submitButton = document.getElementById('submitPassword');
        const passwordInput = document.getElementById('passwordInput');

        submitButton.addEventListener('click', handleLogin);
        passwordInput.addEventListener('keypress', (e) => {
          if (e.key === 'Enter') {
            handleLogin();
          }
        });
      }
function initChart(ctx, label, color) {
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: label,
        data: [],
        borderColor: color,
        backgroundColor: color + '20',
        fill: true,
        tension: 0.4,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 500 },
      scales: {
        x: { display: true, title: { text: 'Time' }},
        y: { display: true, title: { text: 'Value' }}
      }
    }
  });
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
          } else {
            indicator.classList.remove('online');
            indicator.classList.add('offline');
            indicator.innerHTML = '<i class="fa-solid fa-wifi-slash"></i> Offline';
          }
        } catch (error) {
          indicator.classList.remove('online');
          indicator.classList.add('offline');
          indicator.innerHTML = '<i class="fa-solid fa-wifi-slash"></i> Offline';
        }
      }

      const tabs = {
        dashboard: document.getElementById('dashboardContent'),
        relays: document.getElementById('relaysContent'),
        settings: document.getElementById('settingsContent')
        camera: document.getElementById('cameraContent')
      };
      const tabButtons = {
        dashboard: document.getElementById('tabDashboard'),
        relays: document.getElementById('tabRelays'),
        settings: document.getElementById('tabSettings')
        camera: document.getElementById('tabCamera')
      };
const CAMERA_URL = "http://192.168.10.4"; 
function startCameraStream() {
  const stream = document.getElementById('cameraStream');
  stream.src = CAMERA_URL + '?t=' + Date.now();
}
document.getElementById('refreshCamera').addEventListener('click', startCameraStream);
document.getElementById('backFromCamera').addEventListener('click', () => switchTab('dashboard'));
// Функция остановки потока
function stopCameraStream() {
  const stream = document.getElementById('cameraStream');
  stream.src = "";
}
      function switchTab(tabName) {
        Object.values(tabs).forEach(tab => tab.classList.add('hidden'));
        Object.values(tabButtons).forEach(btn => btn.classList.remove('active'));
        tabs[tabName].classList.remove('hidden');
        tabButtons[tabName].classList.add('active');
        if (tabName === 'camera') {
    startCameraStream();
  } else {
    stopCameraStream();
  }
      }

      Object.keys(tabButtons).forEach(tabName => {
        tabButtons[tabName].addEventListener('click', () => switchTab(tabName));
      });

      let tempChart, humidityChart, soilMoistureChart;

      function initializeCharts() {
  const ctxTemp = document.getElementById('tempChart').getContext('2d');
  const ctxHumidity = document.getElementById('humidityChart').getContext('2d');
  const ctxSoilMoisture = document.getElementById('soilMoistureChart').getContext('2d');

  const commonOptions = {
    responsive: true,
    animation: {
      duration: 1000,
      easing: 'easeOutQuart'
    },
    scales: {
      x: {
        title: { display: true, text: 'Time' },
        grid: { display: false }
      },
      y: {
        beginAtZero: false,
        title: { display: true },
        grid: { color: 'rgba(0, 0, 0, 0.05)' }
      }
    },
    plugins: {
      legend: { display: true },
      tooltip: {
        mode: 'index',
        intersect: false,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        padding: 10,
        cornerRadius: 4,
        callbacks: {
          label: function(tooltipItem) {
            return tooltipItem.dataset.label + ": " + tooltipItem.raw.toFixed(1);
          }
        }
      }
    },
    interaction: { mode: 'nearest', axis: 'x', intersect: false },
    elements: {
      line: { tension: 0.4, borderWidth: 3 },
      point: { radius: 4, hoverRadius: 6 }
    }
  };

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
        pointBackgroundColor: '#14b8a6',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: '#14b8a6'
      }]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: {
          ...commonOptions.scales.y,
          title: { ...commonOptions.scales.y.title, text: 'Temperature (°C)' },
          ticks: {
            callback: function(value) {
              return value.toFixed(1);
            }
          }
        }
      }
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
        pointBackgroundColor: '#3b82f6',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: '#3b82f6'
      }]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: {
          ...commonOptions.scales.y,
          title: { ...commonOptions.scales.y.title, text: 'Humidity (%)' },
          ticks: {
            callback: function(value) {
              return value.toFixed(1);
            }
          }
        }
      }
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
        pointBackgroundColor: '#10b981',
        pointBorderColor: '#fff',
        pointHoverBackgroundColor: '#fff',
        pointHoverBorderColor: '#10b981'
      }]
    },
    options: {
      ...commonOptions,
      scales: {
        ...commonOptions.scales,
        y: {
          ...commonOptions.scales.y,
          title: { ...commonOptions.scales.y.title, text: 'Soil Moisture (%)' },
          ticks: {
            callback: function(value) {
              return value.toFixed(1);
            }
          }
        }
      }
    }
  });
}

      async function updateChartData(chartType) {
  try {
    const response = await fetch('/getChartData');
    const data = await response.json();
    
    const labels = data.map(entry => entry.timeLabel);
    let chart, values;
    switch(chartType) {
      case 'temperature':
        chart = tempChart;
        values = data.map(entry => entry.temperature);
        break;
      case 'humidity':
        chart = humidityChart;
        values = data.map(entry => entry.humidity);
        break;
      case 'soilMoisture':
        chart = soilMoistureChart;
        values = data.map(entry => entry.soilMoisture);
        break;
    }

    if (chart) {
      chart.data.labels = labels;
      chart.data.datasets[0].data = values;
      chart.update();
    } else {
      console.error('Chart not initialized for:', chartType);
    }
  } catch (error) {
    console.error('Error updating chart:', error);
  }
}
      function toggleModal(modalId, chartType) {
  const modal = document.getElementById(modalId);
  
  if (!modal.classList.contains('show')) {
    modal.classList.remove('hidden');
    setTimeout(() => {
      modal.classList.add('show');
      updateChartData(chartType);
    }, 10);
  } else {
    modal.classList.remove('show');
    setTimeout(() => modal.classList.add('hidden'), 300);
  }
}


      async function loadCropSettings() {
        try {
          const response = await fetch('/getCropSettings');
          return await response.json();
        } catch (error) {
          console.error('Error loading crop settings:', error);
          return {
            currentCropKey: 'potato',
            availableCrops: {
              potato: {
                name: "Potato",
                fanTemperatureThreshold: 25.0,
                lightOnDuration: 7200000,
                lightIntervalManual: 21600000,
                pumpStartHour: 8,
                pumpStartMinute: 0,
                pumpDuration: 15,
                pumpInterval: 180
              }
            }
          };
        }
      }

      async function updateCropDropdown(cropData) {
        const cropSelect = document.getElementById('cropSelect');
        const currentCropName = document.getElementById('currentCropName');
        cropSelect.innerHTML = '';

        const crops = cropData.availableCrops || {};
        const cropKeys = Object.keys(crops);

        if (cropKeys.length === 0) {
          const option = document.createElement('option');
          option.value = '';
          option.textContent = 'No crops available';
          option.disabled = true;
          cropSelect.appendChild(option);
        } else {
          cropKeys.forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = crops[key].name || key;
            if (key === cropData.currentCrop) {
              option.selected = true;
            }
            cropSelect.appendChild(option);
          });
        }

        const customOption = document.createElement('option');
        customOption.value = 'custom';
        customOption.textContent = 'Custom Crop...';
        cropSelect.appendChild(customOption);

         currentCropName.textContent = crops[cropData.currentCrop]?.name || 'Unknown';
        await loadCurrentCropSettings(cropData.currentCropKey);
      }

      async function loadCurrentCropSettings(cropKey) {
  try {
    const response = await fetch('/getCurrentCropSettings');
    const data = await response.json();
    if (data.settings) {
      document.getElementById('cropFanTemperatureThreshold').value = parseFloat(data.settings.fanTemperatureThreshold || 25.0).toFixed(1);
      document.getElementById('cropLightOnDuration').value = parseInt(data.settings.lightOnDuration || 7200000) / 60000; // Convert ms to minutes
      document.getElementById('cropLightIntervalManual').value = parseInt(data.settings.lightIntervalManual || 21600000) / 60000; // Convert ms to minutes
      document.getElementById('cropPumpStartHour').value = parseInt(data.settings.pumpStartHour || 8);
      document.getElementById('cropPumpStartMinute').value = parseInt(data.settings.pumpStartMinute || 0);
      document.getElementById('cropPumpDuration').value = parseInt(data.settings.pumpDuration || 15);
      document.getElementById('cropPumpInterval').value = parseInt(data.settings.pumpInterval || 180);
    }
  } catch (error) {
    console.error('Error loading current crop settings:', error);
  }
}

      async function applyCropSettings() {
  const cropSelect = document.getElementById('cropSelect');
  const selectedCrop = cropSelect.value;

  if (selectedCrop === 'custom') {
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
          fanTemperatureThreshold: parseFloat(document.getElementById('cropFanTemperatureThreshold').value) || 25.0,
          lightOnDuration: parseInt(document.getElementById('cropLightOnDuration').value) * 60000, // Already in minutes, convert to ms
          lightIntervalManual: parseInt(document.getElementById('cropLightIntervalManual').value) * 60000, // Already in minutes, convert to ms
          pumpStartHour: parseInt(document.getElementById('cropPumpStartHour').value) || 8,
          pumpStartMinute: parseInt(document.getElementById('cropPumpStartMinute').value) || 0,
          pumpDuration: parseInt(document.getElementById('cropPumpDuration').value) || 15,
          pumpInterval: parseInt(document.getElementById('cropPumpInterval').value) || 180
        })
      });

      if (response.ok) {
        alert('New crop created!');
        const customFields = document.getElementById('customCropFields');
        customFields.classList.add('hidden');
        document.getElementById('newCropKey').value = '';
        document.getElementById('newCropName').value = '';
        const cropData = await loadCropSettings();
        await updateCropDropdown(cropData);
        await loadCurrentCropSettings(cropKey); // Ensure settings are loaded for new crop
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to create crop');
      }
    } catch (error) {
      console.error('Error creating crop:', error);
      alert('Error creating crop');
    }
  } else {
    try {
      const response = await fetch('/setCurrentCrop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ crop: selectedCrop })
      });

      if (response.ok) {
        alert('Crop applied!');
        const cropData = await loadCropSettings();
        await updateCropDropdown(cropData);
        await loadCurrentCropSettings(selectedCrop); // Ensure settings for selected crop
      } else {
        const error = await response.json();
        alert(error.error || 'Failed to apply crop');
      }
    } catch (error) {
      console.error('Error applying crop:', error);
      alert('Error applying crop');
    }
  }
}

      async function saveCropSettingsClient() {
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
              headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
              alert('Crop deleted successfully!');
              const cropData = await loadCropSettings();
              await updateCropDropdown(cropData);
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
          document.getElementById('temperature').textContent = data.temperature.toFixed(1) + ' °C';
          document.getElementById('humidity').textContent = data.humidity.toFixed(1) + ' %';
          document.getElementById('soilMoisture').textContent = data.soilMoisture.toFixed(1) + ' %';

          document.getElementById('temperatureProgress').style.width = Math.min((data.temperature / 40) * 100, 100) + '%';
          document.getElementById('humidityProgress').style.width = Math.min(data.humidity, 100) + '%';
          document.getElementById('soilMoistureProgress').style.width = Math.min(data.soilMoisture, 100) + '%';
        } catch (error) {
          console.error('Error fetching sensor data:', error);
        }
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

      async function initializeApp() {
        switchTab('dashboard');
        initializeCharts();
        updateRelayState();
        updateSensorData();
        updateMode();
        checkConnection();
        
await updateChartData('temperature');
  await updateChartData('humidity');
  await updateChartData('soilMoisture');
        const cropData = await loadCropSettings();
        await updateCropDropdown(cropData);

        document.getElementById('toggleRelay1').addEventListener('click', () => toggleRelay(1));
        document.getElementById('toggleRelay2').addEventListener('click', () => toggleRelay(2));
        document.getElementById('toggleMode').addEventListener('click', toggleMode);
        document.getElementById('applyCrop').addEventListener('click', applyCropSettings);
        document.getElementById('saveCropSettings').addEventListener('click', saveCropSettingsClient);
        document.getElementById('deleteCrop').addEventListener('click', deleteCurrentCrop);

        document.getElementById('cropSelect').addEventListener('change', function() {
          const customFields = document.getElementById('customCropFields');
          if (this.value === 'custom') {
            customFields.classList.remove('hidden');
            document.getElementById('newCropKey').value = '';
            document.getElementById('newCropName').value = '';
          } else {
            customFields.classList.add('hidden');
            loadCurrentCropSettings(this.value);
          }
        });

        // Обновление обработчиков кнопок
document.getElementById('tempChartBtn').addEventListener('click', () => toggleModal('tempModal', 'temperature'));
document.getElementById('humidityChartBtn').addEventListener('click', () => toggleModal('humidityModal', 'humidity'));
document.getElementById('soilMoistureChartBtn').addEventListener('click', () => toggleModal('soilMoistureModal', 'soilMoisture'));
        document.getElementById('closeTempModal').addEventListener('click', () => toggleModal('tempModal', false));
        document.getElementById('closeHumidityModal').addEventListener('click', () => toggleModal('humidityModal', false));
        document.getElementById('closeSoilMoistureModal').addEventListener('click', () => toggleModal('soilMoistureModal', false));

        setInterval(updateSensorData, 5000);
        setInterval(updateRelayState, 5000);
        setInterval(updateMode, 5000);
        setInterval(checkConnection, 10000);
        setInterval(updateChartData, 1000); // Обновляем графики каждые 60 секунд
      }

      document.addEventListener('DOMContentLoaded', () => {
        setupLoginListeners();
        const isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
        const passwordSection = document.getElementById('passwordSection');
        const controlSection = document.getElementById('controlSection');

        if (isLoggedIn) {
          passwordSection.classList.add('hidden');
          controlSection.classList.remove('hidden');
          initializeApp();
        }

        const logoutButton = document.getElementById('logoutButton');
        logoutButton.addEventListener('click', handleLogout);
      });
    </script>
</body>
</html>
`);
});

// API Endpoints
app.get('/getSensorStatus', (req, res) => {
  try {
    const now = new Date();
    const isOnline = now - lastSensorUpdate < 30000;
    console.log('isOnline:', isOnline);
    res.json({ isOnline: isOnline });
  } catch (error) {
    console.error('Error in /getSensorStatus:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/getCropsList', async (req, res) => {
  try {
        const cropsList = Object.keys(cropSettings).map(key => ({
            key: key,
            name: cropSettings[key].name || key
        }));
        console.log('Crop List:', JSON.stringify(cropList));
        res.json(cropList);
    } catch (error) {
        console.error('Error in /getCropsList:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/getCurrentCropSettings', async (req, res) => {
  try {
        await loadCropSettings();
        const settings = { 
            currentCrop: currentCrop, 
            settings: cropSettings[currentCrop] || {}
        };
        console.log('Current Crop Settings:', JSON.stringify(settings));
        res.json(settings);
    } catch (error) {
        console.error('Error in /getCurrentCropSettings:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/getRelayState', (req, res) => {
  try {
    console.log('Relay State:', JSON.stringify(relayState));
    res.json(relayState);
  } catch (error) {
    console.error('Error in /getRelayState:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/getSensorData', (req, res) => {
  try {
    console.log('Sensor Data:', JSON.stringify(sensorData));
    res.json(sensorData);
  } catch (error) {
    console.error('Error in /getSensorData:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/updateSensorData', async (req, res) => {
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
      lastSensorUpdate = Date.now(); // обновляем глобальную переменную

     sensorDataHistory.raw.push({
      temperature,
      humidity,
      soilMoisture,
      timestamp: lastSensorUpdate
    });


      // Удаляем старые записи
      const oneDayAgo = Date.now() - 86400000;
      sensorDataHistory.raw = sensorDataHistory.raw.filter(entry => entry.timestamp >= oneDayAgo);

       computeMinuteAverages();
      updateHealthyRanges({ temperature, humidity, soilMoisture });
      await saveSensorDataHistory();

      console.log('Sensor Data Updated:', JSON.stringify(sensorData));
      res.json({ success: true });
    } else {
      throw new Error('Invalid data format');
    }
  } catch (error) {
    console.error('Error updating sensor data:', error);
    res.status(400).json({ error: 'Invalid sensor data' });
  }
});

app.get('/getSensorTrends', (req, res) => {
  try {
    const oneDayAgo = Date.now() - 86400000;

    const trendsData = {
      hourlyAverages: sensorDataHistory.hourlyAverages.filter(entry => entry.timestamp >= oneDayAgo),
      healthyRanges: {
        temperature:
          sensorDataHistory.healthyRanges.temperature.total > 0
            ? (sensorDataHistory.healthyRanges.temperature.inRange /
              sensorDataHistory.healthyRanges.temperature.total) * 100
            : 0,
        humidity:
          sensorDataHistory.healthyRanges.humidity.total > 0
            ? (sensorDataHistory.healthyRanges.humidity.inRange /
              sensorDataHistory.healthyRanges.humidity.total) * 100
            : 0,
        soilMoisture:
          sensorDataHistory.healthyRanges.soilMoisture.total > 0
            ? (sensorDataHistory.healthyRanges.soilMoisture.inRange /
              sensorDataHistory.healthyRanges.soilMoisture.total) * 100
            : 0
      }
    };

    console.log('Trends Data:', JSON.stringify(trendsData, null, 2));
    res.json(trendsData);
  } catch (error) {
    console.error('Error in /getSensorTrends:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

   app.get('/getChartData', async (req, res) => {
  try {
    const oneDayAgo = Date.now() - 86400000;

    // Получаем минутные данные
    const minuteData = sensorDataHistory.minuteAverages.filter(entry => entry.timestamp >= oneDayAgo);

    // Форматируем данные для графика
    const chartData = minuteData.map(entry => ({
      timestamp: entry.timestamp,
      timeLabel: new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      temperature: entry.temperature,
      humidity: entry.humidity,
      soilMoisture: entry.soilMoisture
    }));

    chartData.sort((a, b) => a.timestamp - b.timestamp);

    console.log('Chart Data:', JSON.stringify(chartData, null, 2));
    res.json(chartData);
  } catch (error) {
    console.error('Error in /getChartData:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/getMode', (req, res) => {
  try {
    console.log('Mode:', mode);
    res.json({ mode: mode });
  } catch (error) {
    console.error('Error in /getMode:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/setMode', (req, res) => {
  try {
    const { mode: newMode } = req.body;
    if (newMode === 'auto' || newMode === 'manual') {
      mode = newMode;
      console.log('Mode set to:', newMode);
      res.json({ success: true });
    } else {
      console.error('Invalid mode:', newMode);
      res.status(400).json({ error: 'Invalid mode' });
    }
  } catch (error) {
    console.error('Error in /setMode:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/toggleRelay/:relayNumber', async (req, res) => {
  try {
    const relayNumber = parseInt(req.params.relayNumber);
    if (relayNumber === 1 || relayNumber === 2) {
      if (mode === 'manual') {
        relayState['relayState' + relayNumber] = !relayState['relayState' + relayNumber];
console.log('Relay ' + relayNumber + ' toggled to:', relayState['relayState' + relayNumber]);
        res.json({ success: true });
      } else {
        console.error('Cannot toggle relay in auto mode');
        res.status(400).json({ error: 'Cannot toggle relay in auto mode' });
      }
    } else {
      console.error('Invalid relay number:', relayNumber);
      res.status(400).json({ error: 'Invalid relay number' });
    }
  } catch (error) {
    console.error('Error in /toggleRelay:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/getPumpSettings', async (req, res) => {
  try {
    await loadCropSettings();
    const settings = cropSettings[currentCrop] || {};
    console.log('Pump Settings:', JSON.stringify(settings));
    res.json(settings);
  } catch (error) {
    console.error('Error in /getPumpSettings:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/updatePumpSettings', async (req, res) => {
  try {
    const { pumpStartHour, pumpStartMinute, pumpDuration, pumpInterval } = req.body;

    if (
      Number.isInteger(pumpStartHour) &&
      pumpStartHour >= 0 &&
      Number.isInteger(pumpStartMinute) &&
      typeof pumpDuration === 'number' &&
      typeof pumpInterval === 'number' &&
      pumpInterval > 0
    ) {
      cropSettings[currentCrop] = {
        ...cropSettings[currentCrop],
        pumpStartHour,
        pumpStartMinute,
        pumpDuration,
        pumpInterval
      };
      
      await saveCropSettings();
      console.log('Pump settings updated:', JSON.stringify(cropSettings[currentCrop]));
      res.json({ success: true });
    } else {
      console.error('Invalid pump settings:', JSON.stringify(req.body));
      res.status(400).json({ error: 'Invalid pump settings' });
    }
  } catch (error) {
    console.error('Error in /updatePumpSettings:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.get('/getLightingSettings', async (req, res) => {
  try {
    await loadCropSettings();
    const settings = cropSettings[currentCrop] || {};
    console.log('Lighting Settings:', JSON.stringify(settings));
    res.json(settings);
  } catch (error) {
    console.error('Error in /getLightingSettings:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

app.post('/updateLightingSettings', async (req, res) => {
    try {
        const { fanTemperatureThreshold, lightOnDuration, lightIntervalManual } = req.body;

        if (
            typeof fanTemperatureThreshold === 'number' &&
            typeof lightOnDuration === 'number' &&
            typeof lightIntervalManual === 'number'
        ) {
            cropSettings[currentCrop] = {
                ...cropSettings[currentCrop],
                fanTemperatureThreshold,
                lightOnDuration,
                lightIntervalManual
            };
            
            await saveCropSettings();
            console.log('Lighting settings updated:', JSON.stringify(cropSettings[currentCrop]));
            res.json({ success: true });
        } else {
            console.error('Invalid lighting settings:', JSON.stringify(req.body));
            res.status(400).json({ error: 'Invalid lighting settings' });
        }
    } catch (error) {
        console.error('Error in /updateLightingSettings:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.get('/getCropSettings', async (req, res) => {
    try {
        await loadCropSettings();
        const cropData = {
            currentCrop: currentCrop,
            availableCrops: cropSettings
        };
        console.log('Crop settings:', JSON.stringify(cropData));
        res.json(cropData);
    } catch (error) {
        console.error('Error in /getCropSettings:', error);
        res.status(500).json({ 
            error: 'Internal Server Error',
            currentCropKey: 'potato',
            availableCrops: cropSettings
        });
    }
});

app.post('/setCurrentCrop', async (req, res) => {
    try {
        const { crop } = req.body;
        if (cropSettings[crop]) {
            currentCrop = crop;
            console.log('Current crop set to:', crop);
            await saveCropSettings();
            res.json({ success: true });
        } else {
            console.error('Invalid crop selection:', crop);
            res.status(400).json({ error: 'Invalid crop selection' });
        }
    } catch (error) {
        console.error('Error in /setCurrentCrop:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/saveCropSettings', async (req, res) => {
    try {
        const settings = req.body;

        const {
            fanTemperatureThreshold,
            lightOnDuration,
            lightIntervalManual,
            pumpStartHour,
            pumpStartMinute,
            pumpDuration,
            pumpInterval
        } = settings;

        const isValidNumber = (val) => typeof val === 'number' && !isNaN(val);

        if (
            isValidNumber(fanTemperatureThreshold) &&
            isValidNumber(lightOnDuration) && lightOnDuration > 0 &&
            isValidNumber(lightIntervalManual) && lightIntervalManual > 0 &&
            isValidNumber(pumpStartHour) && pumpStartHour >= 0 && pumpStartHour < 24 &&
            isValidNumber(pumpStartMinute) && pumpStartMinute >= 0 && pumpStartMinute < 60 &&
            isValidNumber(pumpDuration) && pumpDuration > 0 &&
            isValidNumber(pumpInterval) && pumpInterval > 0
        ) {
            cropSettings[currentCrop] = {
                ...cropSettings[currentCrop],
                ...settings
            };

            await saveCropSettings();
            console.log('Crop settings updated for:', currentCrop, cropSettings[currentCrop]);
            res.json({ success: true });
        } else {
            console.error('Invalid crop settings:', JSON.stringify(settings));
            res.status(400).json({ error: 'Invalid crop settings' });
        }
    } catch (error) {
        console.error('Error in /saveCropSettings:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});


app.post('/deleteCrop', async (req, res) => {
  try {
    const cropToDelete = currentCrop;
    if (!cropSettings[cropToDelete]) {
      return res.status(400).json({ error: 'Current crop not found' });
    }
    
    delete cropSettings[cropToDelete];
    
    // Выбрать новую культуру по умолчанию
    const remainingCrops = Object.keys(cropSettings);
    currentCrop = remainingCrops.length > 0 ? remainingCrops[0] : 'potato';
    
    await saveCropSettings();
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting crop:', error);
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

    // Validate inputs
    const isValidNumber = (val) => typeof val === 'number' && !isNaN(val) && val >= 0;

    if (
      !isValidNumber(fanTemperatureThreshold) ||
      !isValidNumber(lightOnDuration) || lightOnDuration < 60000 || // Minimum 1 minute
      !isValidNumber(lightIntervalManual) || lightIntervalManual < 60000 || // Minimum 1 minute
      !isValidNumber(pumpStartHour) || pumpStartHour < 0 || pumpStartHour >= 24 ||
      !isValidNumber(pumpStartMinute) || pumpStartMinute < 0 || pumpStartMinute >= 60 ||
      !isValidNumber(pumpDuration) || pumpDuration <= 0 ||
      !isValidNumber(pumpInterval) || pumpInterval <= 0
    ) {
      return res.status(400).json({ error: 'Invalid crop settings' });
    }

    cropSettings[cropKey] = {
      name: cropName,
      fanTemperatureThreshold: parseFloat(fanTemperatureThreshold) || 25.0,
      lightOnDuration: parseInt(lightOnDuration) || 7200000, // Already in milliseconds
      lightIntervalManual: parseInt(lightIntervalManual) || 21600000, // Already in milliseconds
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
