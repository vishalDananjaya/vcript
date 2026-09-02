/* ===================================================================
   Vcript — serverless group chat
   ---------------------------------------------------------------
   GitHub Pages only serves static files, so there is no backend of
   our own. Instead, every browser connects directly (over secure
   WebSockets) to a public MQTT broker and uses the "vcript code" as
   a topic name. Anyone who connects with the same code is in the
   same group — no server, no database, nothing to deploy.

   Because nothing is stored except "who is currently online" (as a
   retained MQTT message), a group has no data left once the last
   person leaves — that's what satisfies "auto delete when empty".

   NOTE: this uses a public test broker (broker.emqx.io). It is not
   end-to-end encrypted — treat the vcript code like a room name,
   not a secret. For real deployments, point BROKER_URL at your own
   broker with auth.
   =================================================================== */

const BROKER_URL = "wss://broker.emqx.io:8084/mqtt";
const TOPIC_PREFIX = "vcript/v1/";

// ---------- DOM ----------
const authPanel = document.getElementById("authPanel");
const chatPanel = document.getElementById("chatPanel");
const roomStatus = document.getElementById("roomStatus");
const roomCodeEl = document.getElementById("roomCode");
const userCountEl = document.getElementById("userCount");
const chatBox = document.getElementById("chatBox");
const authError = document.getElementById("authError");

const tabs = document.querySelectorAll(".tab");
const createForm = document.getElementById("createForm");
const joinForm = document.getElementById("joinForm");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const jumpBtn = document.getElementById("jumpBtn");

// ---------- state ----------
let client = null;
let currentCode = null;
let currentUser = null;
let chatTopic = null;
let presenceTopicPrefix = null;
let presence = new Map(); // username -> online(bool)

