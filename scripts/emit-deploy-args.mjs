import fs from 'fs';
const args = JSON.parse(fs.readFileSync('/tmp/deploy-args.json', 'utf8'));
process.stdout.write(JSON.stringify(args));
