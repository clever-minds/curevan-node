const axios = require("axios");
require("dotenv").config();

async function run() {
  try {
    console.log("🔑 Authenticating...");
    const auth = await axios.post("https://apiv2.shiprocket.in/v1/external/auth/login", {
      email: process.env.SHIPROCKET_API_EMAIL,
      password: process.env.SHIPROCKET_API_PASSWORD
    });
    const token = auth.data.token;
    console.log("✅ Authenticated.");

    console.log("🔍 Fetching pickup locations...");
    const res = await axios.get("https://apiv2.shiprocket.in/v1/external/settings/get/pickup", {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (res.data && res.data.data && res.data.data.shipping_address) {
      console.log("\n📍 VALID PICKUP NICKNAMES found in your account:");
      res.data.data.shipping_address.forEach(addr => {
        console.log(`- ${addr.pickup_location} (City: ${addr.city})`);
      });
      console.log("\nCopy one of these and put it in your .env as SHIPROCKET_PICKUP_LOCATION");
    } else {
      console.log("❓ No pickup locations found. Data:", JSON.stringify(res.data, null, 2));
    }
  } catch (error) {
    console.error("❌ Error:", error.response?.data || error.message);
  }
}

run();
