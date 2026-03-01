require("dotenv").config({ path: __dirname + "/.env" });

const app = require("./app");
const { connectDB } = require("./config/db");

connectDB();   // ✅ YAHAN CALL HOTA HAI
const bcrypt = require('bcrypt');

bcrypt.hash('NewPassword@123', 10).then(console.log);

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
