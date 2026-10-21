require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const app = require("./app");
const { connectDB } = require("./config/db");
require("./cron");

connectDB();   // ✅ YAHAN CALL HOTA HAI
app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Server running");
});
