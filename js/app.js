const STORAGE_USER_NAME = 'dansing_user_name';
const STORAGE_USER_ROLE = 'dansing_user_role';
const STORAGE_ROOM_CODE = 'dansing_room_code';
const STORAGE_SAVED_KEYS = 'dansing_saved_keys';

let currentSong = null;
let currentSectionId = null;
let globalSemitones = 0;
let localSemitones = 0;
let isDecoupled = false;
let toastTimeout = null;

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
    
    document.getElementById('profile-info').innerText = `${savedName} (${savedRole === 'cantante' ? '🎤 Cantante' : '🎸 Instrumentista'})`;
    
    showWaitingScreen();
    autoConnectNetwork(savedName, savedRole);
  }
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
  const uniqueSession = Math.floor(Math.random() * 1000);
  const myNetworkId = `${roomCode}-${name}-${uniqueSession}`;

  initPeerNetwork(
    myNetworkId,
    () => {
      document.getElementById('net-status').innerHTML = `<span style="color:var(--accent-orange)">🔍 Buscando al Director...</span>`;
      connectToLeader(roomCode);
    },
    (err) => log(`⚠️ Estado red: ${err.type}`),
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
        log('👑 Modo Director ACTIVO. Control maestro listo.');
        document.getElementById('net-status').innerHTML = `<span style="color:var(--accent-green)">👑 Director Activo</span>`;
        document.getElementById('director-catalog-card').style.display = 'block';
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
    showWaitingScreen();
    autoConnectNetwork(savedName, localStorage.getItem(STORAGE_USER_ROLE));
  }
}

// MANEJO DE COMANDOS P2P
function handleIncomingP2PData(data) {
  if (!data) return;

  const isDirector = document.getElementById('director-checkbox')?.checked;

  // Solicitud de estado de quien entra tarde
  if (data.type === 'GET_CURRENT_STATE' && isDirector) {
    if (currentSong) {
      log('📤 Enviando estado actual al nuevo músico...');
      sendP2PData({
        type: 'SYNC_STATE',
        songId: currentSong.id,
        semitones: globalSemitones,
        currentSection: currentSectionId
      });
    }
    return;
  }

  // Sincronización de canción
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

    log(`🎵 Sincronizado con canción: ${currentSong.title}`);
  }

  // Cambio de tono
  if (data.type === 'CHANGE_KEY') {
    globalSemitones = data.semitones;
    if (!isDecoupled) {
      localSemitones = globalSemitones;
      renderCurrentSong();
    }
  }

  // Salto de sección
  if (data.type === 'JUMP') {
    currentSectionId = data.target;
    highlightAndScrollSection(data.target);
  }

  // Avisos emergentes de Director o Músicos
  if (data.type === 'QUICK_ALERT') {
    showToastAlert(data.message);
  }

  // Cuenta Regresiva Sincronizada
  if (data.type === 'START_COUNTDOWN') {
    runCountdownAnimation();
  }
}

// INTERFAZ Y CANCIONES
function showWaitingScreen() {
  document.getElementById('waiting-screen').style.display = 'block';
  document.getElementById('song-card').style.display = 'none';
}

function renderCatalog() {
  const container = document.getElementById('catalog-list');
  container.innerHTML = '';

  const categorias = ["Adoración", "Alabanzas"];

  categorias.forEach(cat => {
    const header = document.createElement('h4');
    header.style.cssText = 'color:var(--accent-cyan); margin-top:12px; font-size:0.9rem;';
    header.innerText = cat;
    container.appendChild(header);

    const canciones = REPERTORIO.filter(s => s.category === cat);
    canciones.forEach(song => {
      const savedKey = getSavedKeyForSong(song.id);
      const btn = document.createElement('button');
      btn.className = 'btn btn-sec';
      btn.style.cssText = 'text-align:left; justify-content:space-between; margin-bottom:6px; background:#1e2030;';
      btn.innerHTML = `<span><b>${song.title}</b> <small style="color:#aaa">(${song.artist})</small></span> <span style="color:var(--accent-orange)">${savedKey !== null ? calcularNotaTono(song.keyOriginal, savedKey) : song.keyOriginal}</span>`;
      btn.onclick = () => directorSelectSong(song.id);
      container.appendChild(btn);
    });
  });
}

function directorSelectSong(songId) {
  currentSong = REPERTORIO.find(s => s.id === songId);
  currentSectionId = null;
  
  const savedKey = getSavedKeyForSong(songId);
  globalSemitones = savedKey !== null ? savedKey : 0;
  localSemitones = globalSemitones;
  isDecoupled = false;

  document.getElementById('waiting-screen').style.display = 'none';
  document.getElementById('song-card').style.display = 'block';
  document.getElementById('director-panel').style.display = 'block';

  renderCurrentSong();

  sendP2PData({ type: 'OPEN_SONG', songId: songId, semitones: globalSemitones });
  log(`📢 Canción transmitida a la banda: ${currentSong.title}`);
}

