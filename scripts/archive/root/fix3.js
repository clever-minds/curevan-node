const fs = require('fs');
let content = fs.readFileSync('c:/curevan_node/src/controllers/notifications/notificationsController.js', 'utf8');

let lines = content.split('\n');
lines[74] = '      ' + String.fromCharCode(96) + 'UPDATE notifications SET is_read = true WHERE id = :id' + String.fromCharCode(96) + ',';

fs.writeFileSync('c:/curevan_node/src/controllers/notifications/notificationsController.js', lines.join('\n'));
