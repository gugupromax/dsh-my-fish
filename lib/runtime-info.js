import fs from 'node:fs';

// Capture public build metadata once: an old loaded module must not report a
// newer version merely because the source package changed on disk.
const {version}=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8'));
export const RUNTIME_INFO=Object.freeze({plugin:'dsh-my-fish',version,permissionRevision:'native-plan-tools-v1'});
