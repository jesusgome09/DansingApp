const STORAGE_USER_NAME = 'dansing_user_name';
const STORAGE_USER_ROLE = 'dansing_user_role';
const STORAGE_ROOM_CODE = 'dansing_room_code';
const STORAGE_SAVED_KEYS = 'dansing_saved_keys';
const STORAGE_SAVED_BPMS = 'dansing_saved_bpms';

let currentSong = null;
let currentSectionId = null;
let globalSemitones = 0;
let localSemitones = 0;
let isDecoupled = false;
let toastTimeout = null;

// METRÓNOMO ESTADO
let currentBpm = 120;
let isMetronomePlaying = false;
let metronomeInterval = null;

// TAMAÑO DE FUENTE
let currentFontSize = 1.15;

document.addEventListener('DOMContentLoaded', () => {
  checkUserSession();
});

function log(msg) {
  const el = document.getElementById('console-log');
  if (!el) return;
  const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  el.innerHTML += `<div><span style="color:#666">[${time}]</span> ${msg}</div>`;
  el.scrollTop = el.scrollHeight;
}

function checkUserSession() {
  const savedName = localStorage.getItem(STORAGE_USER_NAME);
  const savedRole = localStorage.getItem(STORAGE_USER_ROLE);

  if (!savedName || !savedRole) {
    document.getElementById('modal-onboarding').style.display = 'flex';
    document.getElementById('app-content').style.display = 'none';
  } else {
    document.getElementById('modal-onboarding').style.display = 'none';
    document.getElementById('app-content').style.display = 'block';
    
    document.getElementById('profile-info').innerText = `${savedName} (${getRoleBadge(savedRole)})`;
    
    // REGLA STRICTA: SOLO EL BATERISTA VE Y CONTROLA EL METRÓNOMO
    if (savedRole === 'baterista') {
      document.getElementById('metronome-controls').style.display = 'flex';
    } else {
      document.getElementById('metronome-controls').style.display = 'none';
    }

    showWaitingScreen();
    autoConnectNetwork(savedName, savedRole);
  }
}

function getRoleBadge(role) {
  const map = {
    'voces': '🎤 Voces',
    'pianista': '🎹 Pianista',
    'guitarrista': '🎸 Guitarrista',
    'bajista': '🎸 Bajista',
    'baterista': '🥁 Baterista'
  };
  return map[role] || role;
}

function saveUserProfile() {
  const nameInput = document.getElementById('setup-name').value.trim();
  const roleInput = document.getElementById('setup-role').value;

  if (!nameInput) return alert('Ingresa tu nombre');

  const cleanName = nameInput.toLowerCase().replace(/[^a-z0-9]/g, '');
  localStorage.setItem(STORAGE_USER_NAME, cleanName);
  localStorage.setItem(STORAGE_USER_ROLE, roleInput);
  localStorage.setItem(STORAGE_ROOM_CODE, 'ensayo');

  checkUserSession();
}

function resetUserProfile() {
  if (confirm('¿Quieres cambiar tu perfil?')) {
    localStorage.clear();
    location.reload();
  }
}

// RED P2P
function autoConnectNetwork(name, role) {
  const roomCode = localStorage.getItem(STORAGE_ROOM_CODE) || 'ensayo';
  const uniqueSession = Math.floor(Math.random() * 10000);
  const myNetworkId = `${roomCode}-${name}-${uniqueSession}`;

  initPeerNetwork(
    myNetworkId,
    () => {
      document.getElementById('net-status').innerHTML = `<span style="color:var(--accent-orange)">🔍 Buscando al Director...</span>`;
      connectToLeader(roomCode);
    },
    (err) => {
      log(`⚠️ Estado red: ${err.type}`);
      document.getElementById('net-status').innerHTML = `<span style="color:#ff5252">⚠️ Error de red (${err.type || 'desconocido'})</span>`;
    },
    handleIncomingP2PData
  );
}

function connectToLeader(roomCode) {
  const leaderId = `${roomCode}-director`;
  
  connectToPeerWithRetry(leaderId, handleIncomingP2PData, () => {
    document.getElementById('net-status').innerHTML = `<span style="color:var(--accent-green)">✅ Conectado con el Director</span>`;
    log('🔄 Solicitando estado actual al Director...');
    sendP2PData({ type: 'GET_CURRENT_STATE' });
  });
}

