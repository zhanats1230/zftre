const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const app = express();
const port = 80;

// Path to store sensor data and crop data
const DATA_FILE = 'sensorDataHistory.json';
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // Serve static files if needed

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
  },
  crops: [],
  selectedCrop: null
};

const HEALTHY_RANGES = {
  temperature: { min: 20, max: 30 },
  humidity: { min: 50, max: 80 },
  soilMoisture: { min: 30, max: 70 }
};

const PREDEFINED_CROPS = [
  {
    id: uuidv4(),
    name: 'Potatoes',
    settings: {
      fanTemperatureThreshold: 25,
      lightOnDuration: 720,
      lightIntervalManual: 720,
      pumpStartHour: 6,
      pumpStartMinute: 0,
      pumpDuration: 30,
      pumpInterval: 240
    },
    healthyRanges: {
      temperature: { min: 18, max: 24 },
      humidity: { min: 60, max: 80 },
      soilMoisture: { min: 50, max: 70 }
    }
  },
  {
    id: uuidv4(),
    name: 'Carrots',
    settings: {
      fanTemperatureThreshold: 22,
      lightOnDuration: 600,
      lightIntervalManual: 840,
      pumpStartHour: 7,
      pumpStartMinute: 0,
      pumpDuration: 20,
      pumpInterval: 180
    },
    healthyRanges: {
      temperature: { min: 16, max: 22 },
      humidity: { min: 50, max: 70 },
      soilMoisture: { min: 60, max: 80 }
    }
  },
  {
    id: uuidv4(),
    name: 'Tomatoes',
    settings: {
      fanTemperatureThreshold: 27,
      lightOnDuration: 960,
      lightIntervalManual: 480,
      pumpStartHour: 5,
      pumpStartMinute: 30,
      pumpDuration: 40,
      pumpInterval: 120
    },
    healthyRanges: {
      temperature: { min: 20, max: 28 },
      humidity: { min: 60, max: 85 },
      soilMoisture: { min: 55, max: 75 }
    }
  }
];

let mode = 'manual';
let lightingSettings = {
  fanTemperatureThreshold: 25,
  lightOnDuration: 720,
  lightIntervalManual: 720
};
let pumpSettings = {
  pumpStartHour: 6,
  pumpStartMinute: 0,
  pumpDuration: 30,
  pumpInterval: 240
};

async function loadSensorDataHistory() {
  try {
    const data = await fs.readFile(DATA_FILE, 'utf8');
    sensorDataHistory = JSON.parse(data);
    const oneDayAgo = Date.now() - 86400000;
    sensorDataHistory.raw = sensorDataHistory.raw.filter(entry => entry.timestamp >= oneDayAgo);
    sensorDataHistory.hourlyAverages = sensorDataHistory.hourlyAverages.filter(entry => entry.timestamp >= oneDayAgo);
    if (!sensorDataHistory.crops) {
      sensorDataHistory.crops = PREDEFINED_CROPS;
    }
    if (sensorDataHistory.selectedCrop && !sensorDataHistory.crops.find(crop => crop.id === sensorDataHistory.selectedCrop)) {
      sensorDataHistory.selectedCrop = null;
    }
    console.log(`Loaded ${sensorDataHistory.raw.length} raw entries, ${sensorDataHistory.hourlyAverages.length} hourly averages, ${sensorDataHistory.crops.length} crops`);
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing sensor data file found, initializing with predefined crops');
      sensorDataHistory.crops = PREDEFINED_CROPS;
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
      crops: PREDEFINED_CROPS,
      selectedCrop: null
    };
  }
}

