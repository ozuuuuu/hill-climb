/**
 * Amour Vault — Private, 48-Hour Ephemeral Couple Chat
 * Client Engine: Zero-Knowledge AES-256 Encryption, Real-Time WebSocket Relay,
 * 48-Hour Auto-Purge Engine, Voice Memos, Love Doodles, & Stealth Mode.
 */

// Global State
const STATE = {
  roomId: '',
  passkey: '',
  cryptoKey: null,
  userName: '',
  partnerName: 'Sweetheart',
  userAvatar: '👑',
  partnerAvatar: '🌸',
  anniversaryDate: null,
  ws: null,
  broadcastChannel: null,
  messages: [],
  activeTheme: 'midnight',
  isRecording: false,
  mediaRecorder: null,
  audioChunks: [],
  recordStartTime: 0,
  recordTimerInterval: null,
  typingTimeout: null,
  capsulePresetHours: 1
};

const EXPIRY_DURATION_MS = 48 * 60 * 60 * 1000; // 48 Hours

document.addEventListener('DOMContentLoaded', () => {
  initGateForm();
  initThemePicker();
  initStealthMode();
  initDoodleCanvas();
  initTimeCapsuleModal();
  initChatEvents();
  initHeartbeatButton();
  initExpiryTicker();
});

/* ==========================================================================
   1. Cryptography Engine (Web Crypto API — PBKDF2 + AES-GCM 256-bit)
   ========================================================================== */

/**
 * Derives a 256-bit AES-GCM key from the room passkey + room ID salt
 */
async function deriveCryptoKey(passkey, roomId) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passkey),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  const salt = enc.encode(`hillclimb_vault_salt_${roomId.toLowerCase().trim()}`);

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt,
      iterations: 100000,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts a JavaScript object into ciphertext
 */
async function encryptPayload(dataObj, key) {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = enc.encode(JSON.stringify(dataObj));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv },
    key,
    encoded
  );

  return {
    iv: bufToHex(iv),
    cipher: bufToHex(ciphertext)
  };
}

/**
 * Decrypts ciphertext back into a JavaScript object
 */
async function decryptPayload(encryptedObj, key) {
  try {
    const iv = hexToBuf(encryptedObj.iv);
    const cipher = hexToBuf(encryptedObj.cipher);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv },
      key,
      cipher
    );

    const dec = new TextDecoder();
    return JSON.parse(dec.decode(decrypted));
  } catch (err) {
    console.warn('Decryption failed. (Wrong passkey or corrupted payload)', err);
    return null;
  }
}

function bufToHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes.buffer;
}

/* ==========================================================================
   2. Gate & Room Access
   ========================================================================== */

