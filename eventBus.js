const EventEmitter = require('events');

const eventBus = new EventEmitter();
eventBus.setMaxListeners(100);

function broadcast(event, data) {
  eventBus.emit('broadcast', { event, data, timestamp: new Date().toISOString() });
}

module.exports = {
  eventBus,
  broadcast
};
