import { updateState, withStateLock } from '../../lib/config.mjs';
import { track } from '../../lib/track.mjs';
import { allowLetter, takePending } from '../../lib/throttle.mjs';
const mode = process.argv[2];
process.send?.('ready');
process.once('message', () => {
  try {
    if (mode === 'hold') {
      withStateLock(() => {
        process.send?.('locked');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);
      });
    } else {
      for (let i = 0; i < 20; i++) {
        if (mode === 'hook') track({sid:'shared',src:'claude',state:'busy',countTool:true}, {spawnFn:()=>{}});
        if (mode === 'letter') updateState(s => allowLetter(s), {maxWaitMs:3000});
        if (mode === 'pending') updateState(s => takePending(s,'deferred',1), {maxWaitMs:3000});
      }
      process.send?.('done');
    }
    process.disconnect();
  } catch(e) { process.send?.({error:e.message}); process.exitCode=1;process.disconnect(); }
});
