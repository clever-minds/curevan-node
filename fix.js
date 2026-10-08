const fs = require('fs');
let content = fs.readFileSync('c:/curevan_node/src/controllers/users/usersController.js', 'utf8');

const target = '      specialty: "therapist_profiles",\r\n      full_address: "therapist_profiles",\r\n    };\r\n\r\n    /* ---------- APPLY FIELD UPDATES ---------- */';
const target2 = '      specialty: "therapist_profiles",\n      full_address: "therapist_profiles",\n    };\n\n    /* ---------- APPLY FIELD UPDATES ---------- */';

const replace = '      specialty: "therapist_profiles",\n      full_address: "therapist_profiles",\n      kyc_license: "therapist_profiles",\n      kyc_id_proof: "therapist_profiles",\n      kyc_bank_proof: "therapist_profiles",\n      profile_image_id: "therapist_profiles"\n    };\n\n    /* ---------- APPLY FIELD UPDATES ---------- */';

if (content.includes(target)) {
  content = content.replace(target, replace);
} else if (content.includes(target2)) {
  content = content.replace(target2, replace);
} else {
  console.log("NOT FOUND");
}

fs.writeFileSync('c:/curevan_node/src/controllers/users/usersController.js', content);