function initGateForm() {
  const gateForm = document.getElementById('gate-form');
  const btnGenerate = document.getElementById('btn-generate-room');
  const roomInput = document.getElementById('room-code-input');
  const passToggle = document.getElementById('btn-toggle-pass');
  const passInput = document.getElementById('room-passkey-input');
  const userInput = document.getElementById('user-nickname-input');

  // Load saved session if exists
  const savedSession = sessionStorage.getItem('hillclimb_session');
  if (savedSession) {
    try {
      const s = JSON.parse(savedSession);
      if (roomInput) roomInput.value = s.roomId || '';
      if (passInput) passInput.value = s.passkey || '';
      if (userInput) userInput.value = s.userName || '';
      STATE.userAvatar = s.userAvatar || '👑';
    } catch (e) {}
  }

  // Generate cute random room code
  if (btnGenerate && roomInput) {
    btnGenerate.addEventListener('click', () => {
      const adjectives = ['LOVE', 'SWEET', 'HONEY', 'HEART', 'MOON', 'ANGEL', 'STARRY', 'FOREVER'];
      const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
      const num = Math.floor(1000 + Math.random() * 9000);
      roomInput.value = `${adj}-${num}`;
    });
  }

  // Toggle passkey visibility
  if (passToggle && passInput) {
    passToggle.addEventListener('click', () => {
      passInput.type = passInput.type === 'password' ? 'text' : 'password';
    });
  }

  // Submit gate form
  if (gateForm) {
    gateForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const userName = userInput.value.trim();
      const roomId = roomInput.value.trim().toUpperCase();
      const passkey = passInput.value.trim();

      if (!userName || !roomId || !passkey) {
        showToast('⚠️ Missing Info', 'Please enter your Unique Name, Room Code, and Passkey.');
        return;
      }

      const enterBtn = document.getElementById('btn-enter-vault');
      if (enterBtn) {
        enterBtn.disabled = true;
        enterBtn.innerHTML = 'Securing Sanctuary... 🔒';
      }

      try {
        // Derive crypto key from passkey
        STATE.cryptoKey = await deriveCryptoKey(passkey, roomId);
        STATE.roomId = roomId;
        STATE.passkey = passkey;
        STATE.userName = userName;
        STATE.userAvatar = getAvatarForName(userName);
        STATE.partnerName = 'Sweetheart';

        // Persist session
        sessionStorage.setItem('hillclimb_session', JSON.stringify({
          roomId, passkey, userName, userAvatar: STATE.userAvatar
        }));

        // Update UI Header
        document.getElementById('display-room-code').textContent = roomId;
        document.getElementById('hdr-partner-name').textContent = STATE.partnerName;
        document.getElementById('hdr-my-avatar').textContent = STATE.userAvatar;
        document.getElementById('typing-partner-label').textContent = `${STATE.partnerName} is typing`;

        updateRelationshipCounter();

        // Switch views
        document.getElementById('gate-screen').style.display = 'none';
        document.getElementById('chat-app').style.display = 'flex';

        // Connect to real-time relay
        initRealtimeRelay();

        showToast('Sanctuary Opened 💕', `Welcome ${userName}! Connected to room ${roomId}.`);
      } catch (err) {
        console.error(err);
        showToast('Error', 'Could not open vault. Please try again.');
        if (enterBtn) {
          enterBtn.disabled = false;
          enterBtn.innerHTML = 'Enter Private Sanctuary 💕';
        }
      }
    });
  }

  // One-click copy room code
  const copyBtn = document.getElementById('btn-copy-code');
  if (copyBtn) {
    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(STATE.roomId);
      showToast('Copied! 🔑', `Room Code ${STATE.roomId} copied to clipboard.`);
    });
  }
}

const CUTE_AVATARS = ['👑', '🌸', '🦊', '🐱', '🐻', '🍓', '🌙', '💖', '✨', '🦋', '🌹', '🎀'];
function getAvatarForName(name) {
  if (!name) return '👑';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % CUTE_AVATARS.length;
  return CUTE_AVATARS[index];
}

function updateRelationshipCounter() {
  const counterEl = document.getElementById('relationship-counter');
  if (STATE.anniversaryDate) {
    const start = new Date(STATE.anniversaryDate);
    const now = new Date();
    const diffTime = Math.abs(now - start);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    counterEl.textContent = `Day ${diffDays} of Our Love 💕`;
  } else {
    counterEl.textContent = `Our Private Space ✨`;
  }
}

/* ==========================================================================
   3. Real-Time Relay (WebSocket + BroadcastChannel Fallback)
   ========================================================================== */

function initRealtimeRelay() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsUrl = `${protocol}//${window.location.host}`;

  try {
    STATE.ws = new WebSocket(wsUrl);

    STATE.ws.onopen = () => {
      // Send join message
      STATE.ws.send(JSON.stringify({
        type: 'join',
        roomId: STATE.roomId,
        name: STATE.userName
      }));
      setOnlineIndicator(true);
    };

    STATE.ws.onmessage = async (event) => {
      try {
        const data = JSON.parse(event.data);
        handleIncomingRelay(data);
      } catch (err) {
        console.error('Error handling WS data:', err);
      }
    };

    STATE.ws.onclose = () => {
      setOnlineIndicator(false);
      // Reconnect after 3 seconds
      setTimeout(initRealtimeRelay, 3000);
    };
  } catch (err) {
    console.warn('WebSocket unavailable, activating BroadcastChannel fallback for multi-tab sync.', err);
  }

  // Cross-tab fallback channel
  if ('BroadcastChannel' in window) {
    STATE.broadcastChannel = new BroadcastChannel(`hillclimb_${STATE.roomId}`);
    STATE.broadcastChannel.onmessage = async (event) => {
      handleIncomingRelay(event.data);
    };
  }
}

function setOnlineIndicator(isOnline) {
  const indicator = document.getElementById('partner-presence-status');
  if (indicator) {
    indicator.className = `status-indicator ${isOnline ? 'online' : ''}`;
  }
}

