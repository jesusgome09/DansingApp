let peer = null;
let connections = [];
let retryTimer = null;
let globalDataCallback = null;

// Configuración STUN pública de alta disponibilidad
const peerConfig = {
  debug: 1,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' }
    ]
  }
};

function initPeerNetwork(myId, onOpen, onError, onDataReceived) {
  globalDataCallback = onDataReceived;

  if (peer && !peer.destroyed) {
    try { peer.destroy(); } catch(e){}
  }

  peer = new Peer(myId, peerConfig);

  peer.on('open', (id) => {
    console.log("🌐 Peer ID asignado:", id);
    if (onOpen) onOpen(id);
  });

  peer.on('error', (err) => {
    console.warn("⚠️ PeerJS Error:", err.type, err.message);
    if (err.type === 'unavailable-id') {
      if (onError) onError({ type: 'DIRECTOR_TAKEN', message: 'Ya existe un Director activo.' });
    } else {
      if (onError) onError(err);
    }
  });

  peer.on('connection', (conn) => {
    bindIncomingConnection(conn);
  });
}

function bindIncomingConnection(conn) {
  conn.on('open', () => {
    // Filtrar conexiones cerradas o duplicadas
    connections = connections.filter(c => c.open && c.peer !== conn.peer);
    connections.push(conn);
    
    console.log(`🤝 Conexión establecida con: ${conn.peer}. Total activos: ${connections.length}`);
    if (window.onP2PConnected) window.onP2PConnected(conn.peer);
  });

  conn.on('data', (data) => {
    console.log("📩 Comando P2P recibido:", data);
    if (globalDataCallback) globalDataCallback(data);

    // Retransmisión del Director hacia la banda
    const isDirector = document.getElementById('director-checkbox')?.checked;
    if (isDirector && (data.type === 'CHAT_MSG' || data.type === 'UPDATE_METRONOME' || data.type === 'QUICK_ALERT')) {
      broadcastFromDirector(data, conn.peer);
    }
  });

  conn.on('close', () => {
    connections = connections.filter(c => c.peer !== conn.peer);
    console.log(`❌ Dispositivo desconectado: ${conn.peer}`);
    if (window.onP2PDisconnected) window.onP2PDisconnected();
  });

  conn.on('error', (err) => {
    console.error("⚠️ Error en canal P2P:", err);
    connections = connections.filter(c => c.peer !== conn.peer);
  });
}

// CONEXIÓN DIRECTA CON REINTENTO LIMPIO
function connectToPeerWithRetry(remoteId, onDataReceived, onSuccess) {
  globalDataCallback = onDataReceived;
  if (retryTimer) clearTimeout(retryTimer);

  function attemptConnection() {
    if (!peer || peer.destroyed || peer.disconnected) {
      retryTimer = setTimeout(attemptConnection, 2000);
      return;
    }

    // Si ya hay conexión abierta, detener los intentos
    if (connections.length > 0 && connections[0].open && connections[0].peer === remoteId) {
      if (onSuccess) onSuccess(remoteId);
      return;
    }

    console.log(`🔍 Intentando enlazar con el Director (${remoteId})...`);
    
    // Limpiar canales previos en progreso
    connections.forEach(c => { try { c.close(); } catch(e){} });
    connections = [];

    const conn = peer.connect(remoteId, { reliable: true });

    let connected = false;

    conn.on('open', () => {
      connected = true;
      if (retryTimer) clearTimeout(retryTimer);
      connections = [conn];
      bindIncomingConnection(conn);

      console.log(`✅ ¡Enlazado exitosamente con el Director!`);
      if (onSuccess) onSuccess(remoteId);
      if (window.onP2PConnected) window.onP2PConnected(remoteId);
    });

    // Si no conecta en 3.5 segundos, reintentar de forma limpia
    retryTimer = setTimeout(() => {
      if (!connected) {
        console.warn("⏳ Reintentando señalización con el Director...");
        try { conn.close(); } catch(e){}
        attemptConnection();
      }
    }, 3500);
  }

  attemptConnection();
}

function sendP2PData(data) {
  connections = connections.filter(c => c && c.open);

  if (connections.length === 0) {
    console.warn("⚠️ No hay canales P2P activos para transmitir.");
    return;
  }

  connections.forEach(conn => {
    try {
      conn.send(data);
    } catch(err) {
      console.error("❌ Error enviando a:", conn.peer, err);
    }
  });
}

function broadcastFromDirector(data, senderPeerId) {
  connections.filter(c => c && c.open && c.peer !== senderPeerId).forEach(conn => {
    try { conn.send(data); } catch(e){}
  });
}