// ---------- tabs ----------
tabs.forEach(tab => {
  tab.addEventListener("click", () => {
    tabs.forEach(t => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
    tab.classList.add("active");
    tab.setAttribute("aria-selected", "true");
    document.querySelectorAll(".auth-form").forEach(f => f.classList.remove("active"));
    document.getElementById(tab.dataset.tab + "Form").classList.add("active");
    hideError();
  });
});

// ---------- helpers ----------
function showError(msg) {
  authError.textContent = msg;
  authError.hidden = false;
}
function hideError() {
  authError.hidden = true;
}

function sanitizeCode(raw) {
  return raw
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[+#/]/g, "")
    .slice(0, 40);
}

function sanitizeName(raw) {
  return raw.trim().replace(/[+#/:]/g, "").slice(0, 20);
}

function colorForUser(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 68%, 62%)`;
}

function appendLine({ text, who, color, system, self }) {
  const line = document.createElement("div");
  line.className = "chat-line" + (system ? " system" : "") + (self ? " self" : "");
  if (who) {
    const whoSpan = document.createElement("span");
    whoSpan.className = "who";
    whoSpan.textContent = who + ":";
    whoSpan.style.color = color || "var(--text)";
    line.appendChild(whoSpan);
  }
  line.appendChild(document.createTextNode(text));
  chatBox.appendChild(line);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function updateUserCount() {
  const online = [...presence.values()].filter(Boolean).length;
  userCountEl.textContent = `${online} online`;
}

function resetToAuth() {
  chatPanel.hidden = true;
  authPanel.hidden = false;
  roomStatus.textContent = "not connected";
  roomStatus.classList.remove("live");
  chatBox.innerHTML = "";
  presence.clear();
  currentCode = null;
  currentUser = null;
  chatTopic = null;
  presenceTopicPrefix = null;
}

// ---------- connect / join ----------
function joinGroup(code, name, mode) {
  code = sanitizeCode(code);
  name = sanitizeName(name);

  if (!code) { showError("Enter a vcript code."); return; }
  if (!name) { showError("Enter a username."); return; }

  hideError();
  currentCode = code;
  currentUser = name;
  chatTopic = TOPIC_PREFIX + code + "/chat";
  presenceTopicPrefix = TOPIC_PREFIX + code + "/presence/";
  const myPresenceTopic = presenceTopicPrefix + encodeURIComponent(name);

  roomStatus.textContent = "connecting...";

  client = mqtt.connect(BROKER_URL, {
    clientId: "vcript_" + code + "_" + name + "_" + Math.random().toString(16).slice(2),
    clean: true,
    reconnectPeriod: 2000,
    will: {
      topic: myPresenceTopic,
      payload: "",
      qos: 1,
      retain: true
    }
  });

  client.on("connect", () => {
    roomStatus.textContent = "connected";
    roomStatus.classList.add("live");

    client.subscribe(chatTopic, { qos: 0 });
    client.subscribe(presenceTopicPrefix + "+", { qos: 1 });

    // announce presence (retained so late joiners see who's online)
    client.publish(myPresenceTopic, "online", { qos: 1, retain: true });

    authPanel.hidden = true;
    chatPanel.hidden = false;
    roomCodeEl.textContent = code;
    chatBox.innerHTML = "";
    presence.clear();
    presence.set(name, true);
    updateUserCount();

    appendLine({
      text: mode === "create"
        ? `group "${code}" created. waiting for others to answer...`
        : `joined group "${code}".`,
      system: true
    });
  });

  client.on("message", (topic, payloadBuf) => {
    const payload = payloadBuf.toString();

    if (topic === chatTopic) {
      if (!payload) return;
      try {
        const msg = JSON.parse(payload);
        appendLine({
          text: msg.text,
          who: msg.user,
          color: msg.color,
          self: msg.user === currentUser
        });
      } catch (e) {
        // ignore malformed payloads
      }
      return;
    }

    if (topic.startsWith(presenceTopicPrefix)) {
      const rawUser = decodeURIComponent(topic.slice(presenceTopicPrefix.length));
      const wasOnline = presence.get(rawUser);

      if (payload === "online") {
        presence.set(rawUser, true);
        if (!wasOnline && rawUser !== currentUser) {
          appendLine({ text: `${rawUser} joined the group.`, system: true });
        }
      } else {
        presence.delete(rawUser);
        if (wasOnline && rawUser !== currentUser) {
          appendLine({ text: `${rawUser} left the group.`, system: true });
        }
      }
      updateUserCount();
    }
  });

  client.on("error", () => {
    roomStatus.textContent = "connection error";
    roomStatus.classList.remove("live");
  });

  client.on("close", () => {
    if (roomStatus) {
      roomStatus.textContent = "disconnected";
      roomStatus.classList.remove("live");
    }
  });
}

// ---------- leave / "jump" ----------
function leaveGroup() {
  if (!client) { resetToAuth(); return; }

  const myPresenceTopic = presenceTopicPrefix + encodeURIComponent(currentUser);

  // clear our retained presence record — this is what makes the
  // group "disappear" once the last member leaves, since no state
  // remains on the broker for that vcript code.
  client.publish(myPresenceTopic, "", { qos: 1, retain: true }, () => {
    client.end(true, () => {
      resetToAuth();
    });
  });
}

// ---------- form handlers ----------
createForm.addEventListener("submit", e => {
  e.preventDefault();
  joinGroup(
    document.getElementById("createCode").value,
    document.getElementById("createName").value,
    "create"
  );
});

joinForm.addEventListener("submit", e => {
  e.preventDefault();
  joinGroup(
    document.getElementById("joinCode").value,
    document.getElementById("joinName").value,
    "join"
  );
});

messageForm.addEventListener("submit", e => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !client || !client.connected) return;

  const msg = {
    user: currentUser,
    text: text,
    color: colorForUser(currentUser),
    ts: Date.now()
  };

  client.publish(chatTopic, JSON.stringify(msg), { qos: 0, retain: false });
  messageInput.value = "";
});

jumpBtn.addEventListener("click", () => {
  leaveGroup();
});

window.addEventListener("beforeunload", () => {
  if (client && client.connected && currentUser) {
    const myPresenceTopic = presenceTopicPrefix + encodeURIComponent(currentUser);
    client.publish(myPresenceTopic, "", { qos: 1, retain: true });
  }
});