async function handleIncomingRelay(data) {
  switch (data.type) {
    case 'history_sync': {
      if (Array.isArray(data.messages)) {
        for (const encryptedMsg of data.messages) {
          await processAndRenderMessage(encryptedMsg);
        }
      }
      break;
    }

    case 'new_message': {
      await processAndRenderMessage(data.message);
      break;
    }

    case 'heartbeat_pulse': {
      triggerHeartParticles();
      playHeartChime();
      const sender = data.sender || STATE.partnerName;
      if (sender && sender !== STATE.userName) {
        STATE.partnerName = sender;
        document.getElementById('hdr-partner-name').textContent = sender;
        document.getElementById('typing-partner-label').textContent = `${sender} is typing`;
      }
      showToast('💓 Heartbeat Pulse', `${sender} is thinking of you right now!`);
      break;
    }

    case 'typing': {
      const typingEl = document.getElementById('typing-indicator');
      if (data.isTyping && data.sender !== STATE.userName) {
        STATE.partnerName = data.sender;
        document.getElementById('hdr-partner-name').textContent = data.sender;
        document.getElementById('typing-partner-label').textContent = `${data.sender} is typing`;
        typingEl.style.display = 'flex';
      } else {
        typingEl.style.display = 'none';
      }
      break;
    }

    case 'room_presence': {
      setOnlineIndicator(data.activeCount > 1);
      if (data.status === 'online' && data.user !== STATE.userName) {
        STATE.partnerName = data.user;
        STATE.partnerAvatar = getAvatarForName(data.user);
        document.getElementById('hdr-partner-name').textContent = data.user;
        document.getElementById('hdr-partner-avatar').textContent = STATE.partnerAvatar;
        document.getElementById('typing-partner-label').textContent = `${data.user} is typing`;
        showToast('Partner Online 💖', `${data.user} has entered your sanctuary.`);
      }
      break;
    }

    case 'room_cleared': {
      STATE.messages = [];
      document.getElementById('messages-stream').innerHTML = '';
      showToast('Sanctuary Cleared 🔥', 'All messages have been burned permanently.');
      break;
    }
  }
}

function broadcastLocal(data) {
  if (STATE.ws && STATE.ws.readyState === WebSocket.OPEN) {
    STATE.ws.send(JSON.stringify(data));
  }
  if (STATE.broadcastChannel) {
    STATE.broadcastChannel.postMessage(data);
  }
}

/* ==========================================================================
   4. Message Dispatch, Encryption, & Expiry Rendering
   ========================================================================== */

async function sendMessage(payload) {
  if (!STATE.cryptoKey) return;

  const now = Date.now();
  const messageId = `msg_${now}_${Math.random().toString(36).substr(2, 9)}`;

  const unencryptedMessage = {
    id: messageId,
    sender: STATE.userName,
    avatar: STATE.userAvatar,
    createdAt: now,
    expiresAt: now + EXPIRY_DURATION_MS,
    payload: payload
  };

  // Encrypt the payload with AES-256-GCM
  const encryptedPayload = await encryptPayload(unencryptedMessage, STATE.cryptoKey);

  const envelope = {
    id: messageId,
    createdAt: now,
    expiresAt: now + EXPIRY_DURATION_MS,
    encryptedData: encryptedPayload
  };

  // Broadcast to server / channel
  broadcastLocal({
    type: 'chat_message',
    roomId: STATE.roomId,
    message: envelope
  });
}

async function processAndRenderMessage(envelope) {
  // Prevent duplicate rendering
  if (STATE.messages.some(m => m.id === envelope.id)) return;

  const now = Date.now();
  // Skip if already expired
  if (envelope.expiresAt && now > envelope.expiresAt) return;

  // Decrypt
  const decrypted = await decryptPayload(envelope.encryptedData, STATE.cryptoKey);
  if (!decrypted) return;

  STATE.messages.push(decrypted);

  // Hide welcome hero card once we have messages
  const welcomeCard = document.getElementById('vault-welcome-card');
  if (welcomeCard) welcomeCard.style.display = 'none';

  renderMessageBubble(decrypted);
}

