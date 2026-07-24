// CLAVES DE ALMACENAMIENTO CON PREFIJO ÚNICO
const STORAGE_USER_NAME     = 'dansing_user_name';
const STORAGE_USER_ROLE     = 'dansing_user_role';
const STORAGE_USER_UUID     = 'dansing_user_uuid';
const STORAGE_ROOM_CODE     = 'dansing_room_code';
const STORAGE_SAVED_KEYS    = 'dansing_saved_keys';
const STORAGE_SAVED_BPMS    = 'dansing_saved_bpms';
const STORAGE_SAVED_SETLIST = 'dansing_saved_setlist';

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

// SETLIST
let setlist = [];

// CONTROL DE VISTAS (STANDBY vs CANCIÓN)
function showWaitingScreen() {
  const waitingEl = document.getElementById('waiting-screen');
  const songCardEl = document.getElementById('song-card');
  if (waitingEl) waitingEl.style.display = 'flex';
  if (songCardEl) songCardEl.style.display = 'none';
}

function showSongScreen() {
  const waitingEl = document.getElementById('waiting-screen');
  const songCardEl = document.getElementById('song-card');
  if (waitingEl) waitingEl.style.display = 'none';
  if (songCardEl) songCardEl.style.display = 'block';
}

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

function getUniqueUserId() {
  let uuid = localStorage.getItem(STORAGE_USER_UUID);
  if (!uuid) {
    uuid = 'user-' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem(STORAGE_USER_UUID, uuid);
  }
  return uuid;
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
    
    if (savedRole === 'tv') {
      document.body.classList.add('mode-tv');
    } else {
      document.body.classList.remove('mode-tv');
    }

    if (savedRole === 'baterista') {
      document.getElementById('metronome-controls').style.display = 'flex';
    } else {
      document.getElementById('metronome-controls').style.display = 'none';
    }

    loadSetlistFromStorage();
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
    'baterista': '🥁 Baterista',
    'tv': '🖥️ Pantalla TV / Stream'
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
  getUniqueUserId();

  checkUserSession();
}

function resetUserProfile() {
  if (confirm('¿Quieres cambiar tu perfil de DansingApp?')) {
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('dansing_')) {
        localStorage.removeItem(key);
      }
    });
    location.reload();
  }
}

// CONEXIÓN P2P
function autoConnectNetwork(name, role) {
  const roomCode = localStorage.getItem(STORAGE_ROOM_CODE) || 'ensayo';
  const myUniqueId = getUniqueUserId();
  const myNetworkId = `${roomCode}-${name}-${myUniqueId}`;

  initPeerNetwork(
    myNetworkId,
    () => {
      document.getElementById('net-status').innerHTML = `<span style="color:var(--accent-orange)">🔍 Buscando al Director...</span>`;
      connectToLeader(roomCode);
    },
    (err) => {
      document.getElementById('net-status').innerHTML = `<span style="color:#ff5252">⚠️ Error de red</span>`;
    },
    handleIncomingP2PData
  );
}

function connectToLeader(roomCode) {
  const leaderId = `${roomCode}-director`;
  connectToPeerWithRetry(leaderId, handleIncomingP2PData, () => {
    sendP2PData({ type: 'GET_CURRENT_STATE' });
  });
}

function applyDirectorAdaptivity() {
  const isDirector = document.getElementById('director-checkbox')?.checked;
  const savedRole = localStorage.getItem(STORAGE_USER_ROLE);

  if (isDirector && savedRole === 'voces') {
    document.body.classList.add('director-voice-mode');
  } else {
    document.body.classList.remove('director-voice-mode');
  }
}