function renderCurrentSong() {
  if (!currentSong) return;

  const role = localStorage.getItem(STORAGE_USER_ROLE);
  const semitonesToUse = isDecoupled ? localSemitones : globalSemitones;

  document.getElementById('song-title').innerText = `${currentSong.title} - ${currentSong.artist}`;
  
  const transposedContent = transponerTextoCancion(currentSong.content, semitonesToUse);

  const viewer = document.getElementById('song-viewer');
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
      if (role === 'instrumentista') {
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

// TRANSPOSICIÓN Y PERSISTENCIA
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

// CONTROLES DEL DIRECTOR
function buildDirectorControls(sections) {
  const container = document.getElementById('section-buttons');
  if (!container) return;
  container.innerHTML = '';

  // Botón Maestro de Cuenta Regresiva
  const btnCountdown = document.createElement('button');
  btnCountdown.className = 'btn btn-orange';
  btnCountdown.style.cssText = 'margin-bottom: 10px; font-size: 0.95rem;';
  btnCountdown.innerText = '⏱️ Iniciar Cuenta Regresiva (3, 2, 1)';
  btnCountdown.onclick = () => sendCountdownCommand();
  container.appendChild(btnCountdown);

  // Botones de secciones
  sections.forEach((sec) => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-sec';
    btn.innerText = sec.name;
    btn.onclick = () => triggerJump(sec.id);
    container.appendChild(btn);
  });

  // Botones de mensajes rápidos del Director
  const alertContainer = document.createElement('div');
  alertContainer.style.cssText = 'width:100%; margin-top:10px; border-top:1px solid #333; padding-top:8px; display:flex; flex-wrap:wrap; gap:4px;';
  
  const alerts = ["🔁 Repetir Coro", "🛑 Finalizar", "🤫 Solo Voces", "🎹 Instrumental/Espontáneo"];
  alerts.forEach(msg => {
    const btn = document.createElement('button');
    btn.className = 'btn-alert';
    btn.innerText = msg;
    btn.onclick = () => sendQuickAlert(msg);
    alertContainer.appendChild(btn);
  });

  container.appendChild(alertContainer);
}

// MÚSICOS: ENVIAR AVISOS AL DIRECTOR Y BANDA
function sendMusicianAlert(msg) {
  const savedName = localStorage.getItem(STORAGE_USER_NAME) || 'Músico';
  const fullMsg = `📢 ${savedName.toUpperCase()}: ${msg}`;
  
  showToastAlert(fullMsg);
  sendP2PData({ type: 'QUICK_ALERT', message: fullMsg });
  log(`Enviado aviso de músico: "${fullMsg}"`);
}

// ALERTA EMERGENTE DE 7 SEGUNDOS
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

// LÓGICA DE CUENTA REGRESIVA CON INFO DE CANCIÓN E INTRO
function sendCountdownCommand() {
  runCountdownAnimation();
  sendP2PData({ type: 'START_COUNTDOWN' });
  log('⏱️ Cuenta regresiva iniciada en todos los dispositivos');
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

  // 1. Mostrar Nombre de la Canción y Tono
  songInfoEl.innerText = `🎵 ${currentSong.title}`;
  keyInfoEl.innerText = `Tono: ${notaActual}`;

  // 2. Extraer la Intro o Primera Línea para mostrar en pantalla
  const introData = extractIntroContent(currentSong.content, role, semitonesToUse);
  introLabelEl.innerText = role === 'cantante' ? "Entrada / Primera línea:" : "Acordes de la Intro:";
  introContentEl.innerText = introData;

  // 3. Ejecutar Animación
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
    } else {
      clearInterval(interval);
      overlay.style.display = 'none';
    }
  }, 1000);
}

// Función auxiliar para obtener la intro o la primera frase
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

  if (role === 'cantante') {
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

  // Si es Director, medimos la altura real de su panel flotante
  if (isDirector && directorPanel && directorPanel.style.display !== 'none') {
    const panelHeight = directorPanel.offsetHeight;
    const elementPosition = targetEl.getBoundingClientRect().top + window.pageYOffset;
    
    // Posicionamos la pantalla dejando un margen libre justo debajo del panel
    const offsetPosition = elementPosition - panelHeight - 20;

    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    });
  } else {
    // Si es músico normal (sin panel gigante), scroll directo
    targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // Resplandor Neón
  document.querySelectorAll('.section-highlight').forEach(el => el.classList.remove('section-highlight'));
  targetEl.classList.add('section-highlight');

  setTimeout(() => {
    targetEl.classList.remove('section-highlight');
  }, 2500);
}