function renderMessageBubble(msg) {
  const stream = document.getElementById('messages-stream');
  const isMe = msg.sender === STATE.userName;

  if (!isMe && msg.sender) {
    STATE.partnerName = msg.sender;
    STATE.partnerAvatar = msg.avatar || getAvatarForName(msg.sender);
    const partnerHdr = document.getElementById('hdr-partner-name');
    const partnerAv = document.getElementById('hdr-partner-avatar');
    if (partnerHdr) partnerHdr.textContent = msg.sender;
    if (partnerAv) partnerAv.textContent = STATE.partnerAvatar;
  }

  const row = document.createElement('div');
  row.className = `message-row ${isMe ? 'me' : 'partner'}`;
  row.id = `msg-${msg.id}`;
  row.dataset.expiresAt = msg.expiresAt;

  const timeStr = new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const remainingStr = calculateRemainingTime(msg.expiresAt);

  let bubbleContent = '';

  switch (msg.payload.type) {
    case 'text':
      bubbleContent = `<div class="msg-bubble">${escapeHtml(msg.payload.text)}</div>`;
      break;

    case 'doodle':
      bubbleContent = `
        <div class="msg-bubble doodle-bubble">
          <img src="${msg.payload.dataUrl}" alt="Love Doodle" class="doodle-preview-img">
        </div>`;
      break;

    case 'image':
      bubbleContent = `
        <div class="msg-bubble photo-bubble">
          <img src="${msg.payload.dataUrl}" alt="Photo" class="photo-preview-img">
        </div>`;
      break;

    case 'voice':
      bubbleContent = `
        <div class="msg-bubble voice-bubble">
          <div class="voice-memo-player" id="voice-player-${msg.id}">
            <button type="button" class="btn-play-voice" onclick="playVoiceMemo('${msg.id}', '${msg.payload.audioData}')">▶</button>
            <div class="voice-waveform">
              <span class="wave-bar"></span><span class="wave-bar"></span><span class="wave-bar"></span>
              <span class="wave-bar"></span><span class="wave-bar"></span><span class="wave-bar"></span><span class="wave-bar"></span>
            </div>
            <span class="voice-duration">${msg.payload.duration || '0:03'}</span>
          </div>
        </div>`;
      break;

    case 'capsule':
      const isUnlocked = Date.now() >= msg.payload.unlocksAt;
      if (isUnlocked) {
        bubbleContent = `
          <div class="msg-bubble capsule-bubble unlocked">
            <div class="capsule-sealed-header">✨ Unlocked Time Capsule</div>
            <p>${escapeHtml(msg.payload.secretText)}</p>
          </div>`;
      } else {
        const unlockDate = new Date(msg.payload.unlocksAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
        bubbleContent = `
          <div class="msg-bubble capsule-bubble">
            <div class="capsule-sealed-header">🔒 Sealed Time Capsule</div>
            <div class="capsule-hint-text">"${escapeHtml(msg.payload.hint || 'A secret love note for later')}"</div>
            <div class="capsule-timer-pill">Unlocks: ${unlockDate}</div>
          </div>`;
      }
      break;
  }

  row.innerHTML = `
    <div class="msg-avatar" title="${escapeHtml(msg.sender)}">${msg.avatar || (isMe ? STATE.userAvatar : STATE.partnerAvatar)}</div>
    <div class="msg-wrapper">
      <span class="msg-sender-name">${isMe ? 'You' : escapeHtml(msg.sender)}</span>
      ${bubbleContent}
      <div class="msg-meta-row">
        <span class="msg-time">${timeStr}</span>
        <span class="msg-expiry-tag" id="expiry-${msg.id}">⏳ ${remainingStr} left</span>
      </div>
    </div>
  `;

  stream.appendChild(row);

  // Scroll to bottom
  const container = document.getElementById('chat-main');
  container.scrollTop = container.scrollHeight;
}

function calculateRemainingTime(expiresAt) {
  const diff = expiresAt - Date.now();
  if (diff <= 0) return 'Expiring...';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

// 48-Hour Live Expiry Ticker & Auto-Destruct Engine
function initExpiryTicker() {
  setInterval(() => {
    const now = Date.now();
    const messageRows = document.querySelectorAll('.message-row');

    messageRows.forEach(row => {
      const expiresAt = parseInt(row.dataset.expiresAt);
      if (expiresAt) {
        if (now >= expiresAt) {
          // Burn message permanently
          row.style.transition = 'all 0.5s ease';
          row.style.opacity = '0';
          row.style.transform = 'scale(0.8)';
          setTimeout(() => row.remove(), 500);
        } else {
          const badge = row.querySelector('.msg-expiry-tag');
          if (badge) {
            badge.textContent = `⏳ ${calculateRemainingTime(expiresAt)} left`;
          }
        }
      }
    });
  }, 30 * 1000);
}

/* ==========================================================================
   5. Chat Controls, Typing & Emojis
   ========================================================================== */

function initChatEvents() {
  const form = document.getElementById('chat-form');
  const input = document.getElementById('message-input');
  const quickEmojis = document.querySelectorAll('.quick-emoji');
  const imageInput = document.getElementById('image-file-input');

  // Submit text message
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;

    sendMessage({ type: 'text', text });
    input.value = '';
    input.style.height = 'auto';

    // Broadcast stopped typing
    broadcastLocal({
      type: 'typing',
      roomId: STATE.roomId,
      sender: STATE.userName,
      isTyping: false
    });
  });

  // Enter to send (Shift+Enter for newline)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.dispatchEvent(new Event('submit'));
    }
  });

  // Typing indicator
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;

    broadcastLocal({
      type: 'typing',
      roomId: STATE.roomId,
      sender: STATE.userName,
      isTyping: true
    });

    clearTimeout(STATE.typingTimeout);
    STATE.typingTimeout = setTimeout(() => {
      broadcastLocal({
        type: 'typing',
        roomId: STATE.roomId,
        sender: STATE.userName,
        isTyping: false
      });
    }, 2000);
  });

  // Quick emojis
  quickEmojis.forEach(btn => {
    btn.addEventListener('click', () => {
      sendMessage({ type: 'text', text: btn.dataset.emoji });
    });
  });

  // Image Upload & Encryption
  imageInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      // Scale down image if needed for fast transmission
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const maxDim = 800;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.82);

        sendMessage({ type: 'image', dataUrl });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
    imageInput.value = '';
  });

  // Settings dropdown
  const btnSettings = document.getElementById('btn-settings-menu');
  const settingsDropdown = document.getElementById('settings-dropdown');
  btnSettings.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsDropdown.classList.toggle('show');
  });

  document.addEventListener('click', () => {
    settingsDropdown.classList.remove('show');
  });

  // Clear Chat Now
  document.getElementById('btn-clear-chat').addEventListener('click', () => {
    if (confirm('🔥 Burn all messages in this room permanently? This cannot be undone.')) {
      broadcastLocal({
        type: 'clear_room',
        roomId: STATE.roomId
      });
    }
  });

  // Leave room
  document.getElementById('btn-leave-room').addEventListener('click', () => {
    sessionStorage.removeItem('hillclimb_session');
    location.reload();
  });

  // Voice Note trigger
  document.getElementById('btn-start-record').addEventListener('click', startVoiceRecording);
  document.getElementById('btn-cancel-recording').addEventListener('click', cancelVoiceRecording);
  document.getElementById('btn-send-recording').addEventListener('click', stopAndSendVoiceRecording);
}

