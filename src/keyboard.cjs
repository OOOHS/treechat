'use strict';

// Match the native composer: Enter sends, Shift+Enter inserts a line break.
// WebKit reports the Enter that commits an IME candidate as keyCode 229.
function shouldSend(event, composing = false) {
  return event.key==='Enter'&&!event.shiftKey&&!composing&&!event.isComposing&&!event.nativeEvent?.isComposing&&event.keyCode!==229&&event.nativeEvent?.keyCode!==229;
}
module.exports={shouldSend};