function toggleDirector(isDirectorCheck) {
  const checkbox = document.getElementById('director-checkbox');
  const roomCode = localStorage.getItem(STORAGE_ROOM_CODE) || 'ensayo';
  const savedName = localStorage.getItem(STORAGE_USER_NAME);

  if (isDirectorCheck) {
    const leaderId = `${roomCode}-director`;

    initPeerNetwork(
      leaderId,
      () => {
        log('👑 Modo Director ACTIVO.');
        document.getElementById('net-status').innerHTML = `<span style="color:var(--accent-green)">👑 Director Activo</span>`;
        document.getElementById('director-catalog-card').style.display = 'block';
        
        // EL DIRECTOR NUNCA TIENE CONTROLES DE METRÓNOMO A MENOS QUE SEA BATERISTA
        if (localStorage.getItem(STORAGE_USER_ROLE) !== 'baterista') {
          document.getElementById('metronome-controls').style.display = 'none';
        }

        renderCatalog();
      },
      (err) => {
        if (err.type === 'DIRECTOR_TAKEN') {
          alert(`❌ ¡Acceso denegado! Ya hay un Director activo en el ensayo.`);
          checkbox.checked = false;
          document.getElementById('director-catalog-card').style.display = 'none';
        }
      },
      handleIncomingP2PData
    );
  } else {
    document.getElementById('director-catalog-card').style.display = 'none';
    document.getElementById('director-panel').style.display = 'none';
    
    if (localStorage.getItem(STORAGE_USER_ROLE) !== 'baterista') {
      document.getElementById('metronome-controls').style.display = 'none';
    }
    
    showWaitingScreen();
    autoConnectNetwork(savedName, localStorage.getItem(STORAGE_USER_ROLE));
  }
}

// RECEPCIÓN DE DATOS TRAP
function handleIncomingP2PData(data) {
  if (!data) return;

  const isDirector = document.getElementById('director-checkbox')?.checked;

  if (data.type === 'GET_CURRENT_STATE' && isDirector) {
    if (currentSong) {
      sendP2PData({
        type: 'SYNC_STATE',
        songId: currentSong.id,
        semitones: globalSemitones,
        currentSection: currentSectionId,
        bpm: currentBpm,
        isMetroPlaying: isMetronomePlaying
      });
    }
    return;
  }

  if (data.type === 'SYNC_STATE' || data.type === 'OPEN_SONG') {
    currentSong = REPERTORIO.find(s => s.id === data.songId);
    globalSemitones = data.semitones || 0;
    if (!isDecoupled) localSemitones = globalSemitones;

    document.getElementById('waiting-screen').style.display = 'none';
    document.getElementById('song-card').style.display = 'block';
    
    renderCurrentSong();
    
    if (data.currentSection) {
      highlightAndScrollSection(data.currentSection);
    }

    if (data.bpm) {
      currentBpm = data.bpm;
      updateBpmUI(currentBpm);
      if (data.isMetroPlaying && !isMetronomePlaying) {
        startMetronomeVisual();
      } else if (!data.isMetroPlaying && isMetronomePlaying) {
        stopMetronomeVisual();
      }
    }

    log(`🎵 Canción lista: ${currentSong.title}`);
  }

  if (data.type === 'CHANGE_KEY') {
    globalSemitones = data.semitones;
    if (!isDecoupled) {
      localSemitones = globalSemitones;
      renderCurrentSong();
    }
  }

  if (data.type === 'JUMP') {
    currentSectionId = data.target;
    highlightAndScrollSection(data.target);
  }

  if (data.type === 'QUICK_ALERT') {
    showToastAlert(data.message);
  }

  if (data.type === 'START_COUNTDOWN') {
    runCountdownAnimation();
  }

  if (data.type === 'CHAT_MSG') {
    appendChatMessage(data.author, data.text);
  }

  if (data.type === 'UPDATE_METRONOME') {
    currentBpm = data.bpm;
    updateBpmUI(currentBpm);
    
    if (data.isPlaying !== isMetronomePlaying) {
      isMetronomePlaying = data.isPlaying;
      updateMetronomeButtonUI();
      if (isMetronomePlaying) startMetronomeVisual();
      else stopMetronomeVisual();
    }
  }
}

