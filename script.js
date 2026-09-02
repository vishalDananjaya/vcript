// State variables
let peer = null;
let connections = [];
let username = "";
let roomCode = "";
let isHost = false;

// DOM Elements
const cgCodeInput = document.getElementById('cg-code');
const unInput = document.getElementById('un-input');
const btnCall = document.getElementById('btn-call');
const btnAnswer = document.getElementById('btn-answer');
const statusIndicator = document.getElementById('status-indicator');
const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const btnPush = document.getElementById('btn-push');
const btnJump = document.getElementById('btn-jump');

// Color palette generator for unique user message colors
function getUserColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = ['#ff79c6', '#50fa7b', '#8be9fd', '#bd93f9', '#ffb86c', '#f1fa8c', '#17a2b8', '#fd7e14'];
  return colors[Math.abs(hash) % colors.length];
}

// Append message into chat box UI
function addMessageToBox(user, text) {
  const line = document.createElement('div');
  line.className = 'chat-line';

  const userSpan = document.createElement('span');
  userSpan.className = 'username';
  userSpan.style.color = getUserColor(user);
  userSpan.textContent = user;

  const textNode = document.createTextNode(` : ${text}`);
  
  line.appendChild(userSpan);
  line.appendChild(textNode);
  chatMessages.appendChild(line);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Update app interface status
function setConnectedState(connected) {
  cgCodeInput.disabled = connected;
  unInput.disabled = connected;
  btnCall.disabled = connected;
  btnAnswer.disabled = connected;
  
  messageInput.disabled = !connected;
  btnPush.disabled = !connected;
  btnJump.disabled = !connected;

  if (!connected) {
    statusIndicator.textContent = "Status: Disconnected";
  }
}

// 1. CALL (HOST / CREATE GROUP)
btnCall.addEventListener('click', () => {
  roomCode = cgCodeInput.value.trim().toLowerCase();
  username = unInput.value.trim();

  if (!roomCode || !username) {
    alert('Please enter both vcript code and username!');
    return;
  }

  isHost = true;
  statusIndicator.textContent = "Status: Creating group host...";

  // Use room code as Peer ID for host
  peer = new Peer(`vcript-room-${roomCode}`);

  peer.on('open', (id) => {
    statusIndicator.textContent = `Status: Room active (${roomCode})`;
    setConnectedState(true);
    addMessageToBox("System", `Group created with code: ${roomCode}`);
  });

  // Listen for incoming members joining
  peer.on('connection', (conn) => {
    connections.push(conn);
    setupConnectionListeners(conn);
  });

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      alert('This room code is already active. Click "Answer" to join instead!');
    } else {
      alert(`Error: ${err.message}`);
    }
    leaveGroup();
  });
});

// 2. ANSWER (JOIN EXISTING GROUP)
btnAnswer.addEventListener('click', () => {
  roomCode = cgCodeInput.value.trim().toLowerCase();
  username = unInput.value.trim();

  if (!roomCode || !username) {
    alert('Please enter both vcript code and username!');
    return;
  }

  isHost = false;
  statusIndicator.textContent = "Status: Connecting to group...";

  // Random Peer ID for joiner
  peer = new Peer();

  peer.on('open', () => {
    const conn = peer.connect(`vcript-room-${roomCode}`);
    connections.push(conn);
    setupConnectionListeners(conn);
  });

  peer.on('error', (err) => {
    alert('Could not find room with this code. Make sure someone created it via "Call" first!');
    leaveGroup();
  });
});

// Setup socket data listeners
function setupConnectionListeners(conn) {
  conn.on('open', () => {
    setConnectedState(true);
    statusIndicator.textContent = `Status: Joined room (${roomCode})`;
    // Send joined notification
    broadcastData({ type: 'msg', user: 'System', text: `${username} joined the chat.` });
    addMessageToBox('System', `${username} joined the chat.`);
  });

  conn.on('data', (data) => {
    if (data.type === 'msg') {
      addMessageToBox(data.user, data.text);
      // Host re-broadcasts to all other joined peers
      if (isHost) {
        connections.forEach(c => {
          if (c !== conn && c.open) c.send(data);
        });
      }
    }
  });

  conn.on('close', () => {
    // Remove closed connection
    connections = connections.filter(c => c !== conn);
    // Auto destroy group clean up if host/all members leave
    if (isHost && connections.length === 0) {
      addMessageToBox('System', 'All users left. Group deleted automatically.');
    }
  });
}

// Broadcast message payload to all connected peers
function broadcastData(payload) {
  connections.forEach(conn => {
    if (conn.open) conn.send(payload);
  });
}

// 3. PUSH MESSAGE (SEND)
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;

  const payload = { type: 'msg', user: username, text: text };
  addMessageToBox(username, text);
  broadcastData(payload);
  messageInput.value = '';
}

btnPush.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

// 4. JUMP (LEAVE GROUP & CLEAN UP)
function leaveGroup() {
  broadcastData({ type: 'msg', user: 'System', text: `${username} left the chat.` });

  connections.forEach(conn => conn.close());
  connections = [];

  if (peer) {
    peer.destroy();
    peer = null;
  }

  setConnectedState(false);
  chatMessages.innerHTML = '';
}

btnJump.addEventListener('click', leaveGroup);