/* ==========================================================================
   6. Voice Note Recording Engine
   ========================================================================== */

async function startVoiceRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    STATE.audioChunks = [];
    STATE.mediaRecorder = new MediaRecorder(stream);

    STATE.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) STATE.audioChunks.push(e.data);
    };

    STATE.mediaRecorder.start();
    STATE.isRecording = true;
    STATE.recordStartTime = Date.now();

    document.getElementById('recording-bar').style.display = 'flex';

    // Update live timer
    const timerEl = document.getElementById('rec-timer');
    STATE.recordTimerInterval = setInterval(() => {
      const elapsedSec = Math.floor((Date.now() - STATE.recordStartTime) / 1000);
      const m = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const s = String(elapsedSec % 60).padStart(2, '0');
      timerEl.textContent = `${m}:${s}`;
    }, 500);

  } catch (err) {
    showToast('Mic Access', 'Please allow microphone access to record voice notes.');
  }
}

function cancelVoiceRecording() {
  if (STATE.mediaRecorder && STATE.isRecording) {
    STATE.mediaRecorder.stop();
    STATE.isRecording = false;
    clearInterval(STATE.recordTimerInterval);
    document.getElementById('recording-bar').style.display = 'none';
  }
}

function stopAndSendVoiceRecording() {
  if (!STATE.mediaRecorder || !STATE.isRecording) return;

  const durationSec = Math.max(1, Math.floor((Date.now() - STATE.recordStartTime) / 1000));
  const durStr = `0:${String(durationSec).padStart(2, '0')}`;

  STATE.mediaRecorder.onstop = () => {
    const blob = new Blob(STATE.audioChunks, { type: 'audio/webm' });
    const reader = new FileReader();
    reader.onloadend = () => {
      sendMessage({
        type: 'voice',
        audioData: reader.result,
        duration: durStr
      });
    };
    reader.readAsDataURL(blob);
  };

  STATE.mediaRecorder.stop();
  STATE.isRecording = false;
  clearInterval(STATE.recordTimerInterval);
  document.getElementById('recording-bar').style.display = 'none';
}