function toggleDirector(isDirectorCheck) {
  const checkbox = document.getElementById('director-checkbox');
  const roomCode = localStorage.getItem(STORAGE_ROOM_CODE) || 'ensayo';
  const savedName = localStorage.getItem(STORAGE_USER_NAME);

  applyDirectorAdaptivity();

  if (isDirectorCheck) {
    document.getElementById('net-status').innerHTML = `<span style="color:var(--accent-orange)">🔍 Comprobando si hay Director activo...</span>`;

    const leaderId = `${roomCode}-director`;

    initPeerNetwork(
      leaderId,
      () => {
        log('👑 Modo Director ACTIVO.');
        document.getElementById('net-status').innerHTML = `<span style="color:var(--accent-green)">👑 Director Activo (${savedName})</span>`;
        document.getElementById('director-catalog-card').style.display = 'block';
        
        sendP2PData({ type: 'DIRECTOR_ANNOUNCE', name: savedName });
        
        renderSetlistUI();
        renderCatalog();
      },
      (err) => {
        if (err.type === 'DIRECTOR_TAKEN') {
          alert(`❌ Hay un Director activo respondiendo en el ensayo.`);
          checkbox.checked = false;
          applyDirectorAdaptivity();
          document.getElementById('director-catalog-card').style.display = 'none';
          renderSetlistUI();
        }
      },
      handleIncomingP2PData
    );

  } else {
    document.getElementById('director-catalog-card').style.display = 'none';
    document.getElementById('director-panel').style.display = 'none';
    showWaitingScreen();
    renderSetlistUI();
    autoConnectNetwork(savedName, localStorage.getItem(STORAGE_USER_ROLE));
  }
}

function triggerTvConnectPop(directorName) {
  const role = localStorage.getItem(STORAGE_USER_ROLE);
  if (role !== 'tv') return;

  let pop = document.getElementById('tv-connect-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'tv-connect-pop';
    document.body.appendChild(pop);
  }

  pop.innerText = `✨ Director Conectado (${directorName})`;
  pop.classList.add('show-pop');

  setTimeout(() => {
    pop.classList.remove('show-pop');
  }, 1500);
}

// RECEPCIÓN DE DATOS Y EVENTOS
function handleIncomingP2PData(data) {
  if (!data) return;

  const isDirector = document.getElementById('director-checkbox')?.checked;

  if (data.type === 'DIRECTOR_ANNOUNCE') {
    document.getElementById('net-status').innerHTML = `<span style="color:var(--accent-green)">👑 Director: ${data.name}</span>`;
    const switchCard = document.getElementById('director-switch-card');
    if (switchCard && !isDirector) switchCard.style.display = 'none';

    triggerTvConnectPop(data.name);
  }

  if (data.type === 'GET_CURRENT_STATE' && isDirector) {
    const savedName = localStorage.getItem(STORAGE_USER_NAME);
    sendP2PData({ type: 'DIRECTOR_ANNOUNCE', name: savedName });

    if (currentSong) {
      sendP2PData({
        type: 'SYNC_STATE',
        songId: currentSong.id,
        semitones: globalSemitones,
        currentSection: currentSectionId,
        bpm: currentBpm,
        isMetroPlaying: isMetronomePlaying,
        setlist: setlist
      });
    }
    return;
  }

  if (data.type === 'SYNC_STATE' || data.type === 'OPEN_SONG') {
    currentSong = REPERTORIO.find(s => s.id === data.songId);
    globalSemitones = data.semitones || 0;
    if (!isDecoupled) localSemitones = globalSemitones;

    showSongScreen();
    renderCurrentSong();

    if (data.setlist) {
      setlist = data.setlist;
      saveSetlistToStorage();
      renderSetlistUI();
    }
    
    if (data.currentSection) {
      highlightAndScrollSection(data.currentSection);
    }

    if (data.bpm) {
      currentBpm = data.bpm;
      updateBpmUI(currentBpm);
    }

    const btnCD = document.getElementById('btn-start-countdown') || document.getElementById('btn-start-countdown-voice') || document.getElementById('btn-start-countdown-inst');
    if (btnCD) btnCD.style.display = 'block';

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
    const role = localStorage.getItem(STORAGE_USER_ROLE);
    if (role !== 'tv') showToastAlert(data.message);
  }

  if (data.type === 'START_COUNTDOWN') {
    runCountdownAnimation();
  }

  if (data.type === 'CHAT_MSG') {
    const role = localStorage.getItem(STORAGE_USER_ROLE);
    if (role !== 'tv') {
      appendChatMessage(data.author, data.text);
      showToastAlert(`💬 ${data.author.toUpperCase()}: ${data.text}`);
    }
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

  if (data.type === 'STOP_SONG') {
    stopMetronomeVisual();
    
    const role = localStorage.getItem(STORAGE_USER_ROLE);

    if (role === 'tv') {
      let flashEl = document.getElementById('tv-flash-burst');
      if (!flashEl) {
        flashEl = document.createElement('div');
        flashEl.id = 'tv-flash-burst';
        document.body.appendChild(flashEl);
      }

      flashEl.classList.remove('animate-burst');
      void flashEl.offsetWidth;
      flashEl.classList.add('animate-burst');

      setTimeout(() => {
        const songTitleEl = document.getElementById('song-title');
        if (songTitleEl) songTitleEl.classList.remove('show-intro-title');

        document.querySelectorAll('.tv-section-block').forEach(el => {
          el.classList.remove('active-tv-section');
        });

        showWaitingScreen();
      }, 200);

    } else {
      const btnCD = document.getElementById('btn-start-countdown') || document.getElementById('btn-start-countdown-voice') || document.getElementById('btn-start-countdown-inst');
      if (btnCD) btnCD.style.display = 'block';
    }

    log('🛑 La canción ha finalizado.');
  }

  if (data.type === 'UPDATE_SETLIST') {
    setlist = data.setlist;
    saveSetlistToStorage();
    renderSetlistUI();
  }
}

// METRÓNOMO BATERISTA
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
    if (light) {
      light.classList.add('flash');
      setTimeout(() => light.classList.remove('flash'), 120);
    }
  }, intervalMs);
}

