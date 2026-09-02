// Vcript Real-time Client Engine
let currentMode = 'call';
let activeRoomCode = null;
let activeUsername = null;
let userId = 'user_' + Math.random().toString(36).substring(2, 9);
let broadcastChannel = null;

function switchMode(mode) {
    currentMode = mode;
    document.getElementById('btnText').innerText = mode === 'call' ? 'Call' : 'Answer';
}

function handleRoomAction(e) {
    e.preventDefault();
    const code = document.getElementById('cgCodeInput').value.trim().toUpperCase();
    const username = document.getElementById('usernameInput').value.trim();

    if (!code || !username) return;

    activeRoomCode = code;
    activeUsername = username;

    if (broadcastChannel) broadcastChannel.close();
    broadcastChannel = new BroadcastChannel('vcript_' + code);

    broadcastChannel.onmessage = (event) => {
        if (event.data.type === 'CHAT') {
            appendMessage(event.data.userId === userId ? 'Me' : event.data.username, event.data.text);
        }
    };

    document.getElementById('messageInput').disabled = false;
    document.getElementById('pushBtn').disabled = false;
    document.getElementById('jumpBtn').disabled = false;
    appendMessage('System', `Connected to room ${code}`);
}

function handleSendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text || !activeRoomCode) return;

    input.value = '';
    appendMessage('Me', text);

    if (broadcastChannel) {
        broadcastChannel.postMessage({ type: 'CHAT', username: activeUsername, userId, text });
    }
}

function appendMessage(sender, text) {
    const chatMessages = document.getElementById('chatMessages');
    const msgRow = document.createElement('div');
    msgRow.className = "text-sm flex items-start space-x-2 py-1";
    msgRow.innerHTML = `<span class="font-bold text-red-500">${sender} :</span><span>${text}</span>`;
    chatMessages.appendChild(msgRow);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

function handleLeaveGroup() {
    if (broadcastChannel) broadcastChannel.close();
    activeRoomCode = null;
    document.getElementById('messageInput').disabled = true;
    document.getElementById('pushBtn').disabled = true;
    document.getElementById('jumpBtn').disabled = true;
}