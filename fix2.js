const fs = require('fs');
let content = fs.readFileSync('c:/curevan_node/src/controllers/notifications/notificationsController.js', 'utf8');

let lines = content.split('\n');
lines[50] = '      ' + String.fromCharCode(96) + 'SELECT COUNT(*) as count FROM notifications WHERE user_uid = :uid AND is_read = false' + String.fromCharCode(96) + ',';

fs.writeFileSync('c:/curevan_node/src/controllers/notifications/notificationsController.js', lines.join('\n'));
