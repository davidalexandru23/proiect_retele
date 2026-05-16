function encodeMessage(mesajObj) {
  return `${JSON.stringify(mesajObj)}\n`;
}

function decodeMessage(linieMesaj) {
  return JSON.parse(linieMesaj);
}

function sendMessage(socket, mesajObj) {
  socket.write(encodeMessage(mesajObj));
}

module.exports = {
  encodeMessage,
  decodeMessage,
  sendMessage
};