window.playVoiceMemo = function(msgId, audioData) {
  const audio = new Audio(audioData);
  const player = document.getElementById(`voice-player-${msgId}`);
  if (player) player.classList.add('playing');

  audio.onended = () => {
    if (player) player.classList.remove('playing');
  };
  audio.play();
};

/* ==========================================================================
   7. Love Doodle Drawing Canvas Modal
   ========================================================================== */

function initDoodleCanvas() {
  const modal = document.getElementById('doodle-modal');
  const canvas = document.getElementById('doodle-canvas');
  const ctx = canvas.getContext('2d');
  const openBtn = document.getElementById('btn-open-doodle');
  const closeBtn = document.getElementById('btn-close-doodle');
  const cancelBtn = document.getElementById('btn-cancel-doodle');
  const sendBtn = document.getElementById('btn-send-doodle');
  const clearBtn = document.getElementById('btn-clear-canvas');
  const eraserBtn = document.getElementById('btn-eraser');
  const brushSlider = document.getElementById('brush-size');
  const colorDots = document.querySelectorAll('.color-dot');

  let isDrawing = false;
  let currentColor = '#ff3366';
  let isEraser = false;

  openBtn.addEventListener('click', () => {
    modal.style.display = 'flex';
    clearCanvas();
  });

  const closeModal = () => modal.style.display = 'none';
  closeBtn.addEventListener('click', closeModal);
  cancelBtn.addEventListener('click', closeModal);

  function clearCanvas() {
    ctx.fillStyle = '#0d0a14';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  clearBtn.addEventListener('click', clearCanvas);

  colorDots.forEach(dot => {
    dot.addEventListener('click', () => {
      colorDots.forEach(d => d.classList.remove('active'));
      dot.classList.add('active');
      currentColor = dot.dataset.color;
      isEraser = false;
    });
  });

  eraserBtn.addEventListener('click', () => {
    isEraser = !isEraser;
    eraserBtn.style.background = isEraser ? 'rgba(255, 51, 102, 0.4)' : '';
  });

  // Touch & Mouse Drawing
  function startDraw(x, y) {
    isDrawing = true;
    ctx.beginPath();
    ctx.moveTo(x, y);
  }

  function draw(x, y) {
    if (!isDrawing) return;
    ctx.lineWidth = brushSlider.value;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = isEraser ? '#0d0a14' : currentColor;
    ctx.lineTo(x, y);
    ctx.stroke();
  }

  function stopDraw() {
    isDrawing = false;
    ctx.closePath();
  }

  // Mouse events
  canvas.addEventListener('mousedown', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    startDraw((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
  });

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    draw((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
  });

  window.addEventListener('mouseup', stopDraw);

  // Touch events
  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    startDraw((touch.clientX - rect.left) * scaleX, (touch.clientY - rect.top) * scaleY);
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    const touch = e.touches[0];
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    draw((touch.clientX - rect.left) * scaleX, (touch.clientY - rect.top) * scaleY);
  }, { passive: false });

  canvas.addEventListener('touchend', stopDraw);

  // Send Doodle
  sendBtn.addEventListener('click', () => {
    const dataUrl = canvas.toDataURL('image/png');
    sendMessage({ type: 'doodle', dataUrl });
    closeModal();
  });
}

/* ==========================================================================
   8. Time Capsule Modal
   ========================================================================== */