function stopMetronomeVisual() {
  if (metronomeInterval) clearInterval(metronomeInterval);
  isMetronomePlaying = false;
  updateMetronomeButtonUI();
  const light = document.getElementById('metronome-light');
  if (light) light.classList.remove('flash');
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

// SETLIST PERSISTENCIA Y REPOSITORIO
function toggleCatalogVisibility() {
  const wrapper = document.getElementById('catalog-foldable-wrapper');
  if (!wrapper) return;
  const isHidden = wrapper.style.display === 'none';
  wrapper.style.display = isHidden ? 'block' : 'none';
  if (isHidden) renderCatalog();
}

function toggleSetlistSong(songId) {
  const song = REPERTORIO.find(s => s.id === songId);
  if (!song) return;

  const idx = setlist.findIndex(s => s.id === songId);
  if (idx === -1) {
    setlist.push(song);
  } else {
    setlist.splice(idx, 1);
  }

  saveSetlistToStorage();
  renderSetlistUI();
  renderCatalog(document.getElementById('catalog-search')?.value || "");

  sendP2PData({ type: 'UPDATE_SETLIST', setlist: setlist });
}

function saveSetlistToStorage() {
  localStorage.setItem(STORAGE_SAVED_SETLIST, JSON.stringify(setlist));
}

function loadSetlistFromStorage() {
  const saved = localStorage.getItem(STORAGE_SAVED_SETLIST);
  if (saved) {
    try { setlist = JSON.parse(saved); renderSetlistUI(); } catch(e){}
  }
}

function renderSetlistUI() {
  const container = document.getElementById('setlist-items');
  if (!container) return;

  if (setlist.length === 0) {
    container.innerHTML = `<span style="color:#777;">No hay canciones seleccionadas. Toca <b>"📂 Añadir Canciones"</b> para armar tu lista.</span>`;
    return;
  }

  const isDirector = document.getElementById('director-checkbox')?.checked;

  let html = '<div style="display:flex; flex-direction:column; gap:4px; margin-top:4px;">';
  setlist.forEach((song, idx) => {
    html += `
      <div style="display:flex; justify-content:space-between; align-items:center; background:#181b29; padding:8px 10px; border-radius:6px; border:1px solid #26293b;">
        <span><b>${idx + 1}. ${song.title}</b> <small style="color:var(--accent-orange); margin-left:6px;">${song.keyOriginal}</small></span>
        ${isDirector ? `<button class="btn btn-cyan" style="width:auto; padding:5px 12px; font-size:0.8rem; margin:0;" onclick="directorSelectSong('${song.id}')">▶ Tocar</button>` : ''}
      </div>
    `;
  });
  html += '</div>';
  container.innerHTML = html;
}

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
    stopMetronomeVisual();
  }

  showSongScreen();
  document.getElementById('director-panel').style.display = 'block';

  renderCurrentSong();

  sendP2PData({ 
    type: 'OPEN_SONG', 
    songId: songId, 
    semitones: globalSemitones,
    bpm: currentBpm,
    isMetroPlaying: false,
    setlist: setlist
  });
  
  log(`📢 Canción transmitida: ${currentSong.title}`);
}