async function saveSensorDataHistory() {
  try {
    await fs.writeFile(DATA_FILE, JSON.stringify(sensorDataHistory, null, 2));
    console.log('Sensor data and crop data saved to file');
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
  const ranges = sensorDataHistory.selectedCrop 
    ? sensorDataHistory.crops.find(crop => crop.id === sensorDataHistory.selectedCrop)?.healthyRanges || HEALTHY_RANGES
    : HEALTHY_RANGES;
  sensorDataHistory.healthyRanges.temperature.total++;
  sensorDataHistory.healthyRanges.humidity.total++;
  sensorDataHistory.healthyRanges.soilMoisture.total++;
  if (temperature >= ranges.temperature.min && temperature <= ranges.temperature.max) {
    sensorDataHistory.healthyRanges.temperature.inRange++;
  }
  if (humidity >= ranges.humidity.min && humidity <= ranges.humidity.max) {
    sensorDataHistory.healthyRanges.humidity.inRange++;
  }
  if (soilMoisture >= ranges.soilMoisture.min && soilMoisture <= ranges.soilMoisture.max) {
    sensorDataHistory.healthyRanges.soilMoisture.inRange++;
  }
}

loadSensorDataHistory();

// Serve the main page with embedded HTML
app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Greenhouse Control</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://cdn.jsdelivr.net/npm/react@18.2.0/umd/react.development.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@18.2.0/umd/react-dom.development.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/babel-standalone@6.26.0/babel.min.js"></script>
  <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css" rel="stylesheet">
</head>
<body class="bg-gray-100">
  <div id="root"></div>
  <script type="text/babel">
    function GreenhouseApp() {
      const [isLoggedIn, setIsLoggedIn] = React.useState(false);
      const [password, setPassword] = React.useState('');
      const [error, setError] = React.useState('');
      const [mode, setMode] = React.useState('manual');
      const [isOnline, setIsOnline] = React.useState(false);
      const [relayState, setRelayState] = React.useState({ relayState1: false, relayState2: false });
      const [sensorData, setSensorData] = React.useState({ temperature: 0, humidity: 0, soilMoisture: 0 });
      const [trends, setTrends] = React.useState({ hourlyAverages: [], healthyRanges: {} });
      const [lightingSettings, setLightingSettings] = React.useState({ fanTemperatureThreshold: 25, lightOnDuration: 720, lightIntervalManual: 720 });
      const [pumpSettings, setPumpSettings] = React.useState({ pumpStartHour: 6, pumpStartMinute: 0, pumpDuration: 30, pumpInterval: 240 });
      const [crops, setCrops] = React.useState([]);
      const [selectedCrop, setSelectedCrop] = React.useState(null);
      const [newCrop, setNewCrop] = React.useState({
        name: '',
        settings: { fanTemperatureThreshold: 25, lightOnDuration: 720, lightIntervalManual: 720, pumpStartHour: 6, pumpStartMinute: 0, pumpDuration: 30, pumpInterval: 240 },
        healthyRanges: { temperature: { min: 20, max: 30 }, humidity: { min: 50, max: 80 }, soilMoisture: { min: 30, max: 70 } }
      });
      const [editingCrop, setEditingCrop] = React.useState(null);
      const [activeTab, setActiveTab] = React.useState('dashboard');

      React.useEffect(() => {
        fetch('/getSensorStatus').then(res => res.json()).then(data => setIsOnline(data.isOnline));
        fetch('/getRelayState').then(res => res.json()).then(setRelayState);
        fetch('/getSensorData').then(res => res.json()).then(setSensorData);
        fetch('/getSensorTrends').then(res => res.json()).then(setTrends);
        fetch('/getMode').then(res => res.json()).then(data => setMode(data.mode));
        fetch('/getLightingSettings').then(res => res.json()).then(setLightingSettings);
        fetch('/getPumpSettings').then(res => res.json()).then(setPumpSettings);
        fetch('/getCrops').then(res => res.json()).then(data => {
          setCrops(data.crops);
          setSelectedCrop(data.selectedCrop);
        });
        const interval = setInterval(() => {
          fetch('/getSensorStatus').then(res => res.json()).then(data => setIsOnline(data.isOnline));
          fetch('/getSensorData').then(res => res.json()).then(setSensorData);
          fetch('/getSensorTrends').then(res => res.json()).then(setTrends);
        }, 5000);
        return () => clearInterval(interval);
      }, []);

      const handleLogin = () => {
        if (password === 'admin') {
          setIsLoggedIn(true);
          setError('');
        } else {
          setError('Incorrect Password');
        }
      };

      const handleLogout = () => {
        setIsLoggedIn(false);
        setPassword('');
      };

      const toggleMode = () => {
        const newMode = mode === 'auto' ? 'manual' : 'auto';
        fetch('/setMode', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: newMode })
        }).then(res => res.json()).then(data => {
          if (data.success) setMode(newMode);
        });
      };

      const toggleRelay = (relayNumber) => {
        fetch(\`/toggleRelay/\${relayNumber}\`, { method: 'POST' })
          .then(res => res.json())
          .then(data => {
            if (data.success) {
              setRelayState(prev => ({ ...prev, [\`relayState\${relayNumber}\`]: !prev[\`relayState\${relayNumber}\`] }));
            }
          });
      };

      const updateLightingSettings = (e) => {
        e.preventDefault();
        fetch('/updateLightingSettings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lightingSettings)
        }).then(res => res.json()).then(data => {
          if (data.success) alert('Lighting settings saved');
        });
      };

      const updatePumpSettings = (e) => {
        e.preventDefault();
        fetch('/updatePumpSettings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pumpSettings)
        }).then(res => res.json()).then(data => {
          if (data.success) alert('Pump settings saved');
        });
      };

      const selectCrop = (cropId) => {
        fetch('/selectCrop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cropId })
        }).then(res => res.json()).then(data => {
          if (data.success) {
            const crop = crops.find(c => c.id === cropId);
            setSelectedCrop(cropId);
            setLightingSettings({ ...crop.settings });
            setPumpSettings({ ...crop.settings });
          }
        });
      };

      const addCrop = (e) => {
        e.preventDefault();
        fetch('/addCrop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newCrop)
        }).then(res => res.json()).then(data => {
          if (data.success) {
            setCrops([...crops, { id: data.cropId, ...newCrop }]);
            setNewCrop({
              name: '',
              settings: { fanTemperatureThreshold: 25, lightOnDuration: 720, lightIntervalManual: 720, pumpStartHour: 6, pumpStartMinute: 0, pumpDuration: 30, pumpInterval: 240 },
              healthyRanges: { temperature: { min: 20, max: 30 }, humidity: { min: 50, max: 80 }, soilMoisture: { min: 30, max: 70 } }
            });
            alert('Crop added');
          }
        });
      };

      const updateCrop = (e) => {
        e.preventDefault();
        fetch('/updateCrop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cropId: editingCrop.id, ...newCrop })
        }).then(res => res.json()).then(data => {
          if (data.success) {
            setCrops(crops.map(c => c.id === editingCrop.id ? { id: c.id, ...newCrop } : c));
            if (selectedCrop === editingCrop.id) {
              setLightingSettings({ ...newCrop.settings });
              setPumpSettings({ ...newCrop.settings });
            }
            setEditingCrop(null);
            setNewCrop({
              name: '',
              settings: { fanTemperatureThreshold: 25, lightOnDuration: 720, lightIntervalManual: 720, pumpStartHour: 6, pumpStartMinute: 0, pumpDuration: 30, pumpInterval: 240 },
              healthyRanges: { temperature: { min: 20, max: 30 }, humidity: { min: 50, max: 80 }, soilMoisture: { min: 30, max: 70 } }
            });
            alert('Crop updated');
          }
        });
      };

      const startEditCrop = (crop) => {
        setEditingCrop(crop);
        setNewCrop({ ...crop });
      };

      if (!isLoggedIn) {
        return (
          <div className="min-h-screen flex items-center justify-center bg-green-100">
            <div className="bg-white p-8 rounded-lg shadow-lg w-full max-w-md">
              <h1 className="text-2xl font-bold text-green-700 mb-4 flex items-center">
                <i className="fas fa-seedling mr-2"></i> Greenhouse Login
              </h1>
              {error && <p className="text-red-500 mb-4">{error}</p>}
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full p-2 mb-4 border rounded focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                onClick={handleLogin}
                className="w-full bg-green-600 text-white p-2 rounded hover:bg-green-700"
              >
                Login
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="min-h-screen bg-green-50">
          <header className="bg-green-600 text-white p-4 flex justify-between items-center">
            <h1 className="text-xl font-bold flex items-center">
              <i className="fas fa-leaf mr-2"></i> Greenhouse Control
            </h1>
            <div>
              <button
                onClick={toggleMode}
                className="mr-4 bg-green-700 px-4 py-2 rounded hover:bg-green-800"
              >
                Switch to {mode === 'auto' ? 'Manual' : 'Auto'} Mode
              </button>
              <span className={\`px-2 py-1 rounded \${isOnline ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}\`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
              <button
                onClick={handleLogout}
                className="ml-4 bg-red-600 px-4 py-2 rounded hover:bg-red-700"
              >
                Logout
              </button>
            </div>
          </header>
          <nav className="bg-green-100 p-4">
            <ul className="flex space-x-4">
              {['dashboard', 'relays', 'settings', 'crops'].map(tab => (
                <li key={tab}>
                  <button
                    onClick={() => setActiveTab(tab)}
                    className={\`px-4 py-2 rounded \${activeTab === tab ? 'bg-green-600 text-white' : 'bg-green-200 text-green-800'}\`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <main className="p-4">
            {activeTab === 'dashboard' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-lg shadow">
                  <h2 className="text-lg font-bold text-green-700 flex items-center">
                    <i className="fas fa-tachometer-alt mr-2"></i> System Status
                  </h2>
                  <p>Mode: {mode}</p>
                  <p>Lighting: {relayState.relayState1 ? 'On' : 'Off'}</p>
                  <p>Ventilation: {relayState.relayState2 ? 'On' : 'Off'}</p>
                </div>
                <div className="bg-white p-4 rounded-lg shadow">
                  <h2 className="text-lg font-bold text-green-700 flex items-center">
                    <i className="fas fa-thermometer-half mr-2"></i> Environmental Sensors
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <p className="font-bold">Temperature</p>
                      <p>{sensorData.temperature} °C</p>
                      <p>Healthy: {trends.healthyRanges.temperature?.toFixed(1)}%</p>
                      <button className="mt-2 text-green-600 hover:underline">View Trends</button>
                    </div>
                    <div>
                      <p className="font-bold">Humidity</p>
                      <p>{sensorData.humidity} %</p>
                      <p>Healthy: {trends.healthyRanges.humidity?.toFixed(1)}%</p>
                      <button className="mt-2 text-green-600 hover:underline">View Trends</button>
                    </div>
                    <div>
                      <p className="font-bold">Soil Moisture</p>
                      <p>{sensorData.soilMoisture} %</p>
                      <p>Healthy: {trends.healthyRanges.soilMoisture?.toFixed(1)}%</p>
                      <button className="mt-2 text-green-600 hover:underline">View Trends</button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'relays' && (
              <div className="bg-white p-4 rounded-lg shadow">
                <h2 className="text-lg font-bold text-green-700 flex items-center">
                  <i className="fas fa-plug mr-2"></i> Relays
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p>Lighting: {relayState.relayState1 ? 'On' : 'Off'}</p>
                    <button
                      onClick={() => toggleRelay(1)}
                      className="mt-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                      disabled={mode === 'auto'}
                    >
                      Toggle Lighting
                    </button>
                  </div>
                  <div>
                    <p>Ventilation: {relayState.relayState2 ? 'On' : 'Off'}</p>
                    <button
                      onClick={() => toggleRelay(2)}
                      className="mt-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
                      disabled={mode === 'auto'}
                    >
                      Toggle Ventilation
                    </button>
                  </div>
                </div>
              </div>
            )}
            {activeTab === 'settings' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-white p-4 rounded-lg shadow">
                  <h2 className="text-lg font-bold text-green-700 flex items-center">
                    <i className="fas fa-cog mr-2"></i> Manual Mode Settings
                  </h2>
                  <form onSubmit={updateLightingSettings} className="space-y-4">
                    <div>
                      <label className="block">Temp Threshold (°C)</label>
                      <input
                        type="number"
                        value={lightingSettings.fanTemperatureThreshold}
                        onChange={(e) => setLightingSettings({ ...lightingSettings, fanTemperatureThreshold: parseFloat(e.target.value) })}
                        className="w-full p-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block">Light Duration (min)</label>
                      <input
                        type="number"
                        value={lightingSettings.lightOnDuration}
                        onChange={(e) => setLightingSettings({ ...lightingSettings, lightOnDuration: parseInt(e.target.value) })}
                        className="w-full p-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block">Light Interval (min)</label>
                      <input
                        type="number"
                        value={lightingSettings.lightIntervalManual}
                        onChange={(e) => setLightingSettings({ ...lightingSettings, lightIntervalManual: parseInt(e.target.value) })}
                        className="w-full p-2 border rounded"
                      />
                    </div>
                    <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
                      Save Settings
                    </button>
                  </form>
                </div>
                <div className="bg-white p-4 rounded-lg shadow">
                  <h2 className="text-lg font-bold text-green-700 flex items-center">
                    <i className="fas fa-tint mr-2"></i> Pump Settings
                  </h2>
                  <form onSubmit={updatePumpSettings} className="space-y-4">
                    <div>
                      <label className="block">Start Hour</label>
                      <input
                        type="number"
                        value={pumpSettings.pumpStartHour}
                        onChange={(e) => setPumpSettings({ ...pumpSettings, pumpStartHour: parseInt(e.target.value) })}
                        className="w-full p-2 border rounded"
                        min="0"
                        max="23"
                      />
                    </div>
                    <div>
                      <label className="block">Start Minute</label>
                      <input
                        type="number"
                        value={pumpSettings.pumpStartMinute}
                        onChange={(e) => setPumpSettings({ ...pumpSettings, pumpStartMinute: parseInt(e.target.value) })}
                        className="w-full p-2 border rounded"
                        min="0"
                        max="59"
                      />
                    </div>
                    <div>
                      <label className="block">Duration (sec)</label>
                      <input
                        type="number"
                        value={pumpSettings.pumpDuration}
                        onChange={(e) => setPumpSettings({ ...pumpSettings, pumpDuration: parseInt(e.target.value) })}
                        className="w-full p-2 border rounded"
                      />
                    </div>
                    <div>
                      <label className="block">Interval (min)</label>
                      <input
                        type="number"
                        value={pumpSettings.pumpInterval}
                        onChange={(e) => setPumpSettings({ ...pumpSettings, pumpInterval: parseInt(e.target.value) })}
                        className="w-full p-2 border rounded"
                      />
                    </div>
                    <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
                      Save Settings
                    </button>
                  </form>
                </div>
              </div>
            )}
            {activeTab === 'crops' && (
              <div className="bg-white p-4 rounded-lg shadow">
                <h2 className="text-lg font-bold text-green-700 flex items-center">
                  <i className="fas fa-seedling mr-2"></i> Crop Management
                </h2>
                <div className="mb-4">
                  <label className="block font-bold">Select Crop</label>
                  <select
                    value={selectedCrop || ''}
                    onChange={(e) => selectCrop(e.target.value)}
                    className="w-full p-2 border rounded"
                  >
                    <option value="">Select a crop</option>
                    {crops.map(crop => (
                      <option key={crop.id} value={crop.id}>{crop.name}</option>
                    ))}
                  </select>
                </div>
                <h3 className="text-md font-bold text-green-600">Add/Edit Crop</h3>
                <form onSubmit={editingCrop ? updateCrop : addCrop} className="space-y-4">
                  <div>
                    <label className="block">Crop Name</label>
                    <input
                      type="text"
                      value={newCrop.name}
                      onChange={(e) => setNewCrop({ ...newCrop, name: e.target.value })}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                  <h4 className="font-bold">Settings</h4>
                  <div>
                    <label className="block">Temp Threshold (°C)</label>
                    <input
                      type="number"
                      value={newCrop.settings.fanTemperatureThreshold}
                      onChange={(e) => setNewCrop({ ...newCrop, settings: { ...newCrop.settings, fanTemperatureThreshold: parseFloat(e.target.value) } })}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                  <div>
                    <label className="block">Light Duration (min)</label>
                    <input
                      type="number"
                      value={newCrop.settings.lightOnDuration}
                      onChange={(e) => setNewCrop({ ...newCrop, settings: { ...newCrop.settings, lightOnDuration: parseInt(e.target.value) } })}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                  <div>
                    <label className="block">Light Interval (min)</label>
                    <input
                      type="number"
                      value={newCrop.settings.lightIntervalManual}
                      onChange={(e) => setNewCrop({ ...newCrop, settings: { ...newCrop.settings, lightIntervalManual: parseInt(e.target.value) } })}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                  <div>
                    <label className="block">Pump Start Hour</label>
                    <input
                      type="number"
                      value={newCrop.settings.pumpStartHour}
                      onChange={(e) => setNewCrop({ ...newCrop, settings: { ...newCrop.settings, pumpStartHour: parseInt(e.target.value) } })}
                      className="w-full p-2 border rounded"
                      min="0"
                      max="23"
                    />
                  </div>
                  <div>
                    <label className="block">Pump Start Minute</label>
                    <input
                      type="number"
                      value={newCrop.settings.pumpStartMinute}
                      onChange={(e) => setNewCrop({ ...newCrop, settings: { ...newCrop.settings, pumpStartMinute: parseInt(e.target.value) } })}
                      className="w-full p-2 border rounded"
                      min="0"
                      max="59"
                    />
                  </div>
                  <div>
                    <label className="block">Pump Duration (sec)</label>
                    <input
                      type="number"
                      value={newCrop.settings.pumpDuration}
                      onChange={(e) => setNewCrop({ ...newCrop, settings: { ...newCrop.settings, pumpDuration: parseInt(e.target.value) } })}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                  <div>
                    <label className="block">Pump Interval (min)</label>
                    <input
                      type="number"
                      value={newCrop.settings.pumpInterval}
                      onChange={(e) => setNewCrop({ ...newCrop, settings: { ...newCrop.settings, pumpInterval: parseInt(e.target.value) } })}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                  <h4 className="font-bold">Healthy Ranges</h4>
                  <div>
                    <label className="block">Temperature Min (°C)</label>
                    <input
                      type="number"
                      value={newCrop.healthyRanges.temperature.min}
                      onChange={(e) => setNewCrop({ ...newCrop, healthyRanges: { ...newCrop.healthyRanges, temperature: { ...newCrop.healthyRanges.temperature, min: parseFloat(e.target.value) } } })}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                  <div>
                    <label className="block">Temperature Max (°C)</label>
                    <input
                      type="number"
                      value={newCrop.healthyRanges.temperature.max}
                      onChange={(e) => setNewCrop({ ...newCrop, healthyRanges: { ...newCrop.healthyRanges, temperature: { ...newCrop.healthyRanges.temperature, max: parseFloat(e.target.value) } } })}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                  <div>
                    <label className="block">Humidity Min (%)</label>
                    <input
                      type="number"
                      value={newCrop.healthyRanges.humidity.min}
                      onChange={(e) => setNewCrop({ ...newCrop, healthyRanges: { ...newCrop.healthyRanges, humidity: { ...newCrop.healthyRanges.humidity, min: parseFloat(e.target.value) } } })}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                  <div>
                    <label className="block">Humidity Max (%)</label>
                    <input
                      type="number"
                      value={newCrop.healthyRanges.humidity.max}
                      onChange={(e) => setNewCrop({ ...newCrop, healthyRanges: { ...newCrop.healthyRanges, humidity: { ...newCrop.healthyRanges.humidity, max: parseFloat(e.target.value) } } })}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                  <div>
                    <label className="block">Soil Moisture Min (%)</label>
                    <input
                      type="number"
                      value={newCrop.healthyRanges.soilMoisture.min}
                      onChange={(e) => setNewCrop({ ...newCrop, healthyRanges: { ...newCrop.healthyRanges, soilMoisture: { ...newCrop.healthyRanges.soilMoisture, min: parseFloat(e.target.value) } } })}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                  <div>
                    <label className="block">Soil Moisture Max (%)</label>
                    <input
                      type="number"
                      value={newCrop.healthyRanges.soilMoisture.max}
                      onChange={(e) => setNewCrop({ ...newCrop, healthyRanges: { ...newCrop.healthyRanges, soilMoisture: { ...newCrop.healthyRanges.soilMoisture, max: parseFloat(e.target.value) } } })}
                      className="w-full p-2 border rounded"
                    />
                  </div>
                  <button type="submit" className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700">
                    {editingCrop ? 'Update Crop' : 'Add Crop'}
                  </button>
                  {editingCrop && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingCrop(null);
                        setNewCrop({
                          name: '',
                          settings: { fanTemperatureThreshold: 25, lightOnDuration: 720, lightIntervalManual: 720, pumpStartHour: 6, pumpStartMinute: 0, pumpDuration: 30, pumpInterval: 240 },
                          healthyRanges: { temperature: { min: 20, max: 30 }, humidity: { min: 50, max: 80 }, soilMoisture: { min: 30, max: 70 } }
                        });
                      }}
                      className="ml-2 bg-gray-600 text-white px-4 py-2 rounded hover:bg-gray-700"
                    >
                      Cancel
                    </button>
                  )}
                </form>
                <h3 className="text-md font-bold text-green-600 mt-4">Existing Crops</h3>
                <ul className="space-y-2">
                  {crops.map(crop => (
                    <li key={crop.id} className="flex justify-between items-center">
                      <span>{crop.name}</span>
                      <button
                        onClick={() => startEditCrop(crop)}
                        className="text-green-600 hover:underline"
                      >
                        Edit
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </main>
        </div>
      );
    }

    ReactDOM.render(<GreenhouseApp />, document.getElementById('root'));
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

app.get('/getCrops', (req, res) => {
  try {
    res.json({
      crops: sensorDataHistory.crops,
      selectedCrop: sensorDataHistory.selectedCrop
    });
  } catch (error) {
    console.error('Error in /getCrops:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/selectCrop', (req, res) => {
  try {
    const { cropId } = req.body;
    const crop = sensorDataHistory.crops.find(c => c.id === cropId);
    if (crop) {
      sensorDataHistory.selectedCrop = cropId;
      lightingSettings = { ...crop.settings };
      pumpSettings = { ...crop.settings };
      saveSensorDataHistory();
      console.log(`Crop selected: ${crop.name}`);
      res.json({ success: true });
    } else {
      res.status(400).json({ error: 'Invalid crop ID' });
    }
  } catch (error) {
    console.error('Error in /selectCrop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/addCrop', (req, res) => {
  try {
    const { name, settings, healthyRanges } = req.body;
    if (
      typeof name === 'string' && name.trim() &&
      settings &&
      typeof settings.fanTemperatureThreshold === 'number' &&
      typeof settings.lightOnDuration === 'number' && settings.lightOnDuration > 0 &&
      typeof settings.lightIntervalManual === 'number' && settings.lightIntervalManual > 0 &&
      Number.isInteger(settings.pumpStartHour) && settings.pumpStartHour >= 0 && settings.pumpStartHour <= 23 &&
      Number.isInteger(settings.pumpStartMinute) && settings.pumpStartMinute >= 0 && settings.pumpStartMinute <= 59 &&
      Number.isInteger(settings.pumpDuration) && settings.pumpDuration > 0 &&
      Number.isInteger(settings.pumpInterval) && settings.pumpInterval > 0 &&
      healthyRanges &&
      typeof healthyRanges.temperature.min === 'number' &&
      typeof healthyRanges.temperature.max === 'number' &&
      typeof healthyRanges.humidity.min === 'number' &&
      typeof healthyRanges.humidity.max === 'number' &&
      typeof healthyRanges.soilMoisture.min === 'number' &&
      typeof healthyRanges.soilMoisture.max === 'number'
    ) {
      const newCrop = {
        id: uuidv4(),
        name: name.trim(),
        settings,
        healthyRanges
      };
      sensorDataHistory.crops.push(newCrop);
      saveSensorDataHistory();
      console.log(`Crop added: ${newCrop.name}`);
      res.json({ success: true, cropId: newCrop.id });
    } else {
      res.status(400).json({ error: 'Invalid crop data' });
    }
  } catch (error) {
    console.error('Error in /addCrop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/updateCrop', (req, res) => {
  try {
    const { cropId, name, settings, healthyRanges } = req.body;
    const crop = sensorDataHistory.crops.find(c => c.id === cropId);
    if (crop) {
      if (
        typeof name === 'string' && name.trim() &&
        settings &&
        typeof settings.fanTemperatureThreshold === 'number' &&
        typeof settings.lightOnDuration === 'number' && settings.lightOnDuration > 0 &&
        typeof settings.lightIntervalManual === 'number' && settings.lightIntervalManual > 0 &&
        Number.isInteger(settings.pumpStartHour) && settings.pumpStartHour >= 0 && settings.pumpStartHour <= 23 &&
        Number.isInteger(settings.pumpStartMinute) && settings.pumpStartMinute >= 0 && settings.pumpStartMinute <= 59 &&
        Number.isInteger(settings.pumpDuration) && settings.pumpDuration > 0 &&
        Number.isInteger(settings.pumpInterval) && settings.pumpInterval > 0 &&
        healthyRanges &&
        typeof healthyRanges.temperature.min === 'number' &&
        typeof healthyRanges.temperature.max === 'number' &&
        typeof healthyRanges.humidity.min === 'number' &&
        typeof healthyRanges.humidity.max === 'number' &&
        typeof healthyRanges.soilMoisture.min === 'number' &&
        typeof healthyRanges.soilMoisture.max === 'number'
      ) {
        crop.name = name.trim();
        crop.settings = settings;
        crop.healthyRanges = healthyRanges;
        if (sensorDataHistory.selectedCrop === cropId) {
          lightingSettings = { ...settings };
          pumpSettings = { ...settings };
        }
        saveSensorDataHistory();
        console.log(`Crop updated: ${crop.name}`);
        res.json({ success: true });
      } else {
        res.status(400).json({ error: 'Invalid crop data' });
      }
    } else {
      res.status(400).json({ error: 'Crop not found' });
    }
  } catch (error) {
    console.error('Error in /updateCrop:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});