function initTimeCapsuleModal() {
  const modal = document.getElementById('capsule-modal');
  const openBtn = document.getElementById('btn-open-capsule');
  const closeBtn = document.getElementById('btn-close-capsule');
  const sealBtn = document.getElementById('btn-seal-capsule');
  const presetBtns = document.querySelectorAll('.btn-capsule-preset');

  openBtn.addEventListener('click', () => modal.style.display = 'flex');
  closeBtn.addEventListener('click', () => modal.style.display = 'none');

  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.capsulePresetHours = parseInt(btn.dataset.hours);
    });
  });

  sealBtn.addEventListener('click', () => {
    const hint = document.getElementById('capsule-hint-input').value.trim();
    const secretText = document.getElementById('capsule-text-input').value.trim();

    if (!secretText) {
      showToast('⚠️ Missing Text', 'Please write your secret message.');
      return;
    }

    const unlocksAt = Date.now() + (STATE.capsulePresetHours * 60 * 60 * 1000);

    sendMessage({
      type: 'capsule',
      hint: hint || 'Secret Love Letter 💌',
      secretText: secretText,
      unlocksAt: unlocksAt
    });

    document.getElementById('capsule-hint-input').value = '';
    document.getElementById('capsule-text-input').value = '';
    modal.style.display = 'none';
    showToast('Time Capsule Sealed 🔒', `Locked until ${new Date(unlocksAt).toLocaleTimeString()}`);
  });
}

/* ==========================================================================
   9. Heartbeat Pulse & Floating Particles
   ========================================================================== */

function initHeartbeatButton() {
  const btn = document.getElementById('btn-send-heartbeat');
  btn.addEventListener('click', () => {
    triggerHeartParticles();
    playHeartChime();

    broadcastLocal({
      type: 'heartbeat_pulse',
      roomId: STATE.roomId,
      sender: STATE.userName
    });

    showToast('Pulse Sent 💓', 'Heartbeat vibration sent to your partner!');
  });
}

function triggerHeartParticles() {
  const container = document.getElementById('heart-particles-container');
  const emojis = ['💖', '💕', '💗', '💓', '✨', '🌹', '🥰'];

  for (let i = 0; i < 15; i++) {
    const heart = document.createElement('div');
    heart.className = 'floating-heart';
    heart.textContent = emojis[Math.floor(Math.random() * emojis.length)];
    heart.style.left = `${Math.random() * 90 + 5}%`;
    heart.style.animationDelay = `${Math.random() * 0.8}s`;
    heart.style.fontSize = `${Math.random() * 1.5 + 1.2}rem`;

    container.appendChild(heart);
    setTimeout(() => heart.remove(), 3500);
  }
}

// Gentle Web Audio API synthesizer chime
function playHeartChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, ctx.currentTime); // C5
    osc.frequency.exponentialRampToValueAtTime(659.25, ctx.currentTime + 0.2); // E5
    osc.frequency.exponentialRampToValueAtTime(783.99, ctx.currentTime + 0.4); // G5

    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.6);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.6);
  } catch (e) {}
}

/* ==========================================================================
   10. Stealth / Panic Decoy Mode
   ========================================================================== */

function initStealthMode() {
  const stealthScreen = document.getElementById('stealth-screen');
  const stealthBtn = document.getElementById('btn-stealth-mode');
  const exitBtn = document.getElementById('btn-exit-stealth');

  function toggleStealth() {
    const isHidden = stealthScreen.style.display === 'none';
    stealthScreen.style.display = isHidden ? 'flex' : 'none';
  }

  stealthBtn.addEventListener('click', toggleStealth);
  exitBtn.addEventListener('click', toggleStealth);

  // Global ESC key toggle
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      toggleStealth();
    }
  });
}

/* ==========================================================================
   11. Theme Switcher
   ========================================================================== */

function initThemePicker() {
  const menuBtn = document.getElementById('btn-theme-menu');
  const dropdown = document.getElementById('theme-dropdown');
  const items = document.querySelectorAll('.theme-select-item');

  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('show');
  });

  document.addEventListener('click', () => {
    dropdown.classList.remove('show');
  });

  items.forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      document.documentElement.setAttribute('data-theme', theme);
      dropdown.classList.remove('show');
      showToast('Theme Changed 🎨', `${btn.textContent}`);
    });
  });
}

/* ==========================================================================
   12. Utilities & Toast Alert
   ========================================================================== */

let toastTimer;
function showToast(title, message) {
  const toast = document.getElementById('toast');
  const titleEl = document.getElementById('toast-title');
  const msgEl = document.getElementById('toast-message');

  titleEl.textContent = title;
  msgEl.textContent = message;

  clearTimeout(toastTimer);
  toast.classList.add('show');

  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