// RENDERIZADO DE CANCIÓN
function renderCurrentSong() {
  if (!currentSong) return;

  const role = localStorage.getItem(STORAGE_USER_ROLE);
  const semitonesToUse = isDecoupled ? localSemitones : globalSemitones;

  document.getElementById('song-title').innerText = `${currentSong.title} - ${currentSong.artist}`;
  
  const transposedContent = transponerTextoCancion(currentSong.content, semitonesToUse);
  const viewer = document.getElementById('song-viewer');
  
  if (role !== 'tv') {
    viewer.style.fontSize = `${currentFontSize}rem`;
  }

  const lines = transposedContent.split('\n');
  let html = '';
  const sections = [];
  let isInsideTvBlock = false;

  lines.forEach((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      const name = trimmed.replace('[', '').replace(']', '');
      const secId = name.toLowerCase().replace(/\s+/g, '');
      sections.push({ name, id: secId });

      if (role === 'tv') {
        if (isInsideTvBlock) html += `</div>`;
        html += `<div class="tv-section-block" id="tv-sec-${secId}">`;
        isInsideTvBlock = true;
      } else {
        html += `<span class="section-header" id="sec-${secId}">${trimmed}</span>`;
      }
    } else if (esLineaAcordes(line)) {
      if (role !== 'voces' && role !== 'tv') {
        html += `<span class="chord">${line}</span>\n`;
      }
    } else {
      if (role === 'tv') {
        if (trimmed.length > 0) {
          html += `<div class="tv-lyric-line">${trimmed}</div>`;
        }
      } else {
        html += `${line}\n`;
      }
    }
  });

  if (role === 'tv' && isInsideTvBlock) {
    html += `</div>`;
  }

  viewer.innerHTML = html;
  buildDirectorControls(sections);
  updateKeyControlsUI(semitonesToUse);

  if (role === 'tv') {
    const targetSection = currentSectionId || (sections.length > 0 ? sections[0].id : 'intro');
    showTvSectionOnly(targetSection);
  }
}

