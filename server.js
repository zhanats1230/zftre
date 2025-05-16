const express = require('express');
const bodyParser = require('body-parser');
const app = express();
const port = 80;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

let relayState = {
  relayState1: false,
  relayState2: false
};

let sensorData = {
  temperature: 0,
  humidity: 0,
  soilMoisture: 0
};

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
      padding: 1rem;
      border-radius: 8px 8px 0 0;
      margin: -1.5rem -1.5rem 1.5rem;
    }
    .input-container {
      position: relative;
      transition: all 0.3s ease;
      padding: 0.5rem;
      border-radius: 12px;
      background: #f9fafb;
      border: 1px solid #e5e7eb;
    }
    .input-container:hover {
      background: #eff6ff;
      border-color: #14b8a6;
      box-shadow: 0 2px 8px rgba(20, 184, 166, 0.2);
    }
    .input-container input {
      width: 100%;
      padding: 0.75rem 0.75rem 0.75rem 2.5rem;
      border: none;
      border-radius: 8px;
      background: transparent;
      font-size: 1rem;
      color: #1f2937;
      outline: none;
    }
    .input-container input:focus {
      box-shadow: 0 0 0 3px rgba(20, 184, 166, 0.3);
    }
    .input-container i {
      position: absolute;
      left: 0.75rem;
      top: 50%;
      transform: translateY(-50%);
      color: #14b8a6;
      font-size: 1.2rem;
    }
    .input-label {
      display: flex;
      align-items: center;
      font-weight: 500;
      color: #4b5563;
      margin-bottom: 0.5rem;
      font-size: 0.9rem;
    }
    .input-label i {
      margin-right: 0.5rem;
      color: #14b8a6;
    }
    .divider {
      height: 1px;
      background: linear-gradient(to right, transparent, #e5e7eb, transparent);
      margin: 1.5rem 0;
    }
    @keyframes pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.03); }
      100% { transform: scale(1); }
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
      <button id="toggleMode" class="bg-teal-500 text-white px-4 py-2 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-sync mr-2"></i> Switch Mode</button>
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
      <!-- Manual Mode Settings -->
      <div class="bg-white p-6 rounded-2xl shadow-lg card mb-8">
        <div class="section-header">
          <h3 class="text-xl font-semibold"><i class="fa-solid fa-sliders mr-2"></i> Manual Mode Settings</h3>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-6">
          <div class="input-container">
            <label class="input-label"><i class="fa-solid fa-temperature-high"></i> Temperature Threshold (°C)</label>
            <i class="fa-solid fa-thermometer"></i>
            <input id="fanTemperatureThreshold" type="number" step="0.1" value="31.0" placeholder="Enter °C">
          </div>
          <div class="input-container">
            <label class="input-label"><i class="fa-solid fa-clock"></i> Light On Duration (min)</label>
            <i class="fa-solid fa-lightbulb"></i>
            <input id="lightOnDuration" type="number" value="1" placeholder="Enter minutes">
          </div>
          <div class="input-container">
            <label class="input-label"><i class="fa-solid fa-hourglass"></i> Light Interval (min)</label>
            <i class="fa-solid fa-clock"></i>
            <input id="lightIntervalManual" type="number" value="1" placeholder="Enter minutes">
          </div>
        </div>
        <div class="divider"></div>
        <button id="saveLightingSettings" class="w-full mt-4 bg-teal-500 text-white p-3 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-save mr-2"></i> Save Settings</button>
      </div>

      <!-- Pump Settings -->
      <div class="bg-white p-6 rounded-2xl shadow-lg card">
        <div class="section-header">
          <h3 class="text-xl font-semibold"><i class="fa-solid fa-water mr-2"></i> Pump Settings</h3>
        </div>
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-6">
          <div class="input-container">
            <label class="input-label"><i class="fa-solid fa-clock"></i> Start Hour</label>
            <i class="fa-solid fa-hourglass-start"></i>
            <input id="pumpStartHour" type="number" min="0" max="23" value="18" placeholder="0-23">
          </div>
          <div class="input-container">
            <label class="input-label"><i class="fa-solid fa-clock"></i> Start Minute</label>
            <i class="fa-solid fa-hourglass-end"></i>
            <input id="pumpStartMinute" type="number" min="0" max="59" value="0" placeholder="0-59">
          </div>
          <div class="input-container">
            <label class="input-label"><i class="fa-solid fa-stopwatch"></i> Duration (sec)</label>
            <i class="fa-solid fa-water"></i>
            <input id="pumpDuration" type="number" min="1" value="10" placeholder="Seconds">
          </div>
          <div class="input-container">
            <label class="input-label"><i class="fa-solid fa-clock"></i> Interval (min)</label>
            <i class="fa-solid fa-hourglass"></i>
            <input id="pumpInterval" type="number" min="1" value="240" placeholder="Minutes">
          </div>
        </div>
        <div class="divider"></div>
        <button id="savePumpSettings" class="w-full mt-4 bg-teal-500 text-white p-3 rounded-lg btn hover:bg-teal-600"><i class="fa-solid fa-save mr-2"></i> Save Settings</button>
      </div>
    </div>
  </div>

  <script>
    console.log('Script loaded'); // Debug: Confirm script execution
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

    // Initialize login event listeners
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

    // Wait for DOM to be fully loaded
    document.addEventListener('DOMContentLoaded', () => {
      console.log('DOM fully loaded');
      setupLoginListeners();
    });

    // Tab switching
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

    // Chart initialization
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
          scales: { y: { beginAtZero: true, max: 100 } }
        }
      });
    }

    // Modal handling
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

    // Initialize app
    function initializeApp() {
      switchTab('dashboard');
      initializeCharts();
      updateRelayState();
      updateSensorData();
      updateMode();
      updateSettings();

      document.getElementById('toggleRelay1').addEventListener('click', () => toggleRelay(1));
      document.getElementById('toggleRelay2').addEventListener('click', () => toggleRelay(2));
      document.getElementById('toggleMode').addEventListener('click', toggleMode);
      document.getElementById('saveLightingSettings').addEventListener('click', saveLightingSettings);
      document.getElementById('savePumpSettings').addEventListener('click', savePumpSettings);

      setInterval(updateSensorData, 5000);
      setInterval(updateRelayState, 5000);
      setInterval(updateMode, 5000);
    }

    // Fetch and display relay states
    async function updateRelayState() {
      try {
        const response = await fetch('/getRelayState');
        const data = await response.json();
        const relay1Badge = document.getElementById('relayState1');
        const relay2Badge = document.getElementById('relayState2');
        const relay1Control = document.getElementById('relayState1Control');
        const relay2Control = document.getElementById('relayState2Control');

        relay1Badge.textContent = data.relayState1 ? 'ON' : 'OFF';
        relay1Badge.className = \`status-badge \${data.relayState1 ? 'bg-teal-100 text-teal-800' : 'bg-red-100 text-red-800'}\`;
        relay2Badge.textContent = data.relayState2 ? 'ON' : 'OFF';
        relay2Badge.className = \`status-badge \${data.relayState2 ? 'bg-teal-100 text-teal-800' : 'bg-red-100 text-red-800'}\`;
        relay1Control.textContent = \`Lighting: \${data.relayState1 ? 'ON' : 'OFF'}\`;
        relay2Control.textContent = \`Ventilation: \${data.relayState2 ? 'ON' : 'OFF'}\`;
      } catch (error) {
        console.error('Error fetching relay state:', error);
      }
    }

    // Fetch and display sensor data
    async function updateSensorData() {
      try {
        const response = await fetch('/getSensorData');
        const data = await response.json();
        document.getElementById('temperature').textContent = \`\${data.temperature} °C\`;
        document.getElementById('humidity').textContent = \`\${data.humidity} %\`;
        document.getElementById('soilMoisture').textContent = \`\${data.soilMoisture} %\`;

        // Update progress bars
        document.getElementById('temperatureProgress').style.width = \`\${Math.min((data.temperature / 40) * 100, 100)}%\`;
        document.getElementById('humidityProgress').style.width = \`\${Math.min(data.humidity, 100)}%\`;
        document.getElementById('soilMoistureProgress').style.width = \`\${Math.min(data.soilMoisture, 100)}%\`;

        // Store data for charts
        const timestamp = new Date().toLocaleTimeString();
        updateChartData('temperature', timestamp, data.temperature);
        updateChartData('humidity', timestamp, data.humidity);
        updateChartData('soilMoisture', timestamp, data.soilMoisture);
      } catch (error) {
        console.error('Error fetching sensor data:', error);
      }
    }

    // Update chart data
    function updateChartData(sensor, timestamp, value) {
      const key = \`\${sensor}Data\`;
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

    // Fetch and display current mode
    async function updateMode() {
      try {
        const response = await fetch('/getMode');
        const data = await response.json();
        const modeBadge = document.getElementById('currentMode');
        modeBadge.textContent = data.mode.charAt(0).toUpperCase() + data.mode.slice(1);
        modeBadge.className = \`status-badge \${data.mode === 'auto' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'}\`;
      } catch (error) {
        console.error('Error fetching mode:', error);
      }
    }

    // Fetch and display settings
    async function updateSettings() {
      try {
        const lightingResponse = await fetch('/getLightingSettings');
        const lightingData = await lightingResponse.json();
        document.getElementById('fanTemperatureThreshold').value = lightingData.fanTemperatureThreshold;
        document.getElementById('lightOnDuration').value = lightingData.lightOnDuration / 60000;
        document.getElementById('lightIntervalManual').value = lightingData.lightIntervalManual / 60000;

        const pumpResponse = await fetch('/getPumpSettings');
        const pumpData = await pumpResponse.json();
        document.getElementById('pumpStartHour').value = pumpData.pumpStartHour;
        document.getElementById('pumpStartMinute').value = pumpData.pumpStartMinute;
        document.getElementById('pumpDuration').value = pumpData.pumpDuration;
        document.getElementById('pumpInterval').value = pumpData.pumpInterval;
      } catch (error) {
        console.error('Error fetching settings:', error);
      }
    }

    // Toggle relay state
    async function toggleRelay(relayNumber) {
      try {
        const response = await fetch(\`/toggleRelay/\${relayNumber}\`, { method: 'POST' });
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

    // Toggle mode
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

    // Save lighting settings
    async function saveLightingSettings() {
      try {
        const settings = {
          fanTemperatureThreshold: parseFloat(document.getElementById('fanTemperatureThreshold').value),
          lightOnDuration: parseInt(document.getElementById('lightOnDuration').value) * 60000,
          lightIntervalManual: parseInt(document.getElementById('lightIntervalManual').value) * 60000
        };
        const response = await fetch('/updateLightingSettings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(settings)
        });
        if (response.ok) {
          alert('Lighting settings saved!');
          await updateSettings();
        } else {
          const error = await response.json();
          alert(error.error || 'Failed to save settings');
        }
      } catch (error) {
        console.error('Error saving lighting settings:', error);
        alert('Error saving settings');
      }
    }

    // Save pump settings
    async function savePumpSettings() {
      try {
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
          alert('Pump settings saved!');
          await updateSettings();
        } else {
          const error = await response.json();
          alert(error.error || 'Failed to save settings');
        }
      } catch (error) {
        console.error('Error saving pump settings:', error);
        alert('Error saving settings');
      }
    }
  </script>
</body>
</html>
  `);
});

app.get('/getRelayState', (req, res) => {
  res.json(relayState);
});

app.get('/getSensorData', (req, res) => {
  res.json(sensorData);
});

app.post('/updateSensorData', (req, res) => {
  const { temperature, humidity, soilMoisture } = req.body;
  if (temperature !== undefined && humidity !== undefined && soilMoisture !== undefined) {
    sensorData = { temperature, humidity, soilMoisture };
    console.log('Sensor data updated:', sensorData);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid sensor data' });
  }
});

app.get('/getMode', (req, res) => {
  res.json({ mode });
});

app.post('/setMode', (req, res) => {
  const { mode: newMode } = req.body;
  if (newMode === 'auto' || newMode === 'manual') {
    mode = newMode;
    console.log('Mode set to:', mode);
    res.json({ success: true });
  } else {
    res.status(400).json({ error: 'Invalid mode' });
  }
});

app.post('/toggleRelay/:relayNumber', (req, res) => {
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
});

app.get('/getPumpSettings', (req, res) => {
  res.json(pumpSettings);
});

app.post('/updatePumpSettings', (req, res) => {
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
});

app.get('/getLightingSettings', (req, res) => {
  res.json(lightingSettings);
});

app.post('/updateLightingSettings', (req, res) => {
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
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
