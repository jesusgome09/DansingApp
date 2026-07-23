let peer = null;
let connection = null;
let retryInterval = null;
let globalDataCallback = null;

function initPeerNetwork(myId, onOpen, onError, onDataReceived) {
  globalDataCallback = onDataReceived;

  if (peer && !peer.destroyed) {
    peer.destroy();
  }

  peer = new Peer(myId);

  peer.on('open', (id) => onOpen(id));

  peer.on('error', (err) => {
    if (err.type === 'unavailable-id') {
      onError({ type: 'DIRECTOR_TAKEN', message: 'Ya existe un Director activo en la red.' });
    } else {
      if (onError) onError(err);
    }
  });

  peer.on('connection', (conn) => {
    connection = conn;
    bindConnectionEvents();
  });
}

function connectToPeerWithRetry(remoteId, onDataReceived, onSuccess) {
  globalDataCallback = onDataReceived;
  if (retryInterval) clearInterval(retryInterval);

  retryInterval = setInterval(() => {
    if (!peer || peer.destroyed || peer.disconnected) return;

    if (connection && connection.open) {
      clearInterval(retryInterval);
      retryInterval = null;
      return;
    }

    const conn = peer.connect(remoteId);

    conn.on('open', () => {
      clearInterval(retryInterval);
      retryInterval = null;
      connection = conn;
      bindConnectionEvents();

      if (onSuccess) onSuccess(remoteId);
      if (window.onP2PConnected) window.onP2PConnected(remoteId);
    });

  }, 1000);
}

function bindConnectionEvents() {
  if (!connection) return;

  connection.on('open', () => {
    if (retryInterval) {
      clearInterval(retryInterval);
      retryInterval = null;
    }
    if (window.onP2PConnected) window.onP2PConnected(connection.peer);
  });

  connection.on('data', (data) => {
    if (globalDataCallback) globalDataCallback(data);
  });

  connection.on('close', () => {
    if (window.onP2PDisconnected) window.onP2PDisconnected();
  });
}

function sendP2PData(data) {
  if (connection && connection.open) {
    connection.send(data);
  }
}