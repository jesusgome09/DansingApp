let peer = null;
let connections = [];
let retryTimer = null;
let globalDataCallback = null;

const peerConfig = {
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
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
    console.log("🌐 Conectado a la red con ID:", id);
    if (onOpen) onOpen(id);
  });

  peer.on('error', (err) => {
    console.warn("⚠️ PeerJS Error:", err.type);
    if (err.type === 'unavailable-id') {
      if (onError) onError({ type: 'DIRECTOR_TAKEN' });
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
    connections = connections.filter(c => c.open && c.peer !== conn.peer);
    connections.push(conn);
    
    console.log(`🤝 Nuevo dispositivo enlazado: ${conn.peer}. Total: ${connections.length}`);
    if (window.onP2PConnected) window.onP2PConnected(conn.peer);
  });

  conn.on('data', (data) => {
    if (globalDataCallback) globalDataCallback(data);

    // SI SOMOS DIRECTOR: Re-transmitir CUALQUIER comando a toda la banda
    const isDirector = document.getElementById('director-checkbox')?.checked;
    if (isDirector) {
      broadcastFromDirector(data, conn.peer);
    }
  });

  conn.on('close', () => {
    connections = connections.filter(c => c.peer !== conn.peer);
    if (window.onP2PDisconnected) window.onP2PDisconnected();
  });
}

function connectToPeerWithRetry(remoteId, onDataReceived, onSuccess) {
  globalDataCallback = onDataReceived;
  if (retryTimer) clearTimeout(retryTimer);

  function attemptConnection() {
    if (!peer || peer.destroyed || peer.disconnected) {
      retryTimer = setTimeout(attemptConnection, 2000);
      return;
    }

    if (connections.length > 0 && connections[0].open && connections[0].peer === remoteId) {
      if (onSuccess) onSuccess(remoteId);
      return;
    }

    const conn = peer.connect(remoteId, { reliable: true });

    let connected = false;

    conn.on('open', () => {
      connected = true;
      if (retryTimer) clearTimeout(retryTimer);
      connections = [conn];
      bindIncomingConnection(conn);

      if (onSuccess) onSuccess(remoteId);
      if (window.onP2PConnected) window.onP2PConnected(remoteId);
    });

    retryTimer = setTimeout(() => {
      if (!connected) {
        try { conn.close(); } catch(e){}
        attemptConnection();
      }
    }, 3000);
  }

  attemptConnection();
}

function sendP2PData(data) {
  connections = connections.filter(c => c && c.open);
  if (connections.length === 0) return;

  connections.forEach(conn => {
    try { conn.send(data); } catch(err){}
  });
}

function broadcastFromDirector(data, senderPeerId) {
  connections.filter(c => c && c.open && c.peer !== senderPeerId).forEach(conn => {
    try { conn.send(data); } catch(e){}
  });
}