// CONSTRUCCIÓN DEL PANEL DEL DIRECTOR CON BOTÓN DE CONTEO RÁPIDO
function buildDirectorControls(sections) {
  const container = document.getElementById('section-buttons');
  if (!container) return;
  container.innerHTML = '';

  const savedRole = localStorage.getItem(STORAGE_USER_ROLE);
  const isVoiceDirector = savedRole === 'voces';

  if (isVoiceDirector) {
    // --- DIRECTOR VOCES ---
    const bpmEl = document.createElement('div');
    bpmEl.className = 'voice-director-bpm';
    bpmEl.innerText = `⏱️ BPM: ${currentBpm}`;
    container.appendChild(bpmEl);

    const songNameEl = document.createElement('div');
    songNameEl.className = 'voice-director-song-name';
    songNameEl.innerText = currentSong ? currentSong.title : 'Selecciona una canción';
    container.appendChild(songNameEl);

    const btnCountdown = document.createElement('button');
    btnCountdown.id = 'btn-start-countdown-voice';
    btnCountdown.innerText = '⏱️ Iniciar cuenta regresiva (3, 2, 1)';
    btnCountdown.onclick = () => sendCountdownCommand();
    container.appendChild(btnCountdown);

    const sectionsGrid = document.createElement('div');
    sectionsGrid.className = 'voice-sections-grid';

    sections.forEach((sec) => {
      const btn = document.createElement('button');
      btn.className = 'btn-voice-section';
      btn.id = `btn-sec-ctrl-${sec.id}`;
      btn.innerText = sec.name;
      btn.onclick = () => {
        highlightActiveDirectorButton(sec.id);
        triggerJump(sec.id);
      };
      sectionsGrid.appendChild(btn);
    });
    container.appendChild(sectionsGrid);

    const actionsGrid = document.createElement('div');
    actionsGrid.className = 'voice-actions-grid';

    const actions = [
      { label: '🔁 Repetir Coro', msg: '🔁 Repetir Coro' },
      { label: '🛑 Finalizar', msg: 'Finalizar', isStop: true },
      { label: '🤫 Solo Voces', msg: '🤫 Solo Voces' },
      { label: '🎹 Instrumental', msg: '🎹 Instrumental/Espontáneo' }
    ];

    actions.forEach(act => {
      const b = document.createElement('button');
      b.className = `btn-voice-action ${act.isStop ? 'btn-action-stop' : ''}`;
      b.innerText = act.label;
      b.onclick = () => {
        if (act.isStop) {
          stopMetronomeVisual();
          sendP2PData({ type: 'STOP_SONG' });
        }
        sendQuickAlert(act.msg);
      };
      actionsGrid.appendChild(b);
    });

    container.appendChild(actionsGrid);

  } else {
    // --- LAYOUT DIRECTOR INSTRUMENTISTA ---
    
    // 1. Contenedor de Acciones Rápidas (Conteo + Finalizar)
    const topActions = document.createElement('div');
    topActions.className = 'inst-top-actions';

    const btnCountdown = document.createElement('button');
    btnCountdown.id = 'btn-start-countdown-inst';
    btnCountdown.innerText = '⏱️ Cuenta Regresiva';
    btnCountdown.onclick = () => sendCountdownCommand();
    topActions.appendChild(btnCountdown);

    const btnStop = document.createElement('button');
    btnStop.className = 'btn-inst-stop';
    btnStop.innerText = '🛑 Finalizar';
    btnStop.onclick = () => {
      stopMetronomeVisual();
      sendP2PData({ type: 'STOP_SONG' });
      sendQuickAlert('Finalizar');
    };
    topActions.appendChild(btnStop);

    container.appendChild(topActions);

    // 2. Grid de 3 columnas para secciones
    const instGrid = document.createElement('div');
    instGrid.className = 'instrument-sections-grid';

    sections.forEach((sec) => {
      const btn = document.createElement('button');
      btn.className = 'btn-inst-section';
      btn.id = `btn-sec-ctrl-${sec.id}`;
      btn.innerText = sec.name;
      btn.onclick = () => {
        highlightActiveDirectorButton(sec.id);
        triggerJump(sec.id);
      };
      instGrid.appendChild(btn);
    });

    container.appendChild(instGrid);
  }

  if (currentSectionId) {
    highlightActiveDirectorButton(currentSectionId);
  }
}

function highlightActiveDirectorButton(secId) {
  document.querySelectorAll('.btn-voice-section, .btn-inst-section').forEach(btn => {
    btn.classList.remove('active-director-section', 'active-inst-section');
  });

  const activeBtn = document.getElementById(`btn-sec-ctrl-${secId}`);
  if (activeBtn) {
    if (activeBtn.classList.contains('btn-voice-section')) {
      activeBtn.classList.add('active-director-section');
    } else {
      activeBtn.classList.add('active-inst-section');
    }
  }
}

function showTvSectionOnly(secId) {
  const songTitleEl = document.getElementById('song-title');

  if (!secId || secId === 'intro' || secId.includes('intro')) {
    document.querySelectorAll('.tv-section-block').forEach(el => {
      el.classList.remove('active-tv-section');
    });

    if (songTitleEl) {
      songTitleEl.classList.add('show-intro-title');
    }
    return;
  }

  if (songTitleEl) {
    songTitleEl.classList.remove('show-intro-title');
  }

  document.querySelectorAll('.tv-section-block').forEach(el => {
    el.classList.remove('active-tv-section');
  });

  let targetBlock = document.getElementById(`tv-sec-${secId}`);
  if (targetBlock) {
    targetBlock.classList.add('active-tv-section');
  }
}

function triggerJump(secId) {
  currentSectionId = secId;
  highlightAndScrollSection(secId);
  sendP2PData({ type: 'JUMP', target: secId });
}

