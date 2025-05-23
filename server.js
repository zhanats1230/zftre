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
      <title>Greenhouse Login</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script src="https://kit.fontawesome.com/a076d05399.js" crossorigin="anonymous"></script>
    </head>
    <body class="bg-green-100 flex items-center justify-center h-screen">
      <div class="bg-white p-8 rounded-lg shadow-lg">
        <h2 class="text-2xl font-bold text-green-700 mb-4"><i class="fas fa-leaf mr-2"></i>Greenhouse Login</h2>
        <input type="password" id="password" class="border p-2 w-full mb-4 rounded" placeholder="Enter Password">
        <button onclick="login()" class="bg-green-500 text-white p-2 rounded w-full hover:bg-green-600">Login</button>
        <p id="error" class="text-red-500 hidden mt-2">Incorrect Password</p>
        <script>
          function login() {
            const password = document.getElementById('password').value;
            if (password === 'admin') {
              window.location.href = '/';
            } else {
              document.getElementById('error').classList.remove('hidden');
            }
          }
        </script>
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
      name && typeof name === 'string' && !cropProfiles[name.toLowerCase()] &&
      healthyRanges && pumpSettings && lightingSettings &&
      Number.isInteger(pumpSettings.pumpStartHour) && pumpSettings.pumpStartHour >= 0 && pumpSettings.pumpStartHour <= 23 &&
      Number.isInteger(pumpSettings.pumpStartMinute) && pumpSettings.pumpStartMinute >= 0 && pumpSettings.pumpStartMinute <= 59 &&
      Number.isInteger(pumpSettings.pumpDuration) && pumpSettings.pumpDuration > 0 &&
      Number.isInteger(pumpSettings.pumpInterval) && pumpSettings.pumpInterval > 0 &&
      typeof lightingSettings.fanTemperatureThreshold === 'number' &&
      typeof lightingSettings.lightOnDuration === 'number' && lightingSettings.lightOnDuration > 0 &&
      typeof lightingSettings.lightIntervalManual === 'number' && lightingSettings.lightIntervalManual > 0
    ) {
      cropProfiles[name.toLowerCase()] = { name, healthyRanges, pumpSettings, lightingSettings };
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
