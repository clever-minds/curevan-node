const { getPickupLocations } = require("./src/services/shiprocketService");
require("dotenv").config();

async function checkLocations() {
  try {
    console.log("🔍 Attempting to fetch locations...");
    const locations = await getPickupLocations();
    console.log("📍 Result:", JSON.stringify(locations, null, 2));
  } catch (error) {
    console.error("❌ Error details:", error.message);
  }
}

checkLocations();