function highlightAndScrollSection(secId) {
  const role = localStorage.getItem(STORAGE_USER_ROLE);
  const isDirector = document.getElementById('director-checkbox')?.checked;

  if (role === 'tv') {
    showTvSectionOnly(secId);
    return;
  }

  // DIRECTOR VOCES: Scroll directo a "Saltos y Control"
  if (isDirector && role === 'voces') {
    const jumpsHeader = document.getElementById('director-panel');
    if (jumpsHeader) {
      const offsetTop = jumpsHeader.getBoundingClientRect().top + window.pageYOffset;
      window.scrollTo({ top: offsetTop - 10, behavior: 'smooth' });
    }
    highlightActiveDirectorButton(secId);
    return;
  }

  // MÚSICOS E INSTRUMENTISTAS: Scroll calculado para no tapar la canción con la barra sticky
  const targetEl = document.getElementById(`sec-${secId}`);
  if (!targetEl) return;

  const metronomeCard = document.getElementById('metronome-card');
  const directorPanel = document.getElementById('director-panel');

  let extraMargin = 15;
  if (metronomeCard) extraMargin += metronomeCard.offsetHeight;
  if (isDirector && directorPanel && directorPanel.style.display !== 'none') {
    extraMargin += directorPanel.offsetHeight;
  }

  const elementPosition = targetEl.getBoundingClientRect().top + window.pageYOffset;
  const targetY = elementPosition - extraMargin;

  window.scrollTo({
    top: targetY,
    behavior: 'smooth'
  });

  document.querySelectorAll('.section-highlight').forEach(el => el.classList.remove('section-highlight'));
  targetEl.classList.add('section-highlight');

  setTimeout(() => {
    targetEl.classList.remove('section-highlight');
  }, 2500);

  highlightActiveDirectorButton(secId);
}

// CHAT FLOTANTE
function toggleChatPanel() {
  const panel = document.getElementById('chat-panel');
  if (!panel) return;
  panel.style.display = panel.style.display === 'flex' ? 'none' : 'flex';
}

function sendChatMessage() {
  const input = document.getElementById('chat-input');
  const text = input.value.trim();
  if (!text) return;

  const savedName = localStorage.getItem(STORAGE_USER_NAME) || 'Músico';
  appendChatMessage(savedName, text);
  showToastAlert(`💬 ${savedName.toUpperCase()}: ${text}`);

  sendP2PData({ type: 'CHAT_MSG', author: savedName, text: text });
  input.value = '';
}

function appendChatMessage(author, text) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-msg';
  msgDiv.innerHTML = `<div class="chat-msg-author">${author}</div><div>${text}</div>`;
  container.appendChild(msgDiv);
  container.scrollTop = container.scrollHeight;
}

// CUENTA REGRESIVA
function sendCountdownCommand() {
  const btnCDVoice = document.getElementById('btn-start-countdown-voice');
  const btnCDInst = document.getElementById('btn-start-countdown-inst');
  const btnCD = document.getElementById('btn-start-countdown');
  
  if (btnCDVoice) btnCDVoice.style.display = 'none';
  if (btnCDInst) btnCDInst.style.display = 'none';
  if (btnCD) btnCD.style.display = 'none';

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
  introLabelEl.innerText = role === 'voces' || role === 'tv' ? "Entrada / Primera línea:" : "Acordes de la Intro:";
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

      const firstSectionHeader = document.querySelector('.section-header') || document.querySelector('.tv-section-block');
      let firstSecId = 'intro';

      if (firstSectionHeader) {
        firstSecId = firstSectionHeader.id.replace('sec-', '').replace('tv-sec-', '');
      }

      triggerJump(firstSecId);

    } else {
      clearInterval(interval);
      overlay.style.display = 'none';
    }
  }, 1000);
}

// AUXILIARES
function sendMusicianAlert(msg) {
  const savedName = localStorage.getItem(STORAGE_USER_NAME) || 'Músico';
  const fullMsg = `📢 ${savedName.toUpperCase()}: ${msg}`;
  showToastAlert(fullMsg);
  sendP2PData({ type: 'QUICK_ALERT', message: fullMsg });
}

function sendQuickAlert(message) {
  showToastAlert(message);
  sendP2PData({ type: 'QUICK_ALERT', message: message });
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

  if (role === 'voces' || role === 'tv') {
    return firstLyric || "Preparados para cantar...";
  } else {
    if (introChords) {
      return transponerTextoCancion(introChords, semitones);
    }
    return `Tocar en Tono ${calcularNotaTono(currentSong.keyOriginal, semitones)}`;
  }
}