// METRÓNOMO CONTROL EXCLUSIVO BATERISTA (VALORES IMPARES Y LIBRES)
function adjustBpm(delta) {
  if (localStorage.getItem(STORAGE_USER_ROLE) !== 'baterista') return;

  currentBpm = Math.max(40, Math.min(240, parseInt(currentBpm) + delta));
  updateBpmUI(currentBpm);
  
  if (currentSong) saveBpmForSong(currentSong.id, currentBpm);

  if (isMetronomePlaying) {
    stopMetronomeVisual();
    startMetronomeVisual();
  }

  sendP2PData({ type: 'UPDATE_METRONOME', bpm: currentBpm, isPlaying: isMetronomePlaying });
}

function manualBpmInput(val) {
  if (localStorage.getItem(STORAGE_USER_ROLE) !== 'baterista') return;

  let parsed = parseInt(val);
  if (isNaN(parsed)) parsed = 120;
  currentBpm = Math.max(40, Math.min(240, parsed));
  
  updateBpmUI(currentBpm);
  if (currentSong) saveBpmForSong(currentSong.id, currentBpm);

  if (isMetronomePlaying) {
    stopMetronomeVisual();
    startMetronomeVisual();
  }

  sendP2PData({ type: 'UPDATE_METRONOME', bpm: currentBpm, isPlaying: isMetronomePlaying });
}

function updateBpmUI(bpm) {
  document.getElementById('metronome-bpm-display').innerText = `BPM: ${bpm}`;
  const inputEl = document.getElementById('bpm-input');
  if (inputEl) inputEl.value = bpm;
}

function toggleMetronome() {
  if (localStorage.getItem(STORAGE_USER_ROLE) !== 'baterista') return;

  isMetronomePlaying = !isMetronomePlaying;
  updateMetronomeButtonUI();

  if (isMetronomePlaying) startMetronomeVisual();
  else stopMetronomeVisual();

  sendP2PData({ type: 'UPDATE_METRONOME', bpm: currentBpm, isPlaying: isMetronomePlaying });
}

function updateMetronomeButtonUI() {
  const btn = document.getElementById('btn-toggle-metro');
  if (!btn) return;
  if (isMetronomePlaying) {
    btn.innerText = '⏸ Pausa';
    btn.className = 'btn btn-orange';
  } else {
    btn.innerText = '▶ Play';
    btn.className = 'btn btn-cyan';
  }
}

function startMetronomeVisual() {
  if (metronomeInterval) clearInterval(metronomeInterval);
  isMetronomePlaying = true;
  updateMetronomeButtonUI();

  const intervalMs = (60 / currentBpm) * 1000;
  const light = document.getElementById('metronome-light');

  metronomeInterval = setInterval(() => {
    light.classList.add('flash');
    setTimeout(() => light.classList.remove('flash'), 120);
  }, intervalMs);
}

function stopMetronomeVisual() {
  if (metronomeInterval) clearInterval(metronomeInterval);
  isMetronomePlaying = false;
  updateMetronomeButtonUI();
  document.getElementById('metronome-light').classList.remove('flash');
}

function saveBpmForSong(songId, bpm) {
  let saved = JSON.parse(localStorage.getItem(STORAGE_SAVED_BPMS) || '{}');
  saved[songId] = bpm;
  localStorage.setItem(STORAGE_SAVED_BPMS, JSON.stringify(saved));
}

function getSavedBpmForSong(songId) {
  let saved = JSON.parse(localStorage.getItem(STORAGE_SAVED_BPMS) || '{}');
  return saved[songId] !== undefined ? saved[songId] : null;
}

// ABRIR / CERRAR REPERTORIO COMPLETO
function toggleCatalogVisibility() {
  const wrapper = document.getElementById('catalog-foldable-wrapper');
  if (!wrapper) return;
  const isHidden = wrapper.style.display === 'none';
  wrapper.style.display = isHidden ? 'block' : 'none';
  if (isHidden) renderCatalog();
}

// FUNCIONALIDAD DE SETLIST
let setlist = [];

function toggleSetlistSong(songId) {
  const song = REPERTORIO.find(s => s.id === songId);
  if (!song) return;

  const idx = setlist.findIndex(s => s.id === songId);
  if (idx === -1) {
    setlist.push(song);
    log(`➕ Añadida a Setlist: ${song.title}`);
  } else {
    setlist.splice(idx, 1);
    log(`➖ Removida de Setlist: ${song.title}`);
  }

  renderSetlistUI();
  renderCatalog(document.getElementById('catalog-search')?.value || "");
}

function renderSetlistUI() {
  const container = document.getElementById('setlist-items');
  if (!container) return;

  if (setlist.length === 0) {
    container.innerHTML = `<span style="color:#777;">No hay canciones seleccionadas. Toca <b>"📂 Añadir Canciones"</b> para armar tu lista.</span>`;
    return;
  }

  let html = '<div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">';
  setlist.forEach((song, idx) => {
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#181b29; padding:8px 10px; border-radius:6px; border:1px solid #26293b;">
        <span><b>${idx + 1}. ${song.title}</b> <small style="color:var(--accent-orange); margin-left:6px;">${song.keyOriginal}</small></span>
        <button class="btn btn-cyan" style="width:auto; padding:5px 12px; font-size:0.8rem; margin:0;" onclick="directorSelectSong('${song.id}')">▶ Tocar</button>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

// CATÁLOGO COMPACTO Y MINIMALISTA
function renderCatalog(filter = "") {
  const container = document.getElementById('catalog-list');
  if (!container) return;
  container.innerHTML = '';

  const categorias = ["Adoración", "Alabanzas"];

  categorias.forEach(cat => {
    const canciones = REPERTORIO.filter(s => s.category === cat && (s.title.toLowerCase().includes(filter) || s.artist.toLowerCase().includes(filter)));

    if (canciones.length > 0) {
      const header = document.createElement('h4');
      header.style.cssText = 'color:var(--accent-cyan); margin-top:10px; font-size:0.85rem;';
      header.innerText = cat;
      container.appendChild(header);

      canciones.forEach(song => {
        const savedKey = getSavedKeyForSong(song.id);
        const savedBpm = getSavedBpmForSong(song.id) || song.bpm;
        const isInSetlist = setlist.some(s => s.id === song.id);

        const card = document.createElement('div');
        card.style.cssText = 'display:flex; justify-content:space-between; align-items:center; background:#141622; padding:8px 10px; border-radius:6px; margin-bottom:4px; border:1px solid #222;';

        card.innerHTML = `
          <div style="cursor:pointer; flex:1;" onclick="directorSelectSong('${song.id}')">
            <div style="font-weight:bold; font-size:0.9rem;">${song.title}</div>
            <div style="font-size:0.75rem; color:#aaa;">${song.artist} • <span style="color:#64b5f6;">${savedBpm} BPM</span> • <span style="color:var(--accent-orange);">${savedKey !== null ? calcularNotaTono(song.keyOriginal, savedKey) : song.keyOriginal}</span></div>
          </div>
          <button class="btn ${isInSetlist ? 'btn-orange' : 'btn-sec'}" style="width:auto; padding:6px 10px; font-size:0.85rem; margin:0;" onclick="toggleSetlistSong('${song.id}')">
            ${isInSetlist ? '✓ En lista' : '➕'}
          </button>
        `;
        container.appendChild(card);
      });
    }
  });
}

function renderSetlistUI() {
  const container = document.getElementById('setlist-items');
  if (!container) return;

  if (setlist.length === 0) {
    container.innerHTML = "No hay canciones en el Setlist del Domingo.";
    return;
  }

  let html = '<div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">';
  setlist.forEach((song, idx) => {
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#181b29; padding:6px 10px; border-radius:6px;">
        <span><b>${idx + 1}. ${song.title}</b> <small style="color:#aaa">(${song.keyOriginal})</small></span>
        <button class="btn btn-cyan" style="width:auto; padding:4px 8px; font-size:0.75rem;" onclick="directorSelectSong('${song.id}')">▶ Tocar</button>
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

// CATÁLOGO CON OPCIÓN DE AÑADIR AL SETLIST
function renderCatalog(filter = "") {
  const container = document.getElementById('catalog-list');
  container.innerHTML = '';

  const categorias = ["Adoración", "Alabanzas"];

  categorias.forEach(cat => {
    const canciones = REPERTORIO.filter(s => s.category === cat && (s.title.toLowerCase().includes(filter) || s.artist.toLowerCase().includes(filter)));

    if (canciones.length > 0) {
      const header = document.createElement('h4');
      header.style.cssText = 'color:var(--accent-cyan); margin-top:12px; font-size:0.9rem;';
      header.innerText = cat;
      container.appendChild(header);

      canciones.forEach(song => {
        const savedKey = getSavedKeyForSong(song.id);
        const savedBpm = getSavedBpmForSong(song.id) || song.bpm;
        const isInSetlist = setlist.some(s => s.id === song.id);

        const card = document.createElement('div');
        card.style.cssText = 'display:flex; gap:6px; margin-bottom:6px;';

        card.innerHTML = `
          <button class="btn btn-sec" style="flex:1; text-align:left; justify-content:space-between; margin:0; background:#1e2030;" onclick="directorSelectSong('${song.id}')">
            <span><b>${song.title}</b> <small style="color:#aaa">(${song.artist})</small></span>
            <span><small style="color:#64b5f6; margin-right:8px;">${savedBpm} BPM</small><span style="color:var(--accent-orange)">${savedKey !== null ? calcularNotaTono(song.keyOriginal, savedKey) : song.keyOriginal}</span></span>
          </button>
          <button class="btn ${isInSetlist ? 'btn-orange' : 'btn-sec'}" style="width:auto; padding:0 12px; font-size:0.8rem;" onclick="toggleSetlistSong('${song.id}')">
            ${isInSetlist ? '✓' : '+ List'}
          </button>
        `;
        container.appendChild(card);
      });
    }
  });
}

function directorSelectSong(songId) {
  currentSong = REPERTORIO.find(s => s.id === songId);
  currentSectionId = null;
  
  const savedKey = getSavedKeyForSong(songId);
  globalSemitones = savedKey !== null ? savedKey : 0;
  localSemitones = globalSemitones;
  isDecoupled = false;

  currentBpm = getSavedBpmForSong(songId) || currentSong.bpm || 120;
  updateBpmUI(currentBpm);

  if (isMetronomePlaying) {
    isMetronomePlaying = false;
    stopMetronomeVisual();
    updateMetronomeButtonUI();
  }

  document.getElementById('waiting-screen').style.display = 'none';
  document.getElementById('song-card').style.display = 'block';
  document.getElementById('director-panel').style.display = 'block';

  renderCurrentSong();

  sendP2PData({ 
    type: 'OPEN_SONG', 
    songId: songId, 
    semitones: globalSemitones,
    bpm: currentBpm,
    isMetroPlaying: false 
  });
  
  log(`📢 Canción transmitida: ${currentSong.title} (${currentBpm} BPM)`);
}

function renderCurrentSong() {
  if (!currentSong) return;

  const role = localStorage.getItem(STORAGE_USER_ROLE);
  const semitonesToUse = isDecoupled ? localSemitones : globalSemitones;

  document.getElementById('song-title').innerText = `${currentSong.title} - ${currentSong.artist}`;
  
  const transposedContent = transponerTextoCancion(currentSong.content, semitonesToUse);

  const viewer = document.getElementById('song-viewer');
  viewer.style.fontSize = `${currentFontSize}rem`;

  const lines = transposedContent.split('\n');
  let html = '';
  const sections = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const name = trimmed.replace('[', '').replace(']', '');
      const secId = name.toLowerCase().replace(/\s+/g, '');
      sections.push({ name, id: secId });
      html += `<span class="section-header" id="sec-${secId}">${trimmed}</span>`;
    } else if (esLineaAcordes(line)) {
      if (role !== 'voces') {
        html += `<span class="chord">${line}</span>\n`;
      }
    } else {
      html += `${line}\n`;
    }
  });

  viewer.innerHTML = html;
  buildDirectorControls(sections);
  updateKeyControlsUI(semitonesToUse);
}

// CUENTA REGRESIVA CON AUTO-START
function sendCountdownCommand() {
  runCountdownAnimation();
  sendP2PData({ type: 'START_COUNTDOWN' });
  log('⏱️ Cuenta regresiva iniciada...');
}

function runCountdownAnimation() {
  const overlay = document.getElementById('countdown-overlay');
  const numEl = document.getElementById('countdown-number');
  const songInfoEl = document.getElementById('countdown-song-info');
  const keyInfoEl = document.getElementById('countdown-key-info');
  const introContentEl = document.getElementById('countdown-intro-content');
  const introLabelEl = document.getElementById('countdown-intro-label');

  if (!overlay || !numEl || !currentSong) return;

  const role = localStorage.getItem(STORAGE_USER_ROLE);
  const semitonesToUse = isDecoupled ? localSemitones : globalSemitones;
  const notaActual = calcularNotaTono(currentSong.keyOriginal, semitonesToUse);

  songInfoEl.innerText = `🎵 ${currentSong.title}`;
  keyInfoEl.innerText = `Tono: ${notaActual} | ${currentBpm} BPM`;

  const introData = extractIntroContent(currentSong.content, role, semitonesToUse);
  introLabelEl.innerText = role === 'voces' ? "Entrada / Primera línea:" : "Acordes de la Intro:";
  introContentEl.innerText = introData;

  overlay.style.display = 'flex';
  let count = 3;
  numEl.innerText = count;

  const interval = setInterval(() => {
    count--;
    if (count > 0) {
      numEl.innerText = count;
    } else if (count === 0) {
      numEl.innerText = "🔥";
      introLabelEl.innerText = "¡ENTRAMOS YA!";
      
      startMetronomeVisual();
      
    } else {
      clearInterval(interval);
      overlay.style.display = 'none';
    }
  }, 1000);
}

// CHAT FLOTANTE
function toggleChatPanel() {
  const panel = document.getElementById('chat-panel');
  panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  const savedName = localStorage.getItem(STORAGE_USER_NAME) || 'Músico';
  appendChatMessage(savedName, text);

  sendP2PData({ type: 'CHAT_MSG', author: savedName, text: text });
  input.value = '';
}

function appendChatMessage(author, text) {
  const container = document.getElementById('chat-messages');
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-msg';
  msgDiv.innerHTML = `<div class="chat-msg-author">${author}</div><div>${text}</div>`;
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

// FUNCIONES AUXILIARES
function changeFontSize(delta) {
  currentFontSize = Math.max(0.8, Math.min(2.0, currentFontSize + (delta * 0.1)));
  const viewer = document.getElementById('song-viewer');
  if (viewer) viewer.style.fontSize = `${currentFontSize}rem`;
}

function changeKey(delta) {
  const isDirector = document.getElementById('director-checkbox').checked;

  if (isDirector) {
    globalSemitones += delta;
    localSemitones = globalSemitones;
    
    saveKeyForSong(currentSong.id, globalSemitones);

    renderCurrentSong();
    sendP2PData({ type: 'CHANGE_KEY', semitones: globalSemitones });
  } else {
    if (!isDecoupled) toggleDecouple(true);
    localSemitones += delta;
    renderCurrentSong();
  }
}

function saveKeyForSong(songId, semitones) {
  let saved = JSON.parse(localStorage.getItem(STORAGE_SAVED_KEYS) || '{}');
  saved[songId] = semitones;
  localStorage.setItem(STORAGE_SAVED_KEYS, JSON.stringify(saved));
}

function getSavedKeyForSong(songId) {
  let saved = JSON.parse(localStorage.getItem(STORAGE_SAVED_KEYS) || '{}');
  return saved[songId] !== undefined ? saved[songId] : null;
}

function toggleDecouple(forceState) {
  isDecoupled = forceState !== undefined ? forceState : !isDecoupled;
  const btn = document.getElementById('btn-decouple');

  if (isDecoupled) {
    btn.style.background = 'var(--accent-orange)';
    btn.innerText = '🔓 Desacoplado';
  } else {
    isDecoupled = false;
    localSemitones = globalSemitones;
    btn.style.background = '#222538';
    btn.innerText = '🔒 Acoplado';
    renderCurrentSong();
  }
}

function updateKeyControlsUI(semitones) {
  const el = document.getElementById('current-key-display');
  if (!el || !currentSong) return;

  const notaActual = calcularNotaTono(currentSong.keyOriginal, semitones);
  let semitonoTexto = semitones === 0 ? "(Original)" : semitones > 0 ? `(+${semitones})` : `(${semitones})`;

  el.innerText = `Tono: ${notaActual} ${semitonoTexto}`;
}

function buildDirectorControls(sections) {
  const container = document.getElementById('section-buttons');
  if (!container) return;
  container.innerHTML = '';

  const btnCountdown = document.createElement('button');
  btnCountdown.className = 'btn btn-orange';
  btnCountdown.style.cssText = 'margin-bottom: 10px; font-size: 0.95rem;';
  btnCountdown.innerText = '⏱️ Iniciar Cuenta Regresiva (3, 2, 1)';
  btnCountdown.onclick = () => sendCountdownCommand();
  container.appendChild(btnCountdown);

  sections.forEach((sec) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sec';
    btn.innerText = sec.name;
    btn.onclick = () => triggerJump(sec.id);
    container.appendChild(btn);
  });

  const alertContainer = document.createElement('div');
  alertContainer.style.cssText = 'width:100%; margin-top:10px; border-top:1px solid #333; padding-top:8px; display:flex; flex-wrap:wrap; gap:4px;';
  
  const alerts = ["🔁 Repetir Coro", "🛑 Finalizar", "🤫 Solo Voces", "🎹 Instrumental/Espontáneo"];
  alerts.forEach(msg => {
    const btn = document.className = 'btn-alert';
    const b = document.createElement('button');
    b.className = 'btn-alert';
    b.innerText = msg;
    b.onclick = () => sendQuickAlert(msg);
    alertContainer.appendChild(b);
  });

  container.appendChild(alertContainer);
}

function sendMusicianAlert(msg) {
  const savedName = localStorage.getItem(STORAGE_USER_NAME) || 'Músico';
  const fullMsg = `📢 ${savedName.toUpperCase()}: ${msg}`;
  
  showToastAlert(fullMsg);
  sendP2PData({ type: 'QUICK_ALERT', message: fullMsg });
  log(`Enviado aviso: "${fullMsg}"`);
}

function sendQuickAlert(message) {
  showToastAlert(message);
  sendP2PData({ type: 'QUICK_ALERT', message: message });
  log(`📣 Alerta enviada: "${message}"`);
}

function showToastAlert(msg) {
  const toast = document.getElementById('quick-toast');
  if (!toast) return;

  if (toastTimeout) clearTimeout(toastTimeout);

  toast.innerText = msg;
  toast.classList.add('show');

  toastTimeout = setTimeout(() => {
    toast.classList.remove('show');
  }, 7000);
}

function extractIntroContent(content, role, semitones) {
  const lines = content.split('\n');
  let introChords = "";
  let firstLyric = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line.toLowerCase().includes('[intro]')) {
      if (i + 1 < lines.length && esLineaAcordes(lines[i + 1])) {
        introChords = lines[i + 1].trim();
      }
    }
    if (!firstLyric && !esLineaAcordes(line) && !line.startsWith('[') && line.length > 0) {
      firstLyric = line;
    }
  }

  if (role === 'voces') {
    return firstLyric || "Preparados para cantar...";
  } else {
    if (introChords) {
      return transponerTextoCancion(introChords, semitones);
    }
    return `Tocar en Tono ${calcularNotaTono(currentSong.keyOriginal, semitones)}`;
  }
}

function triggerJump(secId) {
  currentSectionId = secId;
  highlightAndScrollSection(secId);
  sendP2PData({ type: 'JUMP', target: secId });
}

function highlightAndScrollSection(secId) {
  const targetEl = document.getElementById(`sec-${secId}`);
  if (!targetEl) return;

  const isDirector = document.getElementById('director-checkbox')?.checked;
  const directorPanel = document.getElementById('director-panel');

  let offsetMargin = 20;

  if (isDirector && directorPanel && directorPanel.style.display !== 'none') {
    offsetMargin = directorPanel.offsetHeight + 15;
  }

  const elementPosition = targetEl.getBoundingClientRect().top + window.pageYOffset;
  const targetY = elementPosition - offsetMargin;

  window.scrollTo({
    top: targetY,
    behavior: 'smooth'
  });

  document.querySelectorAll('.section-highlight').forEach(el => el.classList.remove('section-highlight'));
  targetEl.classList.add('section-highlight');

  setTimeout(() => {
    targetEl.classList.remove('section-highlight');
  }, 2500);
}