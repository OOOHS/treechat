const {test}=require('node:test');
const assert=require('node:assert/strict');
const {shouldSend}=require('../src/keyboard.cjs');
test('Enter sends, Shift+Enter adds a line, IME commit never submits',()=>{
 assert.equal(shouldSend({key:'Enter'}),true);
 assert.equal(shouldSend({key:'Enter',shiftKey:true}),false);
 assert.equal(shouldSend({key:'Enter',isComposing:true}),false);
 assert.equal(shouldSend({key:'Enter',nativeEvent:{isComposing:true}}),false);
 assert.equal(shouldSend({key:'Enter',keyCode:229}),false);
 assert.equal(shouldSend({key:'Enter'},true),false);
 assert.equal(shouldSend({key:'a'}),false